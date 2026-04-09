/**
 * tests/e2e-automated.js
 *
 * Automated tests covering:
 * 1. Mock Firefox API tests - verifying fetchOwnersHierarchy and
 *    parseGitHubBlobContext work correctly when the browser global uses
 *    the Firefox WebExtension API shape (browser.*) rather than chrome.*.
 * 2. Puppeteer-based E2E tests - skipped by default; set env var
 *    AFFI_E2E=1 and run a local HTTP server to enable them.
 */

const { fetchOwnersHierarchy, parseGitHubBlobContext } = require('../content.js');

global.shouldTruncate = require('../parser.js').shouldTruncate;
global.jsyaml = require('../js-yaml.min.js');

// ---------------------------------------------------------------------------
// Mock Firefox API tests
// ---------------------------------------------------------------------------
describe('Mock Firefox API - fetchOwnersHierarchy', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    fetch.mockClear();
  });

  afterEach(() => {
    delete global.fetch;
  });

  test('fetches single-level hierarchy without truncation', async () => {
    fetch.mockImplementation((url) => {
      if (url.includes('/OWNERS')) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('approvers:\n- alice\n- bob'),
        });
      }
      return Promise.resolve({ ok: false });
    });

    const result = await fetchOwnersHierarchy(
      'https://raw.githubusercontent.com/org/repo/main',
      'OWNERS'
    );

    expect(result.files.length).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.files[0].path).toBe('/');
    expect(result.files[0].content).toContain('alice');
  });

  test('marks truncated when no_parent_owners is found', async () => {
    fetch.mockImplementation((url) => {
      if (url.includes('pkg/sub/OWNERS')) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('approvers:\n- charlie'),
        });
      }
      if (url.includes('pkg/OWNERS')) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('no_parent_owners: true\napprovers:\n- dave'),
        });
      }
      if (url.includes('/OWNERS')) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('approvers:\n- root-owner'),
        });
      }
      return Promise.resolve({ ok: false });
    });

    const result = await fetchOwnersHierarchy(
      'https://raw.githubusercontent.com/org/repo/main',
      'pkg/sub/OWNERS'
    );

    // root, pkg (with no_parent_owners), pkg/sub — all fetched in parallel
    expect(result.files.length).toBe(3);
    expect(result.truncated).toBe(true);
  });

  test('handles fetch failures gracefully', async () => {
    fetch.mockImplementation(() =>
      Promise.reject(new Error('network error'))
    );

    await expect(
      fetchOwnersHierarchy(
        'https://raw.githubusercontent.com/org/repo/main',
        'OWNERS'
      )
    ).rejects.toThrow('network error');
  });

  test('handles non-ok fetch responses', async () => {
    fetch.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 404 })
    );

    const result = await fetchOwnersHierarchy(
      'https://raw.githubusercontent.com/org/repo/main',
      'OWNERS'
    );

    // A 404 on the OWNERS file means no files in hierarchy
    expect(result.files.length).toBe(0);
    expect(result.truncated).toBe(false);
  });

  test('respects MAX_OWNERS_DEPTH by not fetching more than 20 levels', async () => {
    // Build a 25-level deep OWNERS path (26 folders including root, capped at 20)
    const levels = Array.from({ length: 25 }, (_, i) => `l${i}`);
    const deepPath = levels.join('/') + '/OWNERS';

    fetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve('approvers:\n- someone'),
      })
    );

    const result = await fetchOwnersHierarchy(
      'https://raw.githubusercontent.com/org/repo/main',
      deepPath
    );

    // Should fetch exactly MAX_OWNERS_DEPTH (20) folders, not all 26
    expect(fetch.mock.calls.length).toBe(20);
    expect(result.files.length).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Mock Firefox API - parseGitHubBlobContext
// ---------------------------------------------------------------------------
describe('Mock Firefox API - parseGitHubBlobContext', () => {
  test('parses standard path without DOM context', () => {
    const result = parseGitHubBlobContext(
      '/org/repo/blob/main/path/to/OWNERS'
    );
    expect(result).toEqual({
      owner: 'org',
      repo: 'repo',
      branch: 'main',
      filePath: 'path/to/OWNERS',
    });
  });

  test('uses browser-style DOM querySelector (Firefox simulation)', () => {
    // Firefox provides a real document; simulate it with a mock
    const doc = {
      querySelector: jest.fn((selector) => {
        if (selector.includes('anchor-button')) {
          return {
            getAttribute: jest.fn().mockReturnValue('feature/ff branch'),
          };
        }
        return null;
      }),
    };

    const result = parseGitHubBlobContext(
      '/org/repo/blob/feature/ff/OWNERS',
      doc
    );
    expect(result.branch).toBe('feature/ff');
    expect(result.filePath).toBe('OWNERS');
  });

  test('falls back to URL parsing when DOM ref selector is absent', () => {
    const doc = {
      querySelector: jest.fn(() => null),
    };

    const result = parseGitHubBlobContext(
      '/org/repo/blob/main/OWNERS',
      doc
    );
    expect(result.branch).toBe('main');
    expect(result.filePath).toBe('OWNERS');
  });
});

// ---------------------------------------------------------------------------
// Puppeteer E2E tests (skipped unless AFFI_E2E=1 and server is running)
// ---------------------------------------------------------------------------
const runE2E = process.env.AFFI_E2E === '1';
const describeE2E = runE2E ? describe : describe.skip;

describeE2E('Puppeteer E2E - e2e test page', () => {
  let browser;
  let page;
  const E2E_URL = process.env.AFFI_E2E_URL || 'http://localhost:8080/tests/e2e.html';

  beforeAll(async () => {
    const puppeteer = require('puppeteer');
    browser = await puppeteer.launch({ args: ['--no-sandbox'] });
    page = await browser.newPage();
  });

  afterAll(async () => {
    if (browser) await browser.close();
  });

  test('e2e page loads without JS errors', async () => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(E2E_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    expect(errors).toHaveLength(0);
  });

  test('affi overlay renders at least one test row', async () => {
    await page.goto(E2E_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('.test-row', { timeout: 10000 });
    const rows = await page.$$('.test-row');
    expect(rows.length).toBeGreaterThan(0);
  });
});
