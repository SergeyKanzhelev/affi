const { fetchOwnersHierarchy } = require('../content.js');
// Mocking global functions used in fetchOwnersHierarchy
global.shouldTruncate = require('../parser.js').shouldTruncate;
global.jsyaml = require('../js-yaml.min.js');

// Mock fetch
global.fetch = jest.fn();

describe('Affi Content Script - Hierarchy logic', () => {

  beforeEach(() => {
    fetch.mockClear();
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
      
      // Should contain pkg/probe/OWNERS and pkg/OWNERS, but NOT root OWNERS
      expect(result.files.length).toBe(2);
      expect(result.truncated).toBe(true);
      expect(result.files[0].path).toBe('pkg');
      expect(result.files[1].path).toBe('pkg/probe');
    });
  });

});
