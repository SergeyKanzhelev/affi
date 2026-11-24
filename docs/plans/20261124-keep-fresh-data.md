# Keep the bundled data fresh

**Status (2026-11-24):** Tasks 1 and 2 are implemented in affi; Task 3's
check files are in env. Departures from the text below, found while building
it:

- The `maintainers` tool moved to `github.com/kubernetes-sigs/maintainers`,
  and its last tag (v0.3.0, 2022) cannot read `emeritus_approvers`. It is
  pinned to a pseudo-version of `main` (2026-01-25).
- Even that build parses OWNERS strictly and stops at keys it does not know:
  `emeritus_approvers` in OWNERS_ALIASES, typos like `emeritus-approves`.
  The harvest drops unknown top-level keys and vendored OWNERS files in its
  own clone before running the tool. That is why most kubernetes-csi repos
  had no data.
- The `sigs.yaml` parser assumed one indentation layout and credited, e.g.,
  a SIG's liaison as its tech lead. It now ends a `chairs:`/`tech_leads:`
  list by indentation. The March roles carry that bug, so the first package
  changes many of them.
- Command-check findings are only read when the check fails, so
  `data-harvest` exits 1 whenever it has findings, and is yellow
  (`severity: warn`) for all of them; there is no separate red.
- Auto-fix will not file a fix for the same set of finding ids as an earlier
  proposal, merged ones included. `data-fresh`'s ids carry a hash of the
  packaged content (`repos-stats.<hash>`), so each week is a new set.
- The stale-repos finding is `data-harvest`'s (`stale`), not `data-fresh`'s:
  an auto-fix of `data-fresh` could not do anything about it.
- Stamps are kept in `harvest.json`, not in separate `.stamp` files.
- No GitHub token is passed; unauthenticated discovery is a few calls a week.

## Problem

The extension ships `maintainers_stats.json`, built by `generate_stats.py`
from four sources. All of it was last built by hand in March–April 2026:

| Data | Source | Cost | State today |
|---|---|---|---|
| Repo list (`repositories.txt`) | GitHub API, 3 orgs (`update_repos.py`) | a few calls | 26 listed repos have no stats; 2 stats entries are for repos no longer listed (archived) and are never removed |
| Per-repo activity (`raw_stats/`, `repositories.*`) | `maintainers prune` per repo: shallow clone, DevStats, GitHub PR comments | expensive: minutes per repo, ~300 repos, rate limited | 268 of 277 repos dated 2026-03, the rest 2026-04 |
| Leads (`users_roles`) | `kubernetes/community` `sigs.yaml` | one download | fetched only when some user has no entry; a lead who stepped down keeps the role forever |
| Affiliations (`users_affiliation`) | `cncf/gitdm` clone | one shallow clone (large) | looked up only for users missing or `Unknown`; a job change is never picked up |

Regenerating everything at once is a day of DevStats and GitHub calls, so it
doesn't happen. The fix is to spread the expensive part over time and package
the result on a regular schedule.

## Approach: one keep-fresh task, two checks

The orchestrator's keep-fresh tasks (`~/src/orchestrator/docs/plans/20261123-keep-fresh-tasks.md`)
already give us a schedule (`every`), host binding, logs, findings with
stable ids, and a fix → publish → merge cycle. Affi already has one,
`SergeyKanzhelev/affi/keep-fresh-main` (`--host oss-home-env`), running its CI
(`checks/tests.json`). The data checks join it rather than a second task:
checks are configured per repo, not per task, so a second keep-fresh task
would run every check, CI and harvest alike, twice. The cost is that a data
refresh and a CI fix share a cycle (one branch, one PR) when they coincide.

The expensive collection and the cheap packaging are separate steps on
separate schedules:

```
           daily (budgeted)                       weekly
 ┌──────────────────────────────┐      ┌──────────────────────────────┐
 │ check data-harvest           │      │ check data-fresh             │
 │  discover repos (weekly)     │      │  compare cache with main     │
 │  sigs.yaml (weekly)          │      │  stale? → red, auto_fix      │
 │  gitdm (monthly)             │      └──────────────┬───────────────┘
 │  ~12 stalest repos           │                     │ fix proposal:
 │  → ~/.local/share/affi-data  │──────cache─────────▶│ make package-data, commit
 └──────────────────────────────┘                     ▼
                                          publish → PR → merge (human)
                                          Advance: idle again
```

### The harvest cache

Collected data lives outside any worktree, on the host, in
`~/.local/share/affi-data/` (`AFFI_DATA_DIR`):

