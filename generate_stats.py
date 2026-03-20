import os
import subprocess
import json
import re
import argparse
from pathlib import Path
from datetime import datetime

import time

# Configuration
STATS_FILENAME = "maintainers_stats.json"
RAW_STATS_DIR = "raw_stats"
GITDM_REPO = "https://github.com/cncf/gitdm"

def log(msg):
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {msg}")

import urllib.request

SIGS_YAML_URL = "https://raw.githubusercontent.com/kubernetes/community/master/sigs.yaml"

def fetch_roles(tmp_dir):
    gitdm_date = datetime.now().strftime("%Y-%m-%d")
    cache_dir = os.path.join(tmp_dir, f"community_{gitdm_date}")
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, "sigs.yaml")
    
    if not os.path.exists(path):
        log(f"Downloading sigs.yaml for {gitdm_date}...")
        urllib.request.urlretrieve(SIGS_YAML_URL, path)
    else:
        log(f"Using cached sigs.yaml from {path}")

    try:
        with open(path, 'r', encoding="utf-8") as f:
            content = f.read()
            roles = {} # user -> list of roles
            
            current_label = "Unknown"
            lines = content.split('\n')
            current_section = None
            
            for line in lines:
                # Identify SIG/WG label (e.g., sig-api-machinery)
                label_match = re.match(r'^\s*label: (.*)', line)
                if label_match:
                    current_label = label_match.group(1).strip()
                    continue
                
                # Check for leadership blocks
                if "chairs:" in line: 
                    current_section = f"Chair ({current_label})"
                elif "tech_leads:" in line: 
                    current_section = f"Tech Lead ({current_label})"
                # Reset if we hit a new top-level list item or non-indented line
                elif line.startswith("  -") or (line.strip() and not line.startswith(" ")):
                    # But don't reset if we just started a sig
                    if "sigs:" not in line:
                        current_section = None
                
                if current_section and "github:" in line:
                    user_match = re.search(r'github:\s*([\w-]+)', line)
                    if user_match:
                        user = user_match.group(1).lower()
                        if user not in roles: roles[user] = []
                        if current_section not in roles[user]:
                            roles[user].append(current_section)
            return roles
    except Exception as e:
        log(f"Error fetching roles: {e}")
        return {}

def run_cmd(cmd, cwd=None, outfile=None):
    log(f"Executing: {' '.join(cmd)}")
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
    log("Installing maintainers tool...")
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
    log(f"Cloning {repo_name} (shallow)...")
    repo_path = os.path.join(tmp_dir, repo_name.replace("/", "_"))
    if os.path.exists(repo_path):
        run_cmd(["git", "pull", "--depth", "1"], cwd=repo_path)
    else:
        run_cmd(["git", "clone", "--depth", "1", repo_url, repo_path])
    return repo_path
def fetch_affiliations(gitdm_path, tmp_dir, required_users):
    log(f"Fetching CNCF affiliations for {len(required_users)} users...")
    
    affiliations = {}
    if not required_users:
        return affiliations

    # Create a temporary file with regex patterns ^user:
    users_file = os.path.join(tmp_dir, "users_to_lookup.txt")
    with open(users_file, "w") as f:
        for u in sorted(required_users):
            f.write(f"^{re.escape(u)}:\n")

    # Use grep -i -E to find user lines
    try:
        # -i for case-insensitive, -E for extended regex
        cmd_str = f"grep -i -E -h -A 10 -f {users_file} {gitdm_path}/developers_affiliations*.txt"
        process = subprocess.run(cmd_str, shell=True, capture_output=True, text=True)
        
        if process.returncode == 0:
            lines = process.stdout.split('\n')
            current_user = None
            for line in lines:
                # Identification logic: Look for "^SomeUser:"
                user_match = re.match(r'^([\w-]+):', line)
                if user_match:
                    user_candidate = user_match.group(1).lower()
                    if user_candidate in required_users:
                        current_user = user_candidate
                    else:
                        current_user = None
                    continue
                
                # Company line (indented): usually starting with a tab or spaces
                if current_user and (line.startswith(" ") or line.startswith("\t")) and line.strip():
                    company_line = line.strip()
                    # Skip if it looks like another user line
                    if ":" in company_line and not any(keyword in company_line for keyword in ["from", "until"]):
                        continue

                    is_current = "until" not in company_line
                    # Surgically extract company name before "from" or "until"
                    company = re.split(r'\s+from\s+|\s+until\s+', company_line)[0].strip()
                    
                    if current_user not in affiliations or is_current:
                        affiliations[current_user] = company
    except Exception as e:
        log(f"Error during fast affiliation lookup: {e}")
    
    return affiliations

def parse_raw_output(raw_file):
    log(f"Parsing raw output from {raw_file}...")
    user_stats = {} # user -> stats
    date_str = None
    
    current_section = None
    with open(raw_file, "r") as f:
        lines = f.readlines()
        
    for line in lines:
        if "Running script :" in line:
            match = re.search(r'(\d{2}-\d{2}-\d{4})', line)
            if match:
                mm, dd, yyyy = match.group(1).split('-')
                date_str = f"{yyyy}-{mm}-{dd}"
            continue

        if "--- COMMAND:" in line:
            if "prune" in line:
                current_section = "prune"
            else:
                current_section = None
            continue
            
        if current_section == "prune":
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
            
            if "Missing Contributions" in line:
                current_section = "missing_contributions"
        
        elif current_section == "missing_contributions":
            trimmed = line.strip()
            if not trimmed: 
                current_section = "prune"
                continue
            if trimmed.startswith(">") or trimmed.startswith("-"):
                continue

            user = trimmed.lower()
            if user not in user_stats:
                user_stats[user] = {"pr_comments": 0, "devstats_score": 0}

    return user_stats, date_str

