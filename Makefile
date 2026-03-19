.PHONY: test install

install:
	npm install

REPO ?= kubernetes/kubernetes

test:
	npm test

generate-stats:
	python3 generate_stats.py --repo $(REPO)

parse-stats:
	python3 generate_stats.py --repo $(REPO) --parse-only
