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
    
    current_section = None
    with open(raw_file, "r") as f:
        lines = f.readlines()
        
    for line in lines:
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
    return user_stats

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
    raw_file = os.path.join(RAW_STATS_DIR, f"{date_str}-{repo_slug}.txt")
    
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

        # Sanitize OWNERS files to remove fields that cause the tool to panic.
        # This is necessary because the 'maintainers' tool uses a strict parser that crashes on
        # unknown fields, including metadata fields or common typos found in the Kubernetes 
        # repository (e.g., 'emeritus_aprovers' missing a 'p').
        print("Sanitizing OWNERS files...")
        allowed_fields = {"approvers", "reviewers", "labels", "options", "filters"}
        for root, dirs, files in os.walk(repo_path):
            for name in files:
                if name == "OWNERS":
                    p = os.path.join(root, name)
                    try:
                        with open(p, 'r') as f:
                            lines = f.readlines()
                        new_lines = []
                        keep = True
                        for line in lines:
                            match = re.match(r'^(\w+):', line)
                            if match:
                                if match.group(1) in allowed_fields:
                                    keep = True
                                else:
                                    keep = False
                            if keep:
                                new_lines.append(line)
                        with open(p, 'w') as fw:
                            fw.writelines(new_lines)
                    except Exception as e:
                        print(f"Skipping sanitization for {p}: {e}")

        print(f"Running tool and saving to {raw_file}...")
        run_cmd([
            bin_path, "prune", 
            f"--repository-github={repo_name}",
            f"--repository-devstats={repo_name}",
            "--period-devstats=y", 
            "--dryrun"
        ], cwd=repo_path, outfile=raw_file)

    user_stats = parse_raw_output(raw_file)

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

    # Add/Update current repo
    final_stats["repositories"][repo_name] = {
        "date_generated": date_str,
        "users": user_stats
    }

    with open(STATS_FILENAME, "w") as f:
        json.dump(final_stats, f, indent=2)
    
    print(f"Successfully updated {STATS_FILENAME} with data for {repo_name} ({len(user_stats)} users).")

if __name__ == "__main__":
    main()
