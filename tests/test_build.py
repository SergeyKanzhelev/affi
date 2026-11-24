import json
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import freshness  # noqa: E402
import generate_stats as gs  # noqa: E402
import package_data  # noqa: E402

SIGS = """sigs:
- dir: sig-node
  name: Node
  label: node
  leadership:
    chairs:
    - github: Alice
      name: Alice
    tech_leads:
    - github: bob
      name: Bob
"""

GITDM = """alice: alice!example.com
\tAcme until 2020-01-01
\tWidgets Inc
bob: bob!example.com
\tAcme
"""


def raw(date, users):
    mm, dd, yyyy = date[5:7], date[8:10], date[0:4]
    lines = [f"\n--- COMMAND: /bin/maintainers prune --repository-github=x --dryrun ---",
             f"Running script : {mm}-{dd}-{yyyy} 01:00:00",
             ">>>>> GitHub ID : Devstats contrib count : GitHub PR comment count"]
    lines += [f"{u} : {score} : {comments} " for u, (score, comments) in users.items()]
    return "\n".join(lines) + "\n"


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


class Fixture(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = self._tmp.name
        self.repo = os.path.join(self.tmp, "repo")
        self.data = os.path.join(self.tmp, "data")
        write(os.path.join(self.data, "sigs.yaml"), SIGS)
        write(os.path.join(self.data, "gitdm", "developers_affiliations1.txt"), GITDM)
        write(os.path.join(self.repo, "repositories.txt"), "k/a\nk/b\n")
        write(os.path.join(self.repo, "raw_stats", "k-a.txt"), raw("2026-03-01", {"alice": (10, 2)}))
        write(os.path.join(self.repo, "raw_stats", "k-b.txt"), raw("2026-03-01", {"bob": (5, 0)}))

    def tearDown(self):
        self._tmp.cleanup()

    def build(self):
        return gs.build_into(self.repo, os.path.join(self.data, "sigs.yaml"), os.path.join(self.data, "gitdm"))

    def stats_text(self):
        with open(os.path.join(self.repo, "maintainers_stats.json")) as f:
            return f.read()


class BuildTest(Fixture):
    def test_build_is_deterministic(self):
        self.build()
        first = self.stats_text()
        self.build()
        self.assertEqual(first, self.stats_text())

    def test_build_contents(self):
        stats = self.build()
        self.assertEqual(stats["repositories"]["k/a"],
                         {"date_generated": "2026-03-01", "users": {"alice": {"pr_comments": 2, "devstats_score": 10}}})
        self.assertEqual(stats["users_affiliation"], {"alice": "Widgets Inc", "bob": "Acme"})
        self.assertEqual(stats["users_roles"], {"alice": ["Chair (node)"], "bob": ["Tech Lead (node)"]})

    def test_role_removed_from_sigs_is_removed(self):
        self.build()
        write(os.path.join(self.data, "sigs.yaml"), SIGS.replace("    - github: bob\n      name: Bob\n", ""))
        stats = self.build()
        self.assertNotIn("bob", stats["users_roles"])

    def test_unlisted_repo_drops_out_and_listed_without_raw_is_kept(self):
        self.build()
        os.remove(os.path.join(self.repo, "raw_stats", "k-a.txt"))
        write(os.path.join(self.repo, "repositories.txt"), "k/a\n")
        stats = self.build()
        self.assertEqual(sorted(stats["repositories"]), ["k/a"])
        self.assertIn("alice", stats["repositories"]["k/a"]["users"])


class HarvestedFixture(Fixture):
    def setUp(self):
        super().setUp()
        self.build()
        write(os.path.join(self.data, "repos.txt"), "k/a\nk/c\n")
        write(os.path.join(self.data, "raw_stats", "k-a.txt"), raw("2026-11-01", {"alice": (20, 4)}))
        write(os.path.join(self.data, "raw_stats", "k-c.txt"), raw("2026-11-02", {"carol": (1, 1)}))


class PackageTest(HarvestedFixture):
    def test_package(self):
        refreshed, removed = package_data.package(self.repo, self.data)
        self.assertEqual(refreshed, ["k/a", "k/c"])
        self.assertEqual(removed, ["k-b"])
        stats = gs.load_stats(os.path.join(self.repo, "maintainers_stats.json"))
        self.assertEqual(sorted(stats["repositories"]), ["k/a", "k/c"])
        self.assertEqual(stats["repositories"]["k/a"]["date_generated"], "2026-11-01")
        self.assertEqual(stats["users_affiliation"]["carol"], "Unknown")

    def test_older_cache_does_not_overwrite(self):
        write(os.path.join(self.data, "raw_stats", "k-a.txt"), raw("2026-01-01", {"alice": (1, 1)}))
        refreshed, _ = package_data.package(self.repo, self.data)
        self.assertNotIn("k/a", refreshed)

    def test_not_harvested(self):
        os.remove(os.path.join(self.data, "repos.txt"))
        with self.assertRaises(package_data.NotHarvested):
            package_data.package(self.repo, self.data)


class FreshnessTest(HarvestedFixture):
    def test_stale_then_fresh(self):
        items = freshness.compare(self.repo, self.data)
        ids = [i["id"].split(".")[0] for i in items]
        self.assertEqual(ids, ["repos-list", "repos-stats", "affiliations"])
        package_data.package(self.repo, self.data)
        self.assertEqual(freshness.compare(self.repo, self.data), [])

    def test_ids_change_with_content(self):
        first = {i["id"] for i in freshness.compare(self.repo, self.data)}
        write(os.path.join(self.data, "raw_stats", "k-c.txt"), raw("2026-11-03", {"carol": (2, 2)}))
        second = {i["id"] for i in freshness.compare(self.repo, self.data)}
        self.assertNotEqual(first, second)

    def test_compare_does_not_touch_checkout(self):
        before = self.stats_text()
        freshness.compare(self.repo, self.data)
        self.assertEqual(before, self.stats_text())
        self.assertTrue(os.path.exists(os.path.join(self.repo, "raw_stats", "k-b.txt")))


class RolesTest(unittest.TestCase):
    def test_list_ends_with_its_indentation(self):
        sigs = """sigs:
  - dir: sig-node
    label: node
    leadership:
      chairs:
        - github: Alice
          name: Alice
      tech_leads:
        - github: bob
    contact:
      liaison:
        github: carol
  - dir: sig-apps
    label: apps
    leadership:
      chairs:
      - github: dave
    subprojects:
      - name: x
        leads:
          - github: erin
"""
        with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as f:
            f.write(sigs)
        try:
            roles = gs.parse_roles(f.name)
        finally:
            os.remove(f.name)
        self.assertEqual(roles, {"alice": ["Chair (node)"], "bob": ["Tech Lead (node)"], "dave": ["Chair (apps)"]})


class StripKeysTest(unittest.TestCase):
    def test_drops_unknown_top_level_keys(self):
        text = ("# c\napprovers:\n  - a\nemeritus-approves:\n  - x\n- y\n\n"
                "reviewers:\n- b\noptions:\n  no_parent_owners: true\n")
        new, dropped = gs.strip_unknown_keys(text, gs.OWNERS_KEYS)
        self.assertEqual(dropped, ["emeritus-approves"])
        self.assertEqual(new, "# c\napprovers:\n  - a\nreviewers:\n- b\noptions:\n  no_parent_owners: true\n")

    def test_aliases_keep_only_aliases(self):
        new, dropped = gs.strip_unknown_keys("aliases:\n  x:\n  - a\nemeritus_approvers:\n- z\n", gs.ALIASES_KEYS)
        self.assertEqual((new, dropped), ("aliases:\n  x:\n  - a\n", ["emeritus_approvers"]))


if __name__ == "__main__":
    unittest.main()
