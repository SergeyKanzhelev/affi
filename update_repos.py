import urllib.request
import json
import sys

ORGS = ["kubernetes", "kubernetes-sigs", "kubernetes-csi"]

def get_repos(org):
    repos = []
    page = 1
    while True:
        url = f"https://api.github.com/orgs/{org}/repos?page={page}&per_page=100"
        try:
            req = urllib.request.Request(url)
            # Use a User-Agent to avoid being blocked by GitHub API
            req.add_header('User-Agent', 'Affi-Stats-Generator')
            with urllib.request.urlopen(req) as response:
                data = json.loads(response.read().decode())
                if not data:
                    break
                for repo in data:
                    if not repo['archived']:
                        repos.append(f"{org}/{repo['name']}")
                page += 1
        except Exception as e:
            print(f"Error fetching {org}: {e}", file=sys.stderr)
            break
    return repos

def main():
    all_repos = []
    for org in ORGS:
        all_repos.extend(get_repos(org))
    
    for repo in sorted(all_repos):
        print(repo)

if __name__ == "__main__":
    main()
