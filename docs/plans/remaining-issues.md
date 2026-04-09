---
title: Remaining Issues
branch: fix/remaining-issues
---

# Implementation Plan: Remaining Issues

Addressing security, reliability, and maintenance gaps.

## Tasks

- [x] **Implement Content Security Policy**
  - Add `content_security_policy` to both `manifest.json` and `firefox/manifest.json`.
  - **Validation:** grep -q "content_security_policy" manifest.json

- [ ] **Fix navigation race condition**
  - Implement a monotonic navigation counter `navSeq` in `content.js` to prevent stale renders.
  - **Validation:** grep -q "navSeq" content.js

- [ ] **Limit OWNERS hierarchy fetch depth**
  - Add `MAX_OWNERS_DEPTH = 20` to `content.js` and truncate the folder list before fetching.
  - **Validation:** grep -q "MAX_OWNERS_DEPTH" content.js

- [ ] **Set Firefox MV3 minimum version**
  - Add `strict_min_version: "131.0"` to `firefox/manifest.json` and update `README.md`.
  - **Validation:** grep -q "131.0" firefox/manifest.json

- [ ] **Fix dependency versions**
  - Update `jest` versions in `package.json` to valid stable versions and run `npm install`.
  - **Validation:** npm list jest

- [ ] **Improve Error Handling**
  - Add user-facing feedback for fetch failures and YAML parse errors in `content.js` and `ui.js`.
  - **Validation:** grep -q "error: true" content.js && grep -q "_parseError" parser.js

- [ ] **Address Testing Gaps**
  - Add Puppeteer-based E2E tests and mock Firefox API tests.
  - **Validation:** ls tests/e2e-automated.js && npm test

- [ ] **Update Privacy Policy**
  - Correct `PRIVACY.md` to accurately reflect network calls to GitHub's raw content servers.
  - **Validation:** grep -q "raw.githubusercontent.com" PRIVACY.md

- [ ] **Harden CI/CD**
  - Add `npm audit` and automated E2E tests to GitHub Actions.
  - **Validation:** ls .github/workflows/ci.yml
- [ ] **Fix Firefox API incompatibility**
  - Add a compatibility shim `const runtimeAPI = (typeof chrome !== 'undefined' && chrome.runtime) ? chrome : browser;` to `content.js` and use it for `getURL`.
  - **Validation:** grep -q "runtimeAPI" content.js

- [ ] **Add fetch timeout via AbortController**
  - Implement `fetchWithTimeout` helper and use it for all fetch calls in `content.js`.
  - **Validation:** grep -q "fetchWithTimeout" content.js

- [ ] **Replace innerHTML with safe DOM construction**
  - Replace `innerHTML` usage in `ui.js` (lines 421, 431) with `document.createTextNode` and `document.createElement`.
  - **Validation:** grep -n "innerHTML" ui.js | wc -l | grep -q "0"

- [ ] **Remove noisy console.log**
  - Remove or change to `console.debug` the "Affi extension initialized" log in `content.js`.
  - **Validation:** ! grep -q "Affi extension initialized" content.js
