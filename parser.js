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
  const isComment = trimmed.startsWith('#');
  const isAliasKey = trimmed.endsWith(':') && !isComment;
  const isEmeritusBlock = trimmed === 'emeritus_reviewers:' || trimmed === 'emeritus_approvers:';
  
  let baseIndent = '';
  let subIndent = '';
  let tokens = [];

  if (!isComment && (isListItem || isAliasKey)) {
    const indentMatch = line.match(/^(\s*)/);
    baseIndent = indentMatch ? indentMatch[1] : '';
    subIndent = baseIndent + '  ';
    
    // Strip inline comments before tokenizing
    const lineWithoutComment = line.split('#')[0];
    tokens = lineWithoutComment.split(/([\w-]+)/);
    
    // Add the comment part back as a single text token if it exists
    if (line.includes('#')) {
        const commentIndex = line.indexOf('#');
        tokens.push(line.substring(commentIndex));
    }
  }

  return {
    trimmed,
    isListItem,
    isAliasKey,
    isEmeritusBlock,
    isComment,
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
