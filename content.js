(function() {
  console.log('Affi extension initialized');

  if (typeof location !== 'undefined' && typeof MutationObserver !== 'undefined') {
    let lastUrl = location.href;

    const observer = new MutationObserver(() => {
      const url = location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        onUrlChange();
      }
    });

    observer.observe(document, { subtree: true, childList: true });
  }

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

      const hierarchy = await fetchOwnersHierarchy(rawBaseUrl, filePath);
      const githubBlobUrl = `https://github.com/${owner}/${repo}/blob/${branch}`;
      renderOverlay(hierarchy, aliasesData, githubBlobUrl);
    } catch (err) {
      console.error('Affi: Error fetching data', err);
    }
  }

  async function fetchOwnersHierarchy(baseUrl, currentPath) {
    const pathSegments = currentPath.split('/');
    const folders = [];
    
    let currentFolder = "";
    folders.push(""); // Root
    for (let segment of pathSegments) {
      if (segment === 'OWNERS' || segment === 'OWNERS_ALIASES') continue;
      currentFolder += (currentFolder ? "/" : "") + segment;
      folders.push(currentFolder);
    }

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

    let filteredResults = [];
    let truncated = false;
    for (let i = results.length - 1; i >= 0; i--) {
      filteredResults.unshift(results[i]);
      if (shouldTruncate(results[i].content)) {
        if (i > 0) truncated = true;
        break;
      }
    }

    return { files: filteredResults, truncated };
  }

  function createGitHubLink(username) {
    const a = document.createElement('a');
    a.href = `https://github.com/${username}`;
    a.target = '_blank';
    a.innerText = username;
    a.className = 'affi-link';
    return a;
  }

  function renderOverlay(hierarchy, aliases, githubBlobUrl) {
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

    if (hierarchy.truncated) {
      const truncatedDiv = document.createElement('div');
      truncatedDiv.className = 'affi-truncated-msg';
      truncatedDiv.innerText = '❌ no_parent_owners';
      contentDiv.appendChild(truncatedDiv);
    }

    hierarchy.files.forEach((file, index) => {
      const isLast = index === hierarchy.files.length - 1;
      const fileSection = document.createElement('div');
      fileSection.className = 'affi-file-section';
      if (!isLast) fileSection.classList.add('affi-file-collapsed');
      
      const pathLabel = document.createElement('div');
      pathLabel.className = 'affi-path-label';
      
      const labelText = document.createElement('span');
      labelText.innerText = `${isLast ? '▼' : '▶'} File: ${file.path}/OWNERS`;
      pathLabel.appendChild(labelText);

      const sourceLink = document.createElement('a');
      const relativePath = file.path === '/' ? '' : (file.path.startsWith('/') ? file.path : '/' + file.path);
      sourceLink.href = `${githubBlobUrl}${relativePath}/OWNERS`;
      sourceLink.target = '_blank';
      sourceLink.innerText = ' [view source]';
      sourceLink.className = 'affi-source-link';
      sourceLink.onclick = (e) => e.stopPropagation();
      pathLabel.appendChild(sourceLink);

      pathLabel.style.cursor = 'pointer';
      
      const fileBody = document.createElement('div');
      fileBody.className = 'affi-file-body';

      pathLabel.onclick = () => {
          const isCollapsed = fileSection.classList.toggle('affi-file-collapsed');
          labelText.innerText = `${isCollapsed ? '▶' : '▼'} File: ${file.path}/OWNERS`;
      };

      fileSection.appendChild(pathLabel);
      fileSection.appendChild(fileBody);

      const lines = file.content.split('\n');
      lines.forEach(line => {
        const lineDiv = document.createElement('div');
        lineDiv.className = 'affi-line';
        
        if (line.trim() === '') {
            lineDiv.textContent = ' ';
            fileBody.appendChild(lineDiv);
            return;
        }

        const analysis = analyzeOwnersLine(line);

        if (analysis.isListItem || analysis.isAliasKey) {
          analysis.tokens.forEach(part => {
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
                    item.appendChild(document.createTextNode(`${analysis.subIndent}- `));
                    item.appendChild(createGitHubLink(member));
                    list.appendChild(item);
                  });
                  btn.after(list);
                  btn.innerText = ' [-]';
                }
              };
              lineDiv.appendChild(span);
              lineDiv.appendChild(btn);
            } else if (analysis.isListItem && part.match(/^[\w-]+$/) && part !== '-') {
              lineDiv.appendChild(createGitHubLink(part));
            } else {
              lineDiv.appendChild(document.createTextNode(part));
            }
          });
        } else {
          lineDiv.textContent = line;
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

  if (typeof location !== 'undefined') {
    init();
  }

  // Export functions for testing if we are in a Node environment
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      fetchOwnersHierarchy
    };
  }
})();
