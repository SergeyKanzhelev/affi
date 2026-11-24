"""Collect and build the maintainers stats database bundled with the extension.

Two separate steps:

- **collect** (expensive, network): run the `maintainers` tool for one repo and
  write its raw output to `raw_stats/<org>-<repo>.txt`.
- **build** (cheap, offline): rebuild `maintainers_stats.json` from
  `repositories.txt`, `raw_stats/`, `sigs.yaml` and a gitdm clone. Roles and
  affiliations are rebuilt for every user, not only filled in for new ones.

Downloads (the tool, repo clones, sigs.yaml, gitdm) are kept in the data dir,
`$AFFI_DATA_DIR` or `~/.local/share/affi-data`, which `scripts/harvest.py`
also uses as its cache.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

STATS_FILENAME = "maintainers_stats.json"
REPOS_FILENAME = "repositories.txt"
RAW_STATS_DIR = "raw_stats"
GITDM_REPO = "https://github.com/cncf/gitdm"
SIGS_YAML_URL = "https://raw.githubusercontent.com/kubernetes/community/master/sigs.yaml"
MAINTAINERS_MODULE = "github.com/kubernetes-sigs/maintainers"
MAINTAINERS_VERSION = "v0.3.1-0.20260125181707-b1b98a9d7942"  # main, 2026-01-25: v0.3.0 cannot read emeritus_approvers


def log(msg):
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {msg}", flush=True)


def data_dir():
    d = os.environ.get("AFFI_DATA_DIR") or os.path.join(Path.home(), ".local", "share", "affi-data")
    os.makedirs(d, exist_ok=True)
    return d


def raw_file_name(repo):
    return repo.replace("/", "-") + ".txt"


def read_repo_list(path):
    with open(path, encoding="utf-8") as f:
        return [line.strip() for line in f if line.strip()]


last_error = ""  # the most telling stderr line of the last failed run_cmd


def error_line(stderr):
    lines = [l.strip() for l in stderr.splitlines() if l.strip()]
    for l in reversed(lines):
        if l.startswith(("Error", "error", "panic", "fatal")):
            return l[:300]
    return lines[-1][:300] if lines else ""


def run_cmd(cmd, cwd=None, outfile=None, env=None):
    global last_error
    log(f"Executing: {' '.join(cmd)}")
    env = dict(env or os.environ)
    env.setdefault("GOPATH", str(Path.home() / "go"))
    if outfile:
        with open(outfile, "a") as f:
            f.write(f"\n--- COMMAND: {' '.join(cmd)} ---\n")
            f.flush()
            result = subprocess.run(cmd, stdout=f, stderr=subprocess.PIPE, text=True, cwd=cwd, env=env)
    else:
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd, env=env)
    if result.returncode != 0:
        log(f"Error executing command: {result.stderr.strip()[-2000:]}")
        last_error = error_line(result.stderr) or f"exit {result.returncode}"
        return None
    return result.stdout if result.stdout is not None else ""


# ---------------------------------------------------------------- collection

def install_tool(ddir):
    """Install the pinned maintainers tool into <data dir>/bin; return its path or None."""
    bin_dir = os.path.join(ddir, "bin")
    bin_path = os.path.join(bin_dir, "maintainers")
    marker = bin_path + ".version"
    try:
        with open(marker) as f:
            if f.read().strip() == MAINTAINERS_VERSION and os.path.exists(bin_path):
                return bin_path
    except FileNotFoundError:
        pass
    log(f"Installing maintainers {MAINTAINERS_VERSION}...")
    os.makedirs(bin_dir, exist_ok=True)
    env = dict(os.environ, GOBIN=bin_dir)
    if run_cmd(["go", "install", f"{MAINTAINERS_MODULE}@{MAINTAINERS_VERSION}"], env=env) is None:
        log(f"go install failed: {last_error}")
        return None
    if not os.path.exists(bin_path):
        return None
    with open(marker, "w") as f:
        f.write(MAINTAINERS_VERSION + "\n")
    return bin_path


def clone_repo(clones_dir, repo):
    """Shallow clone repo under clones_dir, replacing any leftover; return its path or None."""
    repo_path = os.path.join(clones_dir, repo.replace("/", "_"))
    os.makedirs(clones_dir, exist_ok=True)
    if os.path.exists(repo_path):
        shutil.rmtree(repo_path)
    log(f"Cloning {repo} (shallow)...")
    if run_cmd(["git", "clone", "--depth", "1", f"https://github.com/{repo}", repo_path]) is None:
        return None
    return repo_path


# Top-level keys the maintainers tool accepts; it parses strictly and stops at any other.
OWNERS_KEYS = {"filters", "approvers", "reviewers", "required_reviewers", "labels",
               "emeritus_approvers", "emeritus_reviewers", "options"}
ALIASES_KEYS = {"aliases"}
TOP_KEY = re.compile(r"^([A-Za-z_][\w-]*)\s*:")


def strip_unknown_keys(text, allowed):
    """Drop top-level YAML keys not in allowed, with their blocks. Returns (text, dropped keys)."""
    out, dropped, skipping = [], [], False
    for line in text.splitlines(keepends=True):
        m = TOP_KEY.match(line)
        if m:
            skipping = m.group(1) not in allowed
            if skipping:
                dropped.append(m.group(1))
        elif skipping and (line[:1] in (" ", "\t", "-", "#") or not line.strip()):
            continue
        else:
            skipping = False
        if not skipping:
            out.append(line)
    return "".join(out), dropped


def prepare_clone(repo_path):
    """Make a clone's OWNERS files readable by the maintainers tool.

    OWNERS files of vendored code are not this repo's maintainers, so they go.
    Keys the tool does not know (emeritus lists in OWNERS_ALIASES, typos such
    as `emeritus-approves`) are dropped. The next update resets the clone.
    """
    for vendored in Path(repo_path).glob("**/vendor/**/OWNERS*"):
        vendored.unlink()
    for path in Path(repo_path).glob("**/OWNERS*"):
        if path.name not in ("OWNERS", "OWNERS_ALIASES") or not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        new, dropped = strip_unknown_keys(text, ALIASES_KEYS if path.name == "OWNERS_ALIASES" else OWNERS_KEYS)
        if dropped:
            log(f"Ignoring {', '.join(dropped)} in {os.path.relpath(path, repo_path)}")
            path.write_text(new, encoding="utf-8")


def collect_repo(repo, raw_dir, ddir, bin_path=None):
    """Run the maintainers tool for repo into raw_dir. Returns None on success, else an error.

    The previous raw file is replaced only when the run succeeds.
    """
    bin_path = bin_path or install_tool(ddir)
    if not bin_path:
        return "could not install the maintainers tool"
    repo_path = clone_repo(os.path.join(ddir, "clones"), repo)
    if not repo_path:
        return f"clone failed: {last_error}"
    try:
        prepare_clone(repo_path)
        return run_tool(repo, raw_dir, repo_path, bin_path)
    finally:
        # A repo is revisited about monthly: a fresh shallow clone then costs
        # about what an update would, and keeping ~300 clones costs ~20 GB.
        shutil.rmtree(repo_path, ignore_errors=True)


def run_tool(repo, raw_dir, repo_path, bin_path):
    """Run `maintainers prune` in a prepared clone; write raw_dir/<org>-<repo>.txt on success."""
    os.makedirs(raw_dir, exist_ok=True)
    raw_file = os.path.join(raw_dir, raw_file_name(repo))
    tmp_file = raw_file + ".tmp"
    if os.path.exists(tmp_file):
        os.remove(tmp_file)

    cmd = [bin_path, "prune", f"--repository-github={repo}", f"--repository-devstats={repo}",
           "--period-devstats=y", "--dryrun"]
    if run_cmd(cmd, cwd=repo_path, outfile=tmp_file) is None:
        # Not every repo is in DevStats on its own: fall back to the default (kubernetes/kubernetes).
        log(f"Warning: tool failed with devstats for {repo}, trying with default devstats...")
        cmd = [bin_path, "prune", f"--repository-github={repo}", "--period-devstats=y", "--dryrun"]
        if run_cmd(cmd, cwd=repo_path, outfile=tmp_file) is None:
            if os.path.exists(tmp_file):
                os.remove(tmp_file)
            return f"maintainers prune failed: {last_error}"
    os.replace(tmp_file, raw_file)
    return None


def fetch_sigs(ddir):
    """Download sigs.yaml into the data dir; return its path."""
    path = os.path.join(ddir, "sigs.yaml")
    log("Downloading sigs.yaml...")
    req = urllib.request.Request(SIGS_YAML_URL, headers={"User-Agent": "Affi-Stats-Generator"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read()
    with open(path + ".tmp", "wb") as f:
        f.write(body)
    os.replace(path + ".tmp", path)
    return path


def fetch_gitdm(ddir):
    """Clone or update the gitdm repo in the data dir; return its path or None."""
    path = os.path.join(ddir, "gitdm")
    if os.path.isdir(os.path.join(path, ".git")):
        log("Updating gitdm...")
        if (run_cmd(["git", "fetch", "--depth", "1", "origin", "HEAD"], cwd=path) is not None
                and run_cmd(["git", "reset", "--hard", "FETCH_HEAD"], cwd=path) is not None):
            return path
        shutil.rmtree(path)
    log("Cloning gitdm...")
    if run_cmd(["git", "clone", "--depth", "1", GITDM_REPO, path]) is None:
        return None
    return path


# ------------------------------------------------------------------ building

def parse_roles(sigs_path):
    """Map github user (lowercase) -> list of roles, from sigs.yaml.

    A role comes from a `chairs:` or `tech_leads:` list; the list ends at the
    first line indented no deeper than its key, whatever the file's layout.
    """
    roles = {}
    current_label = "Unknown"
    section, section_indent = None, -1
    with open(sigs_path, encoding="utf-8") as f:
        lines = f.read().split("\n")
    for line in lines:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip(" -"))
        if section and indent <= section_indent:
            section = None
        label_match = re.match(r"^\s*label:\s*(\S+)", line)
        if label_match:
            current_label = label_match.group(1).strip()
            continue
        key_match = re.match(r"^(\s*)(chairs|tech_leads):\s*$", line)
        if key_match:
            kind = "Chair" if key_match.group(2) == "chairs" else "Tech Lead"
            section, section_indent = f"{kind} ({current_label})", len(key_match.group(1))
            continue
        if section:
            user_match = re.search(r"github:\s*([\w-]+)", line)
            if user_match:
                user = user_match.group(1).lower()
                roles.setdefault(user, [])
                if section not in roles[user]:
                    roles[user].append(section)
    return roles


def lookup_affiliations(gitdm_path, users):
    """Map each user to their current company in gitdm; users not found are left out."""
    affiliations = {}
    if not users:
        return affiliations
    files = sorted(str(p) for p in Path(gitdm_path).glob("developers_affiliations*.txt"))
    if not files:
        raise RuntimeError(f"no developers_affiliations*.txt in {gitdm_path}")
    patterns = "".join(f"^{re.escape(u)}:\n" for u in sorted(users))
    process = subprocess.run(["grep", "-i", "-E", "-h", "-A", "10", "-f", "/dev/stdin", *files],
                             input=patterns, capture_output=True, text=True)
    if process.returncode not in (0, 1):
        raise RuntimeError(f"grep over gitdm failed: {process.stderr.strip()}")
    current_user = None
    for line in process.stdout.split("\n"):
        user_match = re.match(r"^([\w-]+):", line)
        if user_match:
            candidate = user_match.group(1).lower()
            current_user = candidate if candidate in users else None
            continue
        if current_user and (line.startswith(" ") or line.startswith("\t")) and line.strip():
            company_line = line.strip()
            if ":" in company_line and not any(k in company_line for k in ["from", "until"]):
                continue
            is_current = "until" not in company_line
            company = re.split(r"\s+from\s+|\s+until\s+", company_line)[0].strip()
            if current_user not in affiliations or is_current:
                affiliations[current_user] = company
    return affiliations


def parse_raw_output(raw_file):
    """Parse one raw maintainers output: (user -> stats, YYYY-MM-DD of the run or None)."""
    user_stats = {}
    date_str = None
    current_section = None
    with open(raw_file, "r", encoding="utf-8", errors="replace") as f:
        lines = f.readlines()
    for line in lines:
        if "Running script :" in line:
            match = re.search(r"(\d{2}-\d{2}-\d{4})", line)
            if match:
                mm, dd, yyyy = match.group(1).split("-")
                date_str = f"{yyyy}-{mm}-{dd}"
            continue
        if "--- COMMAND:" in line:
            current_section = "prune" if "prune" in line else None
            continue
        if current_section == "prune":
            match1 = re.search(r"^([\w-]+):\s*(\d+)\s*PR comments,\s*(\d+)\s*devstats", line)
            match2 = re.search(r"^([\w-]+)\s*:\s*(\d+)\s*:\s*(\d+)", line)
            if match1:
                user = match1.group(1).strip().lower()
                user_stats[user] = {"pr_comments": int(match1.group(2)), "devstats_score": int(match1.group(3))}
            elif match2:
                user = match2.group(1).strip().lower()
                user_stats[user] = {"pr_comments": int(match2.group(3)), "devstats_score": int(match2.group(2))}
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


def raw_date(raw_file):
    """The YYYY-MM-DD a raw file was generated, or None."""
    return parse_raw_output(raw_file)[1]


def build_stats(repos, raw_dir, sigs_path, gitdm_path, previous=None):
    """Build the stats database from scratch.

    repos: the repos to include (others, e.g. archived ones, drop out).
    A listed repo with no raw file keeps its entry from `previous`, if any.
    """
    previous_repos = (previous or {}).get("repositories", {})
    repositories = {}
    for repo in sorted(set(repos)):
        raw_file = os.path.join(raw_dir, raw_file_name(repo))
        if os.path.exists(raw_file):
            user_stats, date_str = parse_raw_output(raw_file)
            repositories[repo] = {
                "date_generated": date_str or "unknown",
                "users": {u: user_stats[u] for u in sorted(user_stats)},
            }
        elif repo in previous_repos:
            repositories[repo] = previous_repos[repo]

    all_users = set()
    for repo_data in repositories.values():
        all_users.update(repo_data["users"].keys())

    found = lookup_affiliations(gitdm_path, all_users)
    affiliations = {u: found.get(u, "Unknown") for u in sorted(all_users)}

    roles_raw = parse_roles(sigs_path)
    roles = {u: roles_raw[u] for u in sorted(roles_raw)}

    return {"users_affiliation": affiliations, "users_roles": roles, "repositories": repositories}


def stats_json(stats):
    return json.dumps(stats, indent=2) + "\n"


def load_stats(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None


def build_into(repo_root, sigs_path, gitdm_path):
    """Rebuild <repo_root>/maintainers_stats.json from the files in repo_root."""
    stats_path = os.path.join(repo_root, STATS_FILENAME)
    repos = read_repo_list(os.path.join(repo_root, REPOS_FILENAME))
    stats = build_stats(repos, os.path.join(repo_root, RAW_STATS_DIR), sigs_path, gitdm_path,
                        previous=load_stats(stats_path))
    with open(stats_path, "w", encoding="utf-8") as f:
        f.write(stats_json(stats))
    return stats


def main():
    start_time = time.time()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", action="append", default=[], help="collect this repo (org/name); repeatable")
    parser.add_argument("--collect-only", action="store_true", help="collect, do not rebuild the database")
    parser.add_argument("--build", action="store_true", help="only rebuild the database from raw_stats/")
    args = parser.parse_args()

    ddir = data_dir()
    failed = []
    if not args.build:
        if not args.repo:
            parser.error("--repo is required unless --build is given")
        bin_path = install_tool(ddir)
        if not bin_path:
            log("Installation of the maintainers tool failed.")
            return 1
        for repo in args.repo:
            err = collect_repo(repo, RAW_STATS_DIR, ddir, bin_path)
            if err:
                log(f"{repo}: {err}")
                failed.append(repo)

    if not args.collect_only:
        sigs_path = fetch_sigs(ddir)
        gitdm_path = fetch_gitdm(ddir)
        if not gitdm_path:
            log("Could not get gitdm.")
            return 1
        build_into(".", sigs_path, gitdm_path)
        log(f"Rebuilt {STATS_FILENAME}.")

    log(f"Done in {time.time() - start_time:.0f}s.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
