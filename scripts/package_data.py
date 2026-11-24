"""Package harvested data into a checkout: `make package-data`.

Copies what `scripts/harvest.py` collected in the data dir ($AFFI_DATA_DIR,
default ~/.local/share/affi-data) into the repo and rebuilds
maintainers_stats.json. Offline and deterministic: no collection happens here.

- repositories.txt  <- the discovered repo list
- raw_stats/        <- every harvested raw file at least as new as the
                       committed one; raw files of repos no longer listed
                       are removed
- maintainers_stats.json rebuilt from scratch (roles and affiliations too)
"""

import filecmp
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import generate_stats as gs  # noqa: E402


class NotHarvested(Exception):
    pass


def cache_paths(ddir):
    paths = {
        "repos": os.path.join(ddir, "repos.txt"),
        "raw": os.path.join(ddir, gs.RAW_STATS_DIR),
        "sigs": os.path.join(ddir, "sigs.yaml"),
        "gitdm": os.path.join(ddir, "gitdm"),
    }
    missing = [k for k, p in paths.items() if not os.path.exists(p)]
    if missing:
        raise NotHarvested(f"nothing harvested yet in {ddir} (missing: {', '.join(missing)})")
    return paths


def package(repo_root, ddir):
    """Package the data dir into repo_root. Returns (refreshed repos, removed repos)."""
    paths = cache_paths(ddir)
    repos = gs.read_repo_list(paths["repos"])
    if not repos:
        raise NotHarvested(f"{paths['repos']} is empty")

    shutil.copyfile(paths["repos"], os.path.join(repo_root, gs.REPOS_FILENAME))

    raw_dir = os.path.join(repo_root, gs.RAW_STATS_DIR)
    os.makedirs(raw_dir, exist_ok=True)
    refreshed = []
    for repo in repos:
        name = gs.raw_file_name(repo)
        src = os.path.join(paths["raw"], name)
        dst = os.path.join(raw_dir, name)
        if not os.path.exists(src):
            continue
        if os.path.exists(dst):
            if filecmp.cmp(src, dst, shallow=False):
                continue
            if (gs.raw_date(src) or "") < (gs.raw_date(dst) or ""):
                continue
        shutil.copyfile(src, dst)
        refreshed.append(repo)

    listed = {gs.raw_file_name(r) for r in repos}
    removed = []
    for name in sorted(os.listdir(raw_dir)):
        if name.endswith(".txt") and name not in listed:
            os.remove(os.path.join(raw_dir, name))
            removed.append(name[:-4])

    gs.build_into(repo_root, paths["sigs"], paths["gitdm"])
    return refreshed, removed


def main():
    try:
        refreshed, removed = package(ROOT, gs.data_dir())
    except NotHarvested as e:
        print(f"package-data: {e}", file=sys.stderr)
        return 1
    print(f"Packaged: {len(refreshed)} repo(s) refreshed, {len(removed)} raw file(s) removed.")
    for r in refreshed:
        print(f"  refreshed {r}")
    for r in removed:
        print(f"  removed   {r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
