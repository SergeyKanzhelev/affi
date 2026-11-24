"""Check: collect fresh data on a budget (`data-harvest`).

Collects into the data dir ($AFFI_DATA_DIR, default ~/.local/share/affi-data),
never into the checkout; `make package-data` brings it into the repo.

Each run:
  1. seeds the cache's raw_stats/ from the checkout (first run, or the
     checkout is newer), so dates continue from what is published;
  2. rediscovers the repo list (every --discover-days), refreshes sigs.yaml
     (every --sigs-days) and gitdm (every --gitdm-days);
  3. runs the maintainers tool for repos with no data first, then for repos
     whose data is older than --max-age-days, oldest first, until --budget of
     wall time is used. A repo that failed is retried after --retry-days.

Exits 0 when all is well. Otherwise exits 1 with findings in $CHECK_REPORT:
one per failing repo (`repo.<org>.<name>`), one for repos whose data is older
than --stale-days (`stale`), one per failed step (`step.<name>`).
"""

import argparse
import fcntl
import json
import os
import re
import shutil
import sys
import time
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import generate_stats as gs  # noqa: E402
import update_repos  # noqa: E402

MAX_LISTED = 40


def duration(s):
    m = re.fullmatch(r"(\d+)([smh])", s)
    if not m:
        raise argparse.ArgumentTypeError(f"bad duration {s!r} (e.g. 75m, 2h)")
    return int(m.group(1)) * {"s": 1, "m": 60, "h": 3600}[m.group(2)]


def now():
    return datetime.now(timezone.utc)


