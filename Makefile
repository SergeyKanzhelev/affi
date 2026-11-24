.PHONY: test test-py install serve sync-firefox dist-chrome dist-firefox dist screenshot update-repos generate-stats generate-new-stats parse-stats harvest package-data check-fresh

install:
	npm install

serve:
	npm run serve

screenshot:
	npm run screenshot

sync-firefox:
	@mkdir -p firefox/icons
	rsync -av ./ firefox/ --exclude 'firefox' --exclude 'node_modules' --exclude 'raw_stats' --exclude 'tests' --exclude '.git' --exclude 'Makefile' --exclude 'package.json' --exclude 'package-lock.json' --exclude 'generate_stats.py' --exclude 'README.md' --exclude 'LICENSE' --exclude 'PRIVACY.md' --exclude 'screenshot-*.png' --exclude 'manifest.json'
	cp firefox/manifest.json.src firefox/manifest.json

REPOS_FILE = repositories.txt
REPOS = $(shell cat $(REPOS_FILE))

REPO ?=

test: test-py
	npm test

update-repos:
	python3 update_repos.py > $(REPOS_FILE).tmp
	mv $(REPOS_FILE).tmp $(REPOS_FILE)

# Collect by hand: one repo (REPO=org/name) or every listed repo, then rebuild.
generate-stats:
	@if [ -n "$(REPO)" ]; then \
		python3 generate_stats.py --repo $(REPO); \
	else \
		python3 generate_stats.py $(foreach r,$(REPOS),--repo $(r)); \
	fi

generate-new-stats:
	@new=""; for repo in $(REPOS); do \
		if ! grep -q "\"$$repo\":" maintainers_stats.json; then new="$$new --repo $$repo"; fi; \
	done; \
	if [ -n "$$new" ]; then python3 generate_stats.py $$new; else echo "No new repos."; fi

# Rebuild maintainers_stats.json from raw_stats/ without collecting.
parse-stats:
	python3 generate_stats.py --build

# Keep-fresh: collect into $$AFFI_DATA_DIR on a budget, then package it into the repo.
harvest:
	python3 scripts/harvest.py

package-data:
	python3 scripts/package_data.py

check-fresh:
	python3 scripts/freshness.py

test-py:
	python3 -m unittest discover -s tests -p 'test_*.py'

dist-chrome:
	rm -f affi-chrome.zip
	zip -r affi-chrome.zip manifest.json content.js ui.js parser.js styles.css js-yaml.min.js maintainers_stats.json icons/

dist-firefox: sync-firefox
	rm -f affi-firefox.zip
	cd firefox && zip -r ../affi-firefox.zip manifest.json content.js ui.js parser.js styles.css js-yaml.min.js maintainers_stats.json icons/

dist: dist-chrome dist-firefox
