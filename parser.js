// parser.js - Pure logic for parsing OWNERS and aliases files

function shouldTruncate(content) {
  try {
    const doc = jsyaml.load(content);
    if (!doc) return false;
    
    // Check top level
    if (doc.no_parent_owners === true || String(doc.no_parent_owners).toLowerCase() === 'true') {
      return true;
    }
    
    // Check under options section
    if (doc.options && (doc.options.no_parent_owners === true || String(doc.options.no_parent_owners).toLowerCase() === 'true')) {
      return true;
    }
  } catch (e) {
    console.warn('Affi: Could not parse OWNERS YAML for truncation check', e);
  }
  return false;
}

function parseYamlAliases(content) {
  try {
    const doc = jsyaml.load(content);
    if (doc && doc.aliases) return doc.aliases;
  } catch (e) {
    console.error('Affi: Error parsing YAML', e);
  }
  return {};
}

function analyzeOwnersLine(line) {
  const trimmed = line.trim();
  const isListItem = trimmed.startsWith('- ');
  const isAliasKey = trimmed.endsWith(':') && !trimmed.startsWith('#');
  
  let baseIndent = '';
  let subIndent = '';
  let tokens = [];

  if (isListItem || isAliasKey) {
    const indentMatch = line.match(/^(\s*)/);
    baseIndent = indentMatch ? indentMatch[1] : '';
    subIndent = baseIndent + '  ';
    tokens = line.split(/([\w-]+)/);
  }

  return {
    trimmed,
    isListItem,
    isAliasKey,
    baseIndent,
    subIndent,
    tokens
  };
}

// Export for Node/Jest
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    shouldTruncate,
    parseYamlAliases,
    analyzeOwnersLine
  };
}