def stamp(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_stamp(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc) if s else None


def due(state, key, days):
    last = parse_stamp(state.get(key))
    return last is None or now() - last >= timedelta(days=days)


def load_state(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save_state(path, state):
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, sort_keys=True)
    os.replace(path + ".tmp", path)


def seed(cache_raw):
    """Copy the checkout's raw files into the cache where the cache has nothing newer."""
    os.makedirs(cache_raw, exist_ok=True)
    src_dir = os.path.join(ROOT, gs.RAW_STATS_DIR)
    if not os.path.isdir(src_dir):
        return 0
    n = 0
    for name in os.listdir(src_dir):
        if not name.endswith(".txt"):
            continue
        src, dst = os.path.join(src_dir, name), os.path.join(cache_raw, name)
        if os.path.exists(dst) and (gs.raw_date(dst) or "") >= (gs.raw_date(src) or ""):
            continue
        shutil.copyfile(src, dst)
        n += 1
    return n


def age_days(raw_date):
    if not raw_date:
        return None
    return (date.today() - date.fromisoformat(raw_date)).days


def listing(items):
    items = list(items)
    lines = [f"- {i}" for i in items[:MAX_LISTED]]
    if len(items) > MAX_LISTED:
        lines.append(f"- … and {len(items) - MAX_LISTED} more")
    return "\n".join(lines)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--budget", type=duration, default=duration("75m"), help="wall time for collecting repos")
    p.add_argument("--max-age-days", type=int, default=30, help="re-collect a repo older than this")
    p.add_argument("--stale-days", type=int, default=45, help="report repos older than this")
    p.add_argument("--retry-days", type=int, default=3, help="wait this long before retrying a failed repo")
    p.add_argument("--discover-days", type=int, default=7)
    p.add_argument("--sigs-days", type=int, default=7)
    p.add_argument("--gitdm-days", type=int, default=30)
    args = p.parse_args()

    start = time.monotonic()
    ddir = gs.data_dir()

    lock = open(os.path.join(ddir, "harvest.lock"), "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("data-harvest: another harvest is running; skipping this one.")
        return 0

    state_path = os.path.join(ddir, "harvest.json")
    state = load_state(state_path)
    repo_state = state.setdefault("repos", {})
    problems = []  # finding items for failed steps

    cache_raw = os.path.join(ddir, gs.RAW_STATS_DIR)
    seeded = seed(cache_raw)
    if seeded:
        gs.log(f"Seeded {seeded} raw file(s) from the checkout.")

    repos_path = os.path.join(ddir, "repos.txt")
    if due(state, "discovered", args.discover_days) or not os.path.exists(repos_path):
        try:
            repos = update_repos.discover()
            with open(repos_path + ".tmp", "w", encoding="utf-8") as f:
                f.write("".join(r + "\n" for r in repos))
            os.replace(repos_path + ".tmp", repos_path)
            state["discovered"] = stamp(now())
            gs.log(f"Discovered {len(repos)} repositories.")
        except Exception as e:
            problems.append({"id": "step.discover", "title": "Repository discovery failed", "body": str(e)})
    repos = gs.read_repo_list(repos_path if os.path.exists(repos_path) else os.path.join(ROOT, gs.REPOS_FILENAME))

    if due(state, "sigs", args.sigs_days) or not os.path.exists(os.path.join(ddir, "sigs.yaml")):
        try:
            gs.fetch_sigs(ddir)
            state["sigs"] = stamp(now())
        except Exception as e:
            problems.append({"id": "step.sigs", "title": "Downloading sigs.yaml failed", "body": str(e)})

    if due(state, "gitdm", args.gitdm_days) or not os.path.isdir(os.path.join(ddir, "gitdm")):
        if gs.fetch_gitdm(ddir):
            state["gitdm"] = stamp(now())
        else:
            problems.append({"id": "step.gitdm", "title": "Updating gitdm failed", "body": "See the log."})
    save_state(state_path, state)

    # Queue: no data first, then too old, oldest first; failed repos wait out their retry delay.
    queue = []
    for repo in repos:
        st = repo_state.get(repo, {})
        last_fail = parse_stamp(st.get("failed_at"))
        if st.get("error") and last_fail and now() - last_fail < timedelta(days=args.retry_days):
            continue
        raw = os.path.join(cache_raw, gs.raw_file_name(repo))
        d = gs.raw_date(raw) if os.path.exists(raw) else None
        if d is None:
            queue.append(("", repo))
        elif age_days(d) >= args.max_age_days:
            queue.append((d, repo))
    queue.sort()
    gs.log(f"{len(queue)} repo(s) due for collection.")

    collected, attempted = 0, 0
    if queue:
        bin_path = gs.install_tool(ddir)
        if not bin_path:
            problems.append({"id": "step.tool", "title": f"Installing maintainers {gs.MAINTAINERS_VERSION} failed",
                             "body": gs.last_error or "See the log."})
            queue = []
        for _, repo in queue:
            if time.monotonic() - start >= args.budget:
                gs.log(f"Budget used; {len(queue) - attempted} repo(s) left for the next run.")
                break
            attempted += 1
            t0 = time.monotonic()
            err = gs.collect_repo(repo, cache_raw, ddir, bin_path)
            st = repo_state.setdefault(repo, {})
            st["attempted_at"] = stamp(now())
            st["seconds"] = round(time.monotonic() - t0)
            if err:
                st["error"], st["failed_at"] = err, stamp(now())
            else:
                st.pop("error", None)
                st.pop("failed_at", None)
                st["collected_at"] = stamp(now())
                collected += 1
            save_state(state_path, state)

    if attempted and not collected:
        problems.append({"id": "step.collect", "title": f"All {attempted} attempted repo(s) failed",
                         "body": "Nothing could be collected this run; DevStats or GitHub may be down."})

    # Findings.
    items = list(problems)
    listed = set(repos)
    for repo in sorted(listed):
        err = repo_state.get(repo, {}).get("error")
        if err:
            items.append({"id": f"repo.{repo.replace('/', '.')}", "title": f"{repo}: {err}",
                          "body": f"Last attempt {repo_state[repo].get('failed_at')}; retried after "
                                  f"{args.retry_days} days. Output of the run is in the check log."})
    stale = []
    for repo in sorted(listed):
        raw = os.path.join(cache_raw, gs.raw_file_name(repo))
        d = gs.raw_date(raw) if os.path.exists(raw) else None
        if d is None or age_days(d) > args.stale_days:
            stale.append(f"{repo} ({d or 'no data'})")
    if stale:
        items.append({"id": "stale", "title": f"{len(stale)} repo(s) with data older than {args.stale_days} days",
                      "body": "The harvest works through them oldest first, within its budget.\n\n" + listing(stale)})

    gs.log(f"Collected {collected} of {attempted} attempted; {len(queue) - attempted} still due; "
           f"{len(stale)} stale; elapsed {time.monotonic() - start:.0f}s.")
    if not items:
        return 0
    for it in items:
        print(f"## {it['title']}\n{it['body']}\n")
    report = os.environ.get("CHECK_REPORT")
    if report:
        with open(report, "w", encoding="utf-8") as f:
            json.dump({"items": items[:50]}, f, indent=2)
    return 1


if __name__ == "__main__":
    sys.exit(main())
