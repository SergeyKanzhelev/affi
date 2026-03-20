import os
import subprocess
import json
import re
import argparse
from pathlib import Path
from datetime import datetime

# Configuration
STATS_FILENAME = "maintainers_stats.json"
RAW_STATS_DIR = "raw_stats"

def run_cmd(cmd, cwd=None, outfile=None):
    print(f"Executing: {' '.join(cmd)}")
    env = os.environ.copy()
    if "GOPATH" not in env:
        env["GOPATH"] = str(Path.home() / "go")
    
    if outfile:
        with open(outfile, "a") as f:
            f.write(f"\n--- COMMAND: {' '.join(cmd)} ---\n")
            f.flush()
            result = subprocess.run(cmd, stdout=f, stderr=subprocess.PIPE, text=True, cwd=cwd, env=env)
    else:
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd, env=env)
    
    if result.returncode != 0:
        print(f"Error executing command: {result.stderr}")
        return None
    return result.stdout

def install_tool():
    print("Installing maintainers tool...")
    run_cmd(["go", "install", "github.com/dims/maintainers@latest"])
    home = str(Path.home())
    bin_path = os.path.join(home, "go", "bin", "maintainers")
    if not os.path.exists(bin_path):
        try:
            subprocess.run(["maintainers", "version"], capture_output=True)
            return "maintainers"
        except FileNotFoundError:
            return None
    return bin_path

def clone_repo(tmp_dir, repo_url, repo_name):
    print(f"Cloning {repo_name} (shallow)...")
    repo_path = os.path.join(tmp_dir, repo_name.replace("/", "_"))
    if os.path.exists(repo_path):
        run_cmd(["git", "pull", "--depth", "1"], cwd=repo_path)
    else:
        run_cmd(["git", "clone", "--depth", "1", repo_url, repo_path])
    return repo_path

