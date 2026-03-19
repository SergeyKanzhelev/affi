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
    setTimeout(init, 500);
  }

  async function init() {
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    if (pathParts.length < 5) return; 

    const owner = pathParts[0];
    const repo = pathParts[1];
    const branch = pathParts[3];
    const filePath = pathParts.slice(4).join('/');
    const isOwnersFile = filePath.endsWith('OWNERS');
    const isAliasesFile = filePath.endsWith('OWNERS_ALIASES');

    if (!isOwnersFile && !isAliasesFile) return;

    const rawBaseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`;
    const aliasesUrl = `${rawBaseUrl}/OWNERS_ALIASES`;

    try {
      const aliasesResp = await fetch(aliasesUrl).then(r => r.ok ? r.text() : '');
      const aliasesData = aliasesResp ? parseYamlAliases(aliasesResp) : {};

      const ownersFiles = await fetchOwnersHierarchy(rawBaseUrl, filePath);
      renderOverlay(ownersFiles, aliasesData);
    } catch (err) {
      console.error('Affi: Error fetching data', err);
    }
  }

  async function fetchOwnersHierarchy(baseUrl, currentPath) {
    const pathSegments = currentPath.split('/');
    const fileName = pathSegments.pop(); // Usually 'OWNERS'
    const folders = [];
    
    // Build list of folders to check
    let currentFolder = "";
    folders.push(""); // Root
    for (let segment of pathSegments) {
      currentFolder += (currentFolder ? "/" : "") + segment;
      folders.push(currentFolder);
    }

    // Fetch all in parallel
    const fetchPromises = folders.map(folder => {
      const url = `${baseUrl}/${folder ? folder + '/' : ''}OWNERS`;
      return fetch(url).then(async r => {
        if (!r.ok) return null;
        const text = await r.text();
        return { path: folder || '/', content: text };
      });
    });

    let results = await Promise.all(fetchPromises);
    results = results.filter(r => r !== null);

    // Apply no_parent_owners logic (traverse from bottom to top)
    let filteredResults = [];
    for (let i = results.length - 1; i >= 0; i--) {
      filteredResults.unshift(results[i]);
      try {
        const doc = jsyaml.load(results[i].content);
        if (doc && doc.no_parent_owners === true) {
          break;
        }
      } catch (e) {}
    }

    return filteredResults;
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

  function createGitHubLink(username) {
    const a = document.createElement('a');
    a.href = `https://github.com/${username}`;
    a.target = '_blank';
    a.innerText = username;
    a.className = 'affi-link';
    return a;
  }

  function renderOverlay(files, aliases) {
    const existing = document.getElementById('affi-overlay');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'affi-overlay';
    
    const toggle = document.createElement('div');
    toggle.id = 'affi-toggle';
    toggle.innerText = 'Affi';
    toggle.onclick = (e) => {
        e.stopPropagation();
        container.classList.toggle('affi-collapsed');
    };

    const header = document.createElement('div');
    header.id = 'affi-header';
    header.innerText = 'Affi - Kubernetes OWNERS Hierarchy';

    const contentDiv = document.createElement('div');
    contentDiv.id = 'affi-content';

    files.forEach((file, index) => {
      const isLast = index === files.length - 1;
      const fileSection = document.createElement('div');
      fileSection.className = 'affi-file-section';
      if (!isLast) fileSection.classList.add('affi-file-collapsed');
      
      const pathLabel = document.createElement('div');
      pathLabel.className = 'affi-path-label';
      pathLabel.innerText = `${isLast ? '▼' : '▶'} File: ${file.path}/OWNERS`;
      pathLabel.style.cursor = 'pointer';
      
      const fileBody = document.createElement('div');
      fileBody.className = 'affi-file-body';

      pathLabel.onclick = () => {
          const isCollapsed = fileSection.classList.toggle('affi-file-collapsed');
          pathLabel.innerText = `${isCollapsed ? '▶' : '▼'} File: ${file.path}/OWNERS`;
      };

      fileSection.appendChild(pathLabel);
      fileSection.appendChild(fileBody);

      const lines = file.content.split('\n');
      lines.forEach(line => {
        const lineDiv = document.createElement('div');
        lineDiv.className = 'affi-line';

        const trimmed = line.trim();
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
                    item.appendChild(document.createTextNode(`${subIndent}- `));
                    item.appendChild(createGitHubLink(member));
                    list.appendChild(item);
                  });
                  btn.after(list);
                  btn.innerText = ' [-]';
                }
              };
              lineDiv.appendChild(span);
              lineDiv.appendChild(btn);
            } else if (isListItem && part.match(/^[\w-]+$/) && part !== '-') {
              lineDiv.appendChild(createGitHubLink(part));
            } else {
              lineDiv.appendChild(document.createTextNode(part));
            }
          });
        } else {
          lineDiv.appendChild(document.createTextNode(line));
        }
        fileBody.appendChild(lineDiv);
      });
      contentDiv.appendChild(fileSection);
    });

    container.appendChild(toggle);
    container.appendChild(header);
    container.appendChild(contentDiv);
    document.body.appendChild(container);
  }

  init();
})();