def main():
    start_time = time.time()
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
    
    tmp_dir = "/tmp/affi_stats"
    os.makedirs(tmp_dir, exist_ok=True)

    if args.parse_only:
        if not os.path.exists(raw_file):
            log(f"Error: Raw file {raw_file} not found for parsing.")
            return
    else:
        bin_path = install_tool()
        if not bin_path:
            log("Installation failed.")
            return

        if os.path.exists(raw_file):
            log(f"Removing existing raw file {raw_file}...")
            os.remove(raw_file)

        repo_path = clone_repo(tmp_dir, repo_url, repo_name)

        aliases_file = os.path.join(repo_path, "OWNERS_ALIASES")
        if not os.path.exists(aliases_file):
            log(f"Creating dummy {aliases_file} to prevent tool panic...")
            with open(aliases_file, "w") as f:
                f.write("aliases: {}\n")

        log(f"Sanitizing OWNERS files for {repo_name}...")
        allowed_fields = {"approvers", "reviewers", "labels", "options", "filters"}
        
        for root, dirs, files in os.walk(repo_path):
            for name in files:
                if name == "OWNERS":
                    p = os.path.join(root, name)
                    try:
                        with open(p, 'r') as f:
                            lines = f.readlines()
                        
                        new_lines = []
                        if repo_name == "kubernetes/test-infra":
                            current_block = None
                            for line in lines:
                                if line.startswith("approvers:"):
                                    current_block = "approvers"; new_lines.append(line)
                                elif line.startswith("reviewers:"):
                                    current_block = "reviewers"; new_lines.append(line)
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
                                if match: keep = match.group(1) in allowed_fields
                                if keep: new_lines.append(line)
                        
                        with open(p, 'w') as fw:
                            fw.writelines(new_lines)
                    except Exception as e:
                        print(f"Skipping sanitization for {p}: {e}")

        log(f"Running tool and saving to {raw_file}...")
        cmd = [bin_path, "prune", f"--repository-github={repo_name}", f"--repository-devstats={repo_name}", "--period-devstats=y", "--dryrun"]
        stdout = run_cmd(cmd, cwd=repo_path, outfile=raw_file)
        if stdout is None:
            if os.path.exists(raw_file): os.remove(raw_file)
            return

    if os.path.exists(raw_file):
        user_stats, file_date = parse_raw_output(raw_file)
        actual_date = file_date if file_date else date_str
    else:
        user_stats = {}; actual_date = date_str

    # Load existing stats if available
    final_stats = {"users_affiliation": {}, "users_roles": {}, "repositories": {}}
    if os.path.exists(STATS_FILENAME):
        try:
            with open(STATS_FILENAME, "r") as f:
                final_stats = json.load(f)
        except Exception as e:
            print(f"Warning: Could not load existing stats: {e}")

    # Update current repo
    sorted_users = sorted(user_stats.keys())
    new_users = {user: user_stats[user] for user in sorted_users}
    final_stats["repositories"][repo_name] = {
        "date_generated": actual_date,
        "users": new_users
    }

    # Global update of affiliations
    all_users = set()
    for repo_data in final_stats["repositories"].values():
        all_users.update(repo_data["users"].keys())

    # Identify users who need affiliation or role lookup
    existing_affi = final_stats.get("users_affiliation", {})
    existing_roles = final_stats.get("users_roles", {})
    
    missing_affi_users = {u for u in all_users if u not in existing_affi or existing_affi[u] == "Unknown"}
    missing_role_users = {u for u in all_users if u not in existing_roles}

    if missing_affi_users:
        # Clone gitdm once per day into a date-stamped folder
        gitdm_date = datetime.now().strftime("%Y-%m-%d")
        gitdm_path = os.path.join(tmp_dir, f"gitdm_{gitdm_date}")
        if not os.path.exists(gitdm_path):
            log(f"Cloning gitdm for {gitdm_date}...")
            run_cmd(["git", "clone", "--depth", "1", GITDM_REPO, gitdm_path])
        else:
            log(f"Using existing gitdm clone from {gitdm_path}")

        new_affiliations = fetch_affiliations(gitdm_path, tmp_dir, missing_affi_users)
        # Merge new into existing
        for u, company in new_affiliations.items():
            existing_affi[u] = company
        
        # Fill remaining with Unknown
        for u in all_users:
            if u not in existing_affi:
                existing_affi[u] = "Unknown"
    
    if missing_role_users:
        new_roles = fetch_roles(tmp_dir) # fetch_roles currently parses whole file
        # Update existing roles with all data from sigs.yaml
        for u, user_roles in new_roles.items():
            existing_roles[u] = user_roles
    
    final_stats["users_affiliation"] = existing_affi
    final_stats["users_roles"] = existing_roles

    # Sort repositories alphabetically
    sorted_repos = sorted(final_stats["repositories"].keys())
    new_repos = {repo: final_stats["repositories"][repo] for repo in sorted_repos}
    final_stats["repositories"] = new_repos

    with open(STATS_FILENAME, "w") as f:
        json.dump(final_stats, f, indent=2)

    elapsed = time.time() - start_time
    log(f"Successfully updated and sorted {STATS_FILENAME} with affiliations and {repo_name} data (Elapsed: {elapsed:.2f}s).")

if __name__ == "__main__":
    main()
