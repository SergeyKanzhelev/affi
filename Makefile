.PHONY: test install serve sync-firefox dist-chrome dist-firefox dist screenshot

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

test:
	npm test

update-repos:
	python3 update_repos.py > $(REPOS_FILE).tmp
	mv $(REPOS_FILE).tmp $(REPOS_FILE)

generate-stats:
	@if [ -n "$(REPO)" ]; then \
		python3 generate_stats.py --repo $(REPO); \
	else \
		for repo in $(REPOS); do \
			python3 generate_stats.py --repo $$repo; \
		done; \
	fi

generate-new-stats:
	@for repo in $(REPOS); do \
		if ! grep -q "\"$$repo\":" maintainers_stats.json; then \
			echo "Generating stats for new repo: $$repo"; \
			python3 generate_stats.py --repo $$repo; \
		fi \
	done

parse-stats:
	@if [ -n "$(REPO)" ]; then \
		python3 generate_stats.py --repo $(REPO) --parse-only; \
	else \
		for repo in $(REPOS); do \
			python3 generate_stats.py --repo $$repo --parse-only; \
		done; \
	fi

dist-chrome:
	rm -f affi-chrome.zip
	zip -r affi-chrome.zip manifest.json content.js ui.js parser.js styles.css js-yaml.min.js maintainers_stats.json icons/

dist-firefox: sync-firefox
	rm -f affi-firefox.zip
	cd firefox && zip -r ../affi-firefox.zip manifest.json content.js ui.js parser.js styles.css js-yaml.min.js maintainers_stats.json icons/

dist: dist-chrome dist-firefox
