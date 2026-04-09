const { shouldTruncate, parseYamlAliases, analyzeOwnersLine } = require('../parser.js');
// Mocking js-yaml for testing environment
global.jsyaml = require('../js-yaml.min.js');

describe('Affi Parser Logic', () => {
  
  describe('shouldTruncate', () => {
    test('identifies top-level no_parent_owners: true', () => {
      const content = "no_parent_owners: true\napprovers:\n- user1";
      expect(shouldTruncate(content)).toBe(true);
    });

    test('identifies nested no_parent_owners under options', () => {
      const content = "options:\n  no_parent_owners: true\napprovers:\n- user2";
      expect(shouldTruncate(content)).toBe(true);
    });

    test('handles string value "true"', () => {
      const content = "options:\n  no_parent_owners: \"true\"";
      expect(shouldTruncate(content)).toBe(true);
    });

    test('returns false when flag is missing', () => {
      const content = "approvers:\n- user3";
      expect(shouldTruncate(content)).toBe(false);
    });
  });

  describe('parseYamlAliases', () => {
    test('correctly parses aliases section', () => {
      const content = "aliases:\n  group1:\n  - user1\n  - user2";
      const result = parseYamlAliases(content);
      expect(result).toHaveProperty('group1');
      expect(result.group1).toEqual(['user1', 'user2']);
    });

    test('returns empty object for missing aliases', () => {
      const content = "approvers:\n- user1";
      expect(parseYamlAliases(content)).toEqual({});
    });

    test('returns _parseError object on invalid YAML', () => {
      const content = "aliases: {\n  broken yaml:";
      const result = parseYamlAliases(content);
      expect(result._parseError).toBe(true);
      expect(typeof result._parseErrorMessage).toBe('string');
      expect(result._parseErrorMessage.length).toBeGreaterThan(0);
    });
  });

  describe('analyzeOwnersLine', () => {
    test('identifies a list item', () => {
      const line = "  - user1";
      const analysis = analyzeOwnersLine(line);
      expect(analysis.isListItem).toBe(true);
      expect(analysis.baseIndent).toBe("  ");
      expect(analysis.tokens).toContain("user1");
    });

    test('identifies an alias key', () => {
      const line = "approvers:";
      const analysis = analyzeOwnersLine(line);
      expect(analysis.isAliasKey).toBe(true);
      expect(analysis.tokens).toContain("approvers");
    });

    test('identifies a labels block', () => {
      const line = "labels:";
      const analysis = analyzeOwnersLine(line);
      expect(analysis.isLabelsBlock).toBe(true);
    });

    test('populates tokens for list items', () => {
      const line = "  - user1";
      const analysis = analyzeOwnersLine(line);
      expect(analysis.tokens).toContain("user1");
    });

    test('populates tokens for list items with slashes (labels)', () => {
      const line = "  - sig/release";
      const analysis = analyzeOwnersLine(line);
      expect(analysis.tokens).toContain("sig");
      expect(analysis.tokens).toContain("/");
      expect(analysis.tokens).toContain("release");
    });

    test('ignores comments', () => {
      const line = "# this is a comment";
      const analysis = analyzeOwnersLine(line);
      expect(analysis.isListItem).toBe(false);
      expect(analysis.isAliasKey).toBe(false);
    });

    test('handles empty lines', () => {
      const line = "";
      const analysis = analyzeOwnersLine(line);
      expect(analysis.isListItem).toBe(false);
      expect(analysis.isAliasKey).toBe(false);
    });

    test('handles inline comments', () => {
      const line = "  - user1 # some comment";
      const analysis = analyzeOwnersLine(line);
      expect(analysis.isListItem).toBe(true);
      expect(analysis.tokens).toContain("user1");
      expect(analysis.tokens).toContain("# some comment");
      // Check that words in comment are not separate tokens
      expect(analysis.tokens).not.toContain("some");
    });
  });

});
