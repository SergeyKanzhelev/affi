(function() {
  console.log('Affi extension initialized');

  let lastUrl = location.href;

  const observer = new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      onUrlChange();
    }
  });

  observer.observe(document, { subtree: true, childList: true });

  function onUrlChange() {
    const existing = document.getElementById('affi-overlay');
    if (existing) {
        existing.remove();
    }
    
    // Brief delay to allow GitHub to finish rendering the new page
    setTimeout(init, 500);
  }

  async function init() {
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    // Expecting /owner/repo/blob/branch/path
    if (pathParts.length < 5) return; 

    const owner = pathParts[0];
    const repo = pathParts[1];
    const branch = pathParts[3];
    const filePath = pathParts.slice(4).join('/');
    const isOwnersFile = filePath.endsWith('OWNERS');
    const isAliasesFile = filePath.endsWith('OWNERS_ALIASES');

    if (!isOwnersFile && !isAliasesFile) return;

    console.log('Affi: Identified OWNERS file, fetching data...');

    const rawBaseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`;
    const aliasesUrl = `${rawBaseUrl}/OWNERS_ALIASES`;
    const currentFileUrl = `${rawBaseUrl}/${filePath}`;

    try {
      const [aliasesResp, currentFileResp] = await Promise.all([
        fetch(aliasesUrl).then(r => r.ok ? r.text() : ''),
        fetch(currentFileUrl).then(r => r.text())
      ]);

      const aliasesData = aliasesResp ? parseYamlAliases(aliasesResp) : {};
      renderOverlay(currentFileResp, aliasesData);
    } catch (err) {
      console.error('Affi: Error fetching files', err);
    }
  }

  function parseYamlAliases(content) {
    try {
      const doc = jsyaml.load(content);
      if (doc && doc.aliases) {
        return doc.aliases;
      }
    } catch (e) {
      console.error('Affi: Error parsing YAML', e);
    }
    return {};
  }

  function renderOverlay(content, aliases) {
    const existing = document.getElementById('affi-overlay');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'affi-overlay';
    container.className = 'affi-collapsed'; // Start collapsed by default
    
    const toggle = document.createElement('div');
    toggle.id = 'affi-toggle';
    toggle.innerText = 'Affi';
    toggle.onclick = (e) => {
        e.stopPropagation();
        container.classList.toggle('affi-collapsed');
    };

    const header = document.createElement('div');
    header.id = 'affi-header';
    header.innerText = 'Affi - Kubernetes OWNERS';

    const contentDiv = document.createElement('div');
    contentDiv.id = 'affi-content';
const lines = content.split('\n');
lines.forEach(line => {
  const lineDiv = document.createElement('div');
  lineDiv.className = 'affi-line';

  const trimmed = line.trim();
  // Only expand aliases if they are part of a list item (starts with '- ')
  // or if it's an alias definition key in OWNERS_ALIASES (ends with ':')
  const isListItem = trimmed.startsWith('- ');
  const isAliasKey = trimmed.endsWith(':') && !trimmed.startsWith('#');

  if (isListItem || isAliasKey) {
    const indentMatch = line.match(/^(\s*)/);
    const baseIndent = indentMatch ? indentMatch[1] : '';
    const subIndent = baseIndent + '  ';

    const parts = line.split(/([\w-]+)/);
    parts.forEach(part => {
      if (aliases[part]) {
        const span = document.createElement('span');
        span.className = 'affi-alias';
        span.innerText = part;

        const btn = document.createElement('button');
        btn.className = 'affi-expand-btn';
        btn.innerText = ' [+]';
        btn.onclick = (e) => {
          e.stopPropagation();
          const next = btn.nextElementSibling;
          if (next && next.classList.contains('affi-expanded-list')) {
            next.remove();
            btn.innerText = ' [+]';
          } else {
            const list = document.createElement('div');
            list.className = 'affi-expanded-list';
            const members = aliases[part];
            members.forEach(member => {
              const item = document.createElement('div');
              item.innerText = `${subIndent}- ${member}`;
              list.appendChild(item);
            });
            btn.after(list);
            btn.innerText = ' [-]';
          }
        };
        lineDiv.appendChild(span);
        lineDiv.appendChild(btn);
      } else {
        lineDiv.appendChild(document.createTextNode(part));
      }
    });
  } else {
    lineDiv.appendChild(document.createTextNode(line));
  }
  contentDiv.appendChild(lineDiv);
});

    container.appendChild(toggle);
    container.appendChild(header);
    container.appendChild(contentDiv);
    document.body.appendChild(container);
  }

  // Initial call
  init();

})();
