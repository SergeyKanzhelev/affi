"""Print the non-archived repositories of the Kubernetes GitHub orgs, sorted.

Fails (non-zero, nothing printed) when any page cannot be fetched, so a
network error never produces a partial list that would drop repos.
"""

import json
import sys
import urllib.request

ORGS = ["kubernetes", "kubernetes-sigs", "kubernetes-csi"]


def get_repos(org):
    repos = []
    page = 1
    while True:
        url = f"https://api.github.com/orgs/{org}/repos?page={page}&per_page=100"
        req = urllib.request.Request(url, headers={"User-Agent": "Affi-Stats-Generator"})
        with urllib.request.urlopen(req, timeout=60) as response:
            data = json.loads(response.read().decode())
        if not data:
            break
        repos.extend(f"{org}/{repo['name']}" for repo in data if not repo["archived"])
        page += 1
    return repos


def discover():
    repos = []
    for org in ORGS:
        org_repos = get_repos(org)
        if not org_repos:
            raise RuntimeError(f"no repositories found for {org}")
        repos.extend(org_repos)
    return sorted(repos)


def main():
    try:
        repos = discover()
    except Exception as e:
        print(f"Error discovering repositories: {e}", file=sys.stderr)
        return 1
    for repo in repos:
        print(repo)
    return 0


if __name__ == "__main__":
    sys.exit(main())
