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
      const statsUrl = chrome.runtime.getURL('maintainers_stats.json');
      const [aliasesResp, statsResp] = await Promise.all([
        fetch(aliasesUrl).then(r => r.ok ? r.text() : ''),
        fetch(statsUrl).then(r => r.ok ? r.json() : {}).catch(() => ({}))
      ]);
      const aliasesData = aliasesResp ? parseYamlAliases(aliasesResp) : {};

      const hierarchy = await fetchOwnersHierarchy(rawBaseUrl, filePath);
      const githubBlobUrl = `https://github.com/${owner}/${repo}/blob/${branch}`;
      renderOverlay(hierarchy, aliasesData, githubBlobUrl, statsResp);
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

  function createGitHubLink(username, statusClass) {
    const a = document.createElement('a');
    a.href = `https://github.com/${username}`;
    a.target = '_blank';
    a.innerText = username;
    a.className = 'affi-link';
    if (statusClass) a.classList.add(statusClass);
    return a;
  }

  function createStatsSpan(repoStats, globalStats) {
    const span = document.createElement('span');
    span.className = 'affi-stats';
    
    const getVal = (s, key) => (s && s[key] !== undefined) ? s[key] : '?';
    
    const rPRs = getVal(repoStats, 'pr_comments');
    const rDS = getVal(repoStats, 'devstats_score');
    const gPRs = getVal(globalStats, 'pr_comments');
    const gDS = getVal(globalStats, 'devstats_score');

    span.innerText = ` (Repo: ${rPRs}/${rDS} | All: ${gPRs}/${gDS})`;
    return span;
  }

  function getContributorStatus(rStat, gStat) {
    const rComments = rStat ? (rStat.pr_comments || 0) : 0;
    const rDev = rStat ? (rStat.devstats_score || 0) : 0;
    const gComments = gStat ? (gStat.pr_comments || 0) : 0;
    const gDev = gStat ? (gStat.devstats_score || 0) : 0;
    
    // Completely inactive across all tracked repos
    if (gComments === 0 && gDev === 0) return 'affi-user-zero';
    
    // Locally inactive but globally active (high global score)
    if (rComments === 0 && rDev === 0 && (gComments >= 50 || gDev >= 100)) {
        return 'affi-user-locally-inactive';
    }

    // Low local activity
    if (rComments < 10) return 'affi-user-low';
    
    // Highly active locally
    if (rComments >= 50) return 'affi-user-active';
    
    return '';
  }

  function renderOverlay(hierarchy, aliases, githubBlobUrl, statsData) {
    const existing = document.getElementById('affi-overlay');
    if (existing) existing.remove();

    const repoPath = window.location.pathname.split('/').slice(1, 3).join('/').toLowerCase();
    
    // Find matching repo in additive structure
    let userStats = {};
    if (statsData && statsData.repositories) {
        // Robust check for repo matching (handle casing and trailing slashes)
        const matchingKey = Object.keys(statsData.repositories).find(k => {
            const cleanK = k.toLowerCase().replace(/\/$/, "");
            const cleanP = repoPath.replace(/\/$/, "");
            return cleanK === cleanP;
        });
        if (matchingKey) {
            userStats = statsData.repositories[matchingKey].users || {};
        }
    }

    // Calculate global stats across all repos
    const globalStats = {};
    if (statsData && statsData.repositories) {
        Object.values(statsData.repositories).forEach(repo => {
            if (repo.users) {
                Object.entries(repo.users).forEach(([user, stats]) => {
                    if (!globalStats[user]) {
                        globalStats[user] = { pr_comments: 0, devstats_score: 0 };
                    }
                    globalStats[user].pr_comments += (stats.pr_comments || 0);
                    globalStats[user].devstats_score += (stats.devstats_score || 0);
                });
            }
        });
    }

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
            const partLower = part.toLowerCase();
            if (aliases[part]) {
              const span = document.createElement('span');
              span.className = 'affi-alias';
              span.innerText = part;

              const btn = document.createElement('button');
              btn.className = 'affi-expand-btn';
              btn.innerText = ' [+]';
              
              const expandAlias = () => {
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
                    
                    const mLower = member.toLowerCase();
                    const rStat = userStats[mLower];
                    const gStat = globalStats[mLower];
                    
                    const statusClass = getContributorStatus(rStat, gStat);
                    item.appendChild(createGitHubLink(member, statusClass));
                    
                    if (rStat || gStat) {
                        item.appendChild(createStatsSpan(rStat, gStat));
                    }
                    list.appendChild(item);
                  });
                  btn.after(list);
                  btn.innerText = ' [-]';
                }
              };

              btn.onclick = (e) => {
                e.stopPropagation();
                expandAlias();
              };
              
              lineDiv.appendChild(span);
              lineDiv.appendChild(btn);
              
              // Expand automatically on load
              expandAlias();
            } else if (analysis.isListItem && part.match(/^[\w-]+$/) && part !== '-') {
              const rStat = userStats[partLower];
              const gStat = globalStats[partLower];
              const statusClass = getContributorStatus(rStat, gStat);
              lineDiv.appendChild(createGitHubLink(part, statusClass));
              
              if (rStat || gStat) {
                  lineDiv.appendChild(createStatsSpan(rStat, gStat));
              }
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

    const statsToggle = document.createElement('button');
    statsToggle.id = 'affi-stats-toggle';
    statsToggle.innerText = 'Show Activity Stats';
    statsToggle.onclick = () => {
        const showing = container.classList.toggle('affi-show-stats');
        statsToggle.innerText = showing ? 'Hide Activity Stats' : 'Show Activity Stats';
    };

    container.appendChild(toggle);
    container.appendChild(header);
    container.appendChild(statsToggle);
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