```
affi-data/
  repos.txt              discovered list
  sigs.yaml
  gitdm/                 shallow clone, updated in place
  raw_stats/<org>-<repo>.txt                one per repo, as in the repo today
  harvest.json           when discovery, sigs and gitdm last ran; per repo:
                         last success, last attempt, last error, seconds
  clones/                shallow clones of target repos (replaces /tmp/affi_stats)
  bin/maintainers        pinned build of the tool
```

It is only a cache: deleting it loses nothing that is on `main`. On its first
run the harvester seeds `raw_stats/` from the checkout's committed
`raw_stats/`, so dates continue from what is published instead of starting
over.

### Check 1: `data-harvest` — collect, on a budget

`scripts/harvest.py`, run from the check worktree (so it is always the code on
`main`, and a landed fix to the pipeline takes effect on the next run). Each run:

1. **Repo discovery**, when `repos.stamp` is older than 7 days: `update_repos.py`
   into the cache, authenticated with `gh auth token` (unauthenticated GitHub
   API allows 60 calls/hour).
2. **Leads**, when `sigs.stamp` is older than 7 days: download `sigs.yaml`.
3. **Affiliations**, when `gitdm.stamp` is older than 30 days: pull gitdm.
4. **Per-repo stats**, in this order until the budget runs out:
   1. repos in the list with no data at all (new repos);
   2. repos whose data is older than 30 days, oldest first;
   3. nothing else: a repo younger than 30 days is not re-run.

   A repo is one `maintainers prune` run, exactly as `generate_stats.py`
   does it today, its output written to `raw_stats/` in the cache. The budget
   is **75 minutes of wall time** per run (`--budget`); the check `timeout` is
   2h so a slow last repo still finishes.

With ~300 repos and a 30-day target that is ~10 repos a day, well within the
budget once the backlog of March data is worked off (the first runs simply
work through it, oldest first, at whatever rate the budget allows).

A repo that fails is recorded in `harvest.json` with its error and retried no
sooner than 3 days later, so one broken repo doesn't eat every run's budget.

**Result.** Exit 0 when there is nothing to report. Otherwise exit 1 (yellow,
`severity: warn`) with findings in `$CHECK_REPORT`: `repo.<org>.<name>` per
failing repo with the tool's error (ackable: a repo that is not in DevStats
stays acked), `stale` for repos whose data is older than 45 days (the
harvest is not keeping up, or keeps failing for them), and `step.<name>`
when discovery, sigs, gitdm, the tool install, or every attempted repo
failed. No `auto_fix`: a broken pipeline is a code fix a human starts with
**Fix**.

This is the one check that writes something, and only to its own cache; it
never writes the host's other state or any checkout.

### Check 2: `data-fresh` — package, weekly

`scripts/freshness.py`, cheap and read-only. It compares the checkout's
`maintainers_stats.json` and `repositories.txt` with the cache and fails
when the published data is behind what has been collected:

| Finding id | When |
|---|---|
| `repos:list` | the discovered list differs from `repositories.txt` (added or archived repos) |
| `repos:stats` | at least one repo has newer data in the cache than on `main` |
| `roles` | the roles built from the cached `sigs.yaml` differ from `users_roles` |
| `affiliations` | the affiliations looked up from the cached gitdm differ from `users_affiliation` |

Each id is `<kind>.<hash of the packaged content>`.

`every: 168h`, so packaging happens at most once a week however much the
harvest collected; `auto_fix: true`; `instructions`: run
`make package-data`, run `make test`, commit everything it changed as one
commit `data: refresh <n> repos, roles, affiliations (<date>)`, and change
nothing else.

### Packaging: `make package-data`

Deterministic, no network, seconds:

- copy the cached `repos.txt` to `repositories.txt` and every cached
  `raw_stats/*.txt` newer than the committed one into `raw_stats/`;
- rebuild `maintainers_stats.json` **from scratch** from `raw_stats/` for the
  repos in `repositories.txt` (archived repos drop out);
- rebuild `users_roles` fully from `sigs.yaml` (leads who stepped down lose
  the role) and `users_affiliation` fully from gitdm, for every user.

The fix agent only runs this and commits; it does no collection, so a
proposal is quick and cheap. The proposal's diff is reviewable: `raw_stats/`
and the JSON change, nothing else.

### One cycle

```
idle ── data-fresh fails (weekly) ──▶ auto_fix: make package-data ──merge──▶ fixing
  ▲                                                                            │ publish → PR
  │                                                                            ▼
  └──────────── Advance: the data commit is on main, branch reset ◀── PR merged (CI: make test)
```

The harvest keeps running while the task is fixing; data collected after the
proposal goes into the next week's package. A PR left unmerged for more than
a week is fine: the next `data-fresh` run looks at the head, which already has
the last package, and only fails again once newer data piles up behind it.

