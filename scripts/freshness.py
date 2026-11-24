"""Check: is the packaged data behind what has been harvested? (`data-fresh`)

Packages the data dir into a scratch copy of this checkout's data files and
compares the result with the checkout. Passes when packaging would change
nothing (or nothing has been harvested yet); otherwise fails with one finding
per kind of change, written to $CHECK_REPORT.

Finding ids carry a hash of the packaged content, so next week's refresh is a
new set of findings and the orchestrator's auto-fix files a new proposal for
it instead of treating it as already tried.
"""

import hashlib
import json
import os
import shutil
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import generate_stats as gs  # noqa: E402
import package_data  # noqa: E402

MAX_LISTED = 40


def digest(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True).encode()).hexdigest()[:10]


def listing(items):
    items = list(items)
    lines = [f"- {i}" for i in items[:MAX_LISTED]]
    if len(items) > MAX_LISTED:
        lines.append(f"- … and {len(items) - MAX_LISTED} more")
    return "\n".join(lines)


def read(path):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return None


def raw_files(d):
    if not os.path.isdir(d):
        return {}
    return {n: read(os.path.join(d, n)) for n in sorted(os.listdir(d)) if n.endswith(".txt")}


def dict_changes(old, new):
    added = sorted(set(new) - set(old))
    removed = sorted(set(old) - set(new))
    changed = sorted(k for k in set(old) & set(new) if old[k] != new[k])
    return added, removed, changed


def compare(root, ddir):
    """Return the finding items for root against what packaging ddir would produce."""
    with tempfile.TemporaryDirectory(prefix="affi-fresh-") as tmp:
        for name in (gs.REPOS_FILENAME, gs.STATS_FILENAME):
            if os.path.exists(os.path.join(root, name)):
                shutil.copyfile(os.path.join(root, name), os.path.join(tmp, name))
        if os.path.isdir(os.path.join(root, gs.RAW_STATS_DIR)):
            shutil.copytree(os.path.join(root, gs.RAW_STATS_DIR), os.path.join(tmp, gs.RAW_STATS_DIR))
        package_data.package(tmp, ddir)

        items = []

        old_list, new_list = read(os.path.join(root, gs.REPOS_FILENAME)), read(os.path.join(tmp, gs.REPOS_FILENAME))
        if old_list != new_list:
            old_set, new_set = set((old_list or "").split()), set(new_list.split())
            items.append({
                "id": f"repos-list.{digest(new_list)}",
                "title": f"Repository list changed: {len(new_set - old_set)} added, {len(old_set - new_set)} removed",
                "body": "Added:\n" + listing(sorted(new_set - old_set)) + "\n\nRemoved:\n" + listing(sorted(old_set - new_set)),
            })

        old_raw, new_raw = raw_files(os.path.join(root, gs.RAW_STATS_DIR)), raw_files(os.path.join(tmp, gs.RAW_STATS_DIR))
        added, removed, changed = dict_changes(old_raw, new_raw)
        if added or removed or changed:
            touched = {n: new_raw.get(n) for n in added + removed + changed}
            items.append({
                "id": f"repos-stats.{digest(touched)}",
                "title": f"Harvested stats newer than packaged: {len(added)} new, {len(changed)} refreshed, {len(removed)} dropped",
                "body": "New:\n" + listing(n[:-4] for n in added)
                        + "\n\nRefreshed:\n" + listing(n[:-4] for n in changed)
                        + "\n\nDropped:\n" + listing(n[:-4] for n in removed),
            })

        old_stats = gs.load_stats(os.path.join(root, gs.STATS_FILENAME)) or {}
        new_stats = gs.load_stats(os.path.join(tmp, gs.STATS_FILENAME))
        for key, slug, what in (("users_roles", "roles", "Leads (sigs.yaml)"),
                                ("users_affiliation", "affiliations", "Affiliations (gitdm)")):
            a, r, c = dict_changes(old_stats.get(key, {}), new_stats[key])
            if a or r or c:
                items.append({
                    "id": f"{slug}.{digest(new_stats[key])}",
                    "title": f"{what} changed: {len(a)} added, {len(c)} changed, {len(r)} removed",
                    "body": "Added:\n" + listing(a) + "\n\nChanged:\n" + listing(c) + "\n\nRemoved:\n" + listing(r),
                })

        if not items and old_stats.get("repositories") != new_stats["repositories"]:
            items.append({
                "id": f"stats-json.{digest(new_stats['repositories'])}",
                "title": "maintainers_stats.json does not match raw_stats/",
                "body": "Rebuilding from the committed raw_stats/ gives a different repositories section.",
            })
        return items


def main():
    ddir = gs.data_dir()
    try:
        items = compare(ROOT, ddir)
    except package_data.NotHarvested as e:
        print(f"data-fresh: {e}; nothing to package.")
        return 0
    if not items:
        print("data-fresh: the packaged data is current with the harvest.")
        return 0
    print("data-fresh: the packaged data is behind the harvest. Run `make package-data`.\n")
    for it in items:
        print(f"## {it['title']}\n{it['body']}\n")
    report = os.environ.get("CHECK_REPORT")
    if report:
        with open(report, "w", encoding="utf-8") as f:
            json.dump({"items": items}, f, indent=2)
    return 1


if __name__ == "__main__":
    sys.exit(main())