def parse_raw_output(raw_file):
    print(f"Parsing raw output from {raw_file}...")
    user_stats = {} # user -> stats
    date_str = None
    
    current_section = None
    with open(raw_file, "r") as f:
        lines = f.readlines()
        
    for line in lines:
        if "Running script :" in line:
            # Format: Running script : 03-19-2026 00:21:50
            match = re.search(r'(\d{2}-\d{2}-\d{4})', line)
            if match:
                # Convert MM-DD-YYYY to YYYY-MM-DD
                mm, dd, yyyy = match.group(1).split('-')
                date_str = f"{yyyy}-{mm}-{dd}"
            continue

        if "--- COMMAND:" in line:
            if "prune" in line:
                current_section = "prune"
            else:
                current_section = None
            continue
            
        elif current_section == "prune":
            # Example 1: user1: 50 PR comments, 200 devstats score [stale: false]
            # Example 2: SergeyKanzhelev : 1157 : 441
            match1 = re.search(r'^([\w-]+):\s*(\d+)\s*PR comments,\s*(\d+)\s*devstats', line)
            match2 = re.search(r'^([\w-]+)\s*:\s*(\d+)\s*:\s*(\d+)', line)

            if match1:
                user = match1.group(1).strip().lower()
                pr_comments = int(match1.group(2))
                devstats_score = int(match1.group(3))
                user_stats[user] = {"pr_comments": pr_comments, "devstats_score": devstats_score}
            elif match2:
                user = match2.group(1).strip().lower()
                devstats_score = int(match2.group(2))
                pr_comments = int(match2.group(3))
                user_stats[user] = {"pr_comments": pr_comments, "devstats_score": devstats_score}

            # Identify start of missing contributions section
            if "Missing Contributions" in line:
                current_section = "missing_contributions"

        elif current_section == "missing_contributions":
            trimmed = line.strip()
            if not trimmed: # Stop at the first empty line
                current_section = "prune"
                continue
            if trimmed.startswith(">") or trimmed.startswith("-"):
                continue

            user = trimmed.lower()
            if user not in user_stats:
                user_stats[user] = {"pr_comments": 0, "devstats_score": 0}

    return user_stats, date_str

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default="kubernetes/kubernetes", help="Repository to analyze (org/repo)")
    parser.add_argument("--parse-only", action="store_true", help="Only parse existing raw stats for today, don't run the tool")
    args = parser.parse_args()

    repo_name = args.repo
    repo_url = f"https://github.com/{repo_name}"
    
    os.makedirs(RAW_STATS_DIR, exist_ok=True)
    date_str = datetime.now().strftime("%Y-%m-%d")
    repo_slug = repo_name.replace("/", "-")
    raw_file = os.path.join(RAW_STATS_DIR, f"{repo_slug}.txt")
    
    if args.parse_only:
        if not os.path.exists(raw_file):
            print(f"Error: Raw file {raw_file} not found for parsing.")
            return
    else:
        bin_path = install_tool()
        if not bin_path:
            print("Installation failed.")
            return

        tmp_dir = "/tmp/affi_stats"
        os.makedirs(tmp_dir, exist_ok=True)
        
        if os.path.exists(raw_file):
            print(f"Removing existing raw file {raw_file}...")
            os.remove(raw_file)

        repo_path = clone_repo(tmp_dir, repo_url, repo_name)

        # Workaround: many repos (like test-infra) don't have OWNERS_ALIASES
        # but the tool crashes if it is missing.
        aliases_file = os.path.join(repo_path, "OWNERS_ALIASES")
        if not os.path.exists(aliases_file):
            print(f"Creating dummy {aliases_file} to prevent tool panic...")
            with open(aliases_file, "w") as f:
                f.write("aliases: {}\n")

        # For kubernetes/test-infra, we use even more aggressive sanitization
        # to avoid the nil pointer panic in the tool.
        print(f"Sanitizing OWNERS files for {repo_name}...")
        allowed_fields = {"approvers", "reviewers", "labels", "options", "filters"}

        if repo_name == "kubernetes/test-infra":
            print(f"Drastically simplifying {repo_name} to isolate panic...")
            for root, dirs, files in os.walk(repo_path):
                if root == repo_path:
                    continue # Keep root
                for name in files:
                    if name == "OWNERS":
                        os.remove(os.path.join(root, name))
        
        for root, dirs, files in os.walk(repo_path):
            for name in files:
                if name == "OWNERS":
                    p = os.path.join(root, name)
                    try:
                        with open(p, 'r') as f:
                            lines = f.readlines()

                        new_lines = []
                        if repo_name == "kubernetes/test-infra":
                            # Extremely aggressive: only keep approvers/reviewers blocks
                            current_block = None
                            for line in lines:
                                if line.startswith("approvers:"):
                                    current_block = "approvers"
                                    new_lines.append(line)
                                elif line.startswith("reviewers:"):
                                    current_block = "reviewers"
                                    new_lines.append(line)
                                elif line.strip().startswith("-") and current_block:
                                    new_lines.append(line)
                                elif line.strip() == "":
                                    new_lines.append(line)
                                elif not line.startswith(" "):
                                    current_block = None
                        else:
                            keep = True
                            for line in lines:
                                match = re.match(r'^(\w+):', line)
                                if match:
                                    keep = match.group(1) in allowed_fields
                                if keep:
                                    new_lines.append(line)

                        with open(p, 'w') as fw:
                            fw.writelines(new_lines)
                    except Exception as e:
                        print(f"Skipping sanitization for {p}: {e}")

        print(f"Running tool and saving to {raw_file}...")
        cmd = [
            bin_path, "prune", 
            f"--repository-github={repo_name}",
            f"--repository-devstats={repo_name}",
            "--period-devstats=y", 
            "--dryrun"
        ]

        stdout = run_cmd(cmd, cwd=repo_path, outfile=raw_file)
        if stdout is None:
            print(f"Tool failed for {repo_name}. Removing incomplete raw file {raw_file}.")
            if os.path.exists(raw_file):
                os.remove(raw_file)
            return
    if os.path.exists(raw_file):
        user_stats, file_date = parse_raw_output(raw_file)
        actual_date = file_date if file_date else date_str
    else:
        user_stats = {}
        actual_date = date_str

    # Load existing stats if available
    final_stats = {"repositories": {}}
    if os.path.exists(STATS_FILENAME):
        try:
            with open(STATS_FILENAME, "r") as f:
                existing = json.load(f)
                # Handle migration from old format if needed
                if "repositories" in existing:
                    final_stats = existing
                elif "repository" in existing:
                    # Migrate old single-repo format
                    old_repo = existing["repository"]
                    final_stats["repositories"][old_repo] = {
                        "date_generated": existing.get("date_generated"),
                        "users": existing.get("users", {})
                    }
        except Exception as e:
            print(f"Warning: Could not load existing stats: {e}")

    # Add/Update current repo in the collection
    final_stats["repositories"][repo_name] = {
        "date_generated": actual_date,
        "users": user_stats
    }

    # Sort repositories alphabetically
    sorted_repos = sorted(final_stats["repositories"].keys())
    new_final_stats = {"repositories": {}}
    
    for repo in sorted_repos:
        repo_data = final_stats["repositories"][repo]
        # Sort users alphabetically within each repo
        users_obj = repo_data.get("users", {})
        if isinstance(users_obj, dict):
            sorted_users = sorted(users_obj.keys())
            new_users = {user: users_obj[user] for user in sorted_users}
        else:
            new_users = {}
        
        new_final_stats["repositories"][repo] = {
            "date_generated": repo_data.get("date_generated"),
            "users": new_users
        }

    with open(STATS_FILENAME, "w") as f:
        json.dump(new_final_stats, f, indent=2)
    
    print(f"Successfully updated and sorted {STATS_FILENAME} with data for {repo_name}.")

if __name__ == "__main__":
    main()