### Releasing to the stores

Out of scope for the task: publishing to the Chrome Web Store and AMO stays a
human step, and users only see new data after it. Later, a third check could
turn yellow when `main`'s data is more than 30 days newer than the last
release tag (`release:due`).

## Schedule summary

| What | How often | Where |
|---|---|---|
| Repo discovery | weekly | `data-harvest` |
| New repos' stats | on the next harvest after discovery | `data-harvest`, first in line |
| Per-repo stats | each repo every 30 days, ~10/day, 75 min budget | `data-harvest`, daily |
| Leads (`sigs.yaml`) | weekly | `data-harvest` fetch, applied at packaging |
| Affiliations (gitdm) | monthly | `data-harvest` fetch, applied at packaging |
| Packaging into the repo | weekly, when anything changed | `data-fresh` → fix proposal → PR |
| Store release | by hand | — |

## Configuration

In env, `myoverlay/repos/SergeyKanzhelev/affi/checks/`:

`data-harvest.json`
```json
{
  "role": "keep-fresh",
  "run": "python3 scripts/harvest.py --budget 75m",
  "every": "24h",
  "timeout": "2h",
  "severity": "warn",
  "instructions": "The harvest collects into $AFFI_DATA_DIR (default ~/.local/share/affi-data). Fix the pipeline code in scripts/ or generate_stats.py; never edit or delete the cache."
}
```

`data-fresh.json`
```json
{
  "role": "keep-fresh",
  "run": "python3 scripts/freshness.py",
  "every": "168h",
  "auto_fix": true,
  "instructions": "Run `make package-data`, then `make test`. Commit every file it changed as one commit `data: refresh …`. Do not collect data, edit the generated files by hand, or change code."
}
```

The scripts are tracked in affi itself (our repo), not in the overlay.

## Code changes in affi

1. `scripts/harvest.py`: the scheduler above; reuses `generate_stats.py`'s
   collection (`install_tool`, `clone_repo`, the `prune` call) with paths from
   `AFFI_DATA_DIR` instead of `/tmp/affi_stats` and `raw_stats/`.
2. Pin `maintainers` (`MAINTAINERS_VERSION` in `generate_stats.py`) instead of
   `@latest`, so a tool change arrives as a reviewed PR, not silently in a run.
3. `generate_stats.py`: split collection from building. Building becomes a
   pure function of `raw_stats/`, `repositories.txt`, `sigs.yaml` and gitdm,
   and replaces roles and affiliations instead of filling in missing ones.
   `make generate-stats` keeps working by hand.
4. `scripts/freshness.py` and `make package-data`.
5. README "Statistics Generation": how the data stays fresh, where the cache
   is.

## Open questions

1. **GitHub token for `maintainers`** (not done; see Status). It reads PR comments from the GitHub
   API; the harvest should pass `GITHUB_TOKEN=$(gh auth token)` from the host's
   agent identity. To confirm the tool reads it and what its call volume per
   repo is (that may lower the daily budget).
2. **Merging the weekly PR.** As designed, a human merges it (CI runs
   `make test` on it). If that becomes a chore, the data PR could land
   automatically when CI is green and only data files changed.
3. **30-day target.** `--period-devstats=y` is a one-year window, so a month
   moves the numbers little. A shorter target for a few heavy repos
   (kubernetes/kubernetes) is easy to add later as a per-repo override; not
   needed now.

## Implementation steps

### Task 1: split collection from building (affi)
- Pure builder from `raw_stats/` + list + `sigs.yaml` + gitdm; full replace
  of roles and affiliations; archived repos drop out.
- Pin `maintainers`.
- Test: building twice from the same inputs gives identical JSON; a role
  removed from `sigs.yaml` is removed from the output.

### Task 2: harvest and freshness scripts (affi)
- `scripts/harvest.py` with stamps, ordering, budget, failure backoff,
  seeding from the checkout; `scripts/freshness.py`; `make package-data`.
- Run once by hand on oss-home-env with a small budget against a fresh
  `AFFI_DATA_DIR` to confirm seeding and ordering.

### Task 3: orchestrator wiring (env)
- The two check files in `myoverlay/repos/SergeyKanzhelev/affi/checks/`.
- Push them only after Task 1 and 2 are on affi's `main`: before that,
  `data-fresh` fails on a missing script and auto-fix would try to write it.
  They run on the existing `keep-fresh-main` task; `tests.json` gains the
  Python step `ci.yml` gained.
- Watch the first week: harvest working through the March backlog, the first
  package PR.
