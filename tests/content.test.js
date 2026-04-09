const { fetchOwnersHierarchy, parseGitHubBlobContext } = require('../content.js');
// Mocking global functions used in fetchOwnersHierarchy
global.shouldTruncate = require('../parser.js').shouldTruncate;
global.jsyaml = require('../js-yaml.min.js');

describe('Affi Content Script - Hierarchy logic', () => {

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete global.fetch;
  });

  describe('fetchOwnersHierarchy', () => {
    test('stops fetching when no_parent_owners is true', async () => {
      // Mock fetch responses
      fetch.mockImplementation((url) => {
          if (url.includes('pkg/probe/OWNERS')) {
              return Promise.resolve({ ok: true, text: () => Promise.resolve('approvers:\n- user1') });
          }
          if (url.includes('pkg/OWNERS')) {
              return Promise.resolve({ ok: true, text: () => Promise.resolve('no_parent_owners: true\napprovers:\n- user2') });
          }
          if (url.includes('/OWNERS')) {
              return Promise.resolve({ ok: true, text: () => Promise.resolve('approvers:\n- root') });
          }
          return Promise.resolve({ ok: false });
      });

      const result = await fetchOwnersHierarchy('https://raw.githubusercontent.com/u/r/b', 'pkg/probe/OWNERS');
      
      // Should contain root, pkg/OWNERS and pkg/probe/OWNERS
      expect(result.files.length).toBe(3);
      expect(result.truncated).toBe(true);
      expect(result.files[0].path).toBe('/');
      expect(result.files[1].path).toBe('pkg');
      expect(result.files[2].path).toBe('pkg/probe');
    });
  });

  describe('parseGitHubBlobContext', () => {
    test('parses a standard blob URL without embedded data', () => {
      const result = parseGitHubBlobContext('/kubernetes/kubernetes/blob/main/pkg/probe/OWNERS');

      expect(result).toEqual({
        owner: 'kubernetes',
        repo: 'kubernetes',
        branch: 'main',
        filePath: 'pkg/probe/OWNERS'
      });
    });

    test('prefers the branch selector in the DOM when a slash branch is shown in the UI', () => {
      const doc = {
        querySelector: jest.fn((selector) => {
          if (selector.includes('button[data-testid="anchor-button"]')) {
            return {
              getAttribute: jest.fn().mockReturnValue('feature/foo branch')
            };
          }
          return null;
        })
      };

      const result = parseGitHubBlobContext('/kubernetes/kubernetes/blob/feature/foo/pkg/probe/OWNERS', doc);

      expect(result).toEqual({
        owner: 'kubernetes',
        repo: 'kubernetes',
        branch: 'feature/foo',
        filePath: 'pkg/probe/OWNERS'
      });
    });

    test('parses tag labels from the DOM ref selector', () => {
      const doc = {
        querySelector: jest.fn((selector) => {
          if (selector.includes('button[data-testid="anchor-button"]')) {
            return {
              getAttribute: jest.fn().mockReturnValue('release-1.35/foo tag')
            };
          }
          return null;
        })
      };

      const result = parseGitHubBlobContext('/kubernetes/kubernetes/blob/release-1.35/foo/OWNERS_ALIASES', doc);

      expect(result).toEqual({
        owner: 'kubernetes',
        repo: 'kubernetes',
        branch: 'release-1.35/foo',
        filePath: 'OWNERS_ALIASES'
      });
    });

    test('prefers embedded data when the branch name contains a slash', () => {
      const doc = {
        querySelector: jest.fn((selector) => {
          if (selector.includes('button[data-testid="anchor-button"]')) {
            return null;
          }
          if (selector === 'script[data-target="react-app.embeddedData"]') {
            return {
              textContent: JSON.stringify({
                payload: {
                  codeViewLayoutRoute: {
                    repo: {
                      ownerLogin: 'kubernetes',
                      name: 'kubernetes'
                    }
                  },
                  codeViewBlobLayoutRoute: {
                    refInfo: {
                      name: 'feature/foo'
                    },
                    path: 'pkg/probe/OWNERS'
                  }
                }
              })
            };
          }
          return null;
        })
      };

      const result = parseGitHubBlobContext('/kubernetes/kubernetes/blob/feature/foo/pkg/probe/OWNERS', doc);

      expect(result).toEqual({
        owner: 'kubernetes',
        repo: 'kubernetes',
        branch: 'feature/foo',
        filePath: 'pkg/probe/OWNERS'
      });
    });

    test('parses OWNERS_ALIASES from embedded data when the branch name contains a slash', () => {
      const doc = {
        querySelector: jest.fn((selector) => {
          if (selector.includes('button[data-testid="anchor-button"]')) {
            return null;
          }
          if (selector === 'script[data-target="react-app.embeddedData"]') {
            return {
              textContent: JSON.stringify({
                payload: {
                  codeViewLayoutRoute: {
                    repo: {
                      ownerLogin: 'kubernetes',
                      name: 'kubernetes'
                    }
                  },
                  codeViewBlobLayoutRoute: {
                    refInfo: {
                      name: 'release-1.35/foo'
                    },
                    path: 'OWNERS_ALIASES'
                  }
                }
              })
            };
          }
          return null;
        })
      };

      const result = parseGitHubBlobContext('/kubernetes/kubernetes/blob/release-1.35/foo/OWNERS_ALIASES', doc);

      expect(result).toEqual({
        owner: 'kubernetes',
        repo: 'kubernetes',
        branch: 'release-1.35/foo',
        filePath: 'OWNERS_ALIASES'
      });
    });
  });

});
