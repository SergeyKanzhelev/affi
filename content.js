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

  function parseGitHubBlobContext(pathname, doc) {
    const pathParts = pathname.split('/').filter(Boolean);
    if (pathParts.length < 5 || pathParts[2] !== 'blob') return null;

    const fallback = {
      owner: pathParts[0],
      repo: pathParts[1],
      branch: pathParts[3],
      filePath: pathParts.slice(4).join('/')
    };

    if (!doc || typeof doc.querySelector !== 'function') {
      return fallback;
    }

    const refSelector = doc.querySelector('button[data-testid="anchor-button"][aria-label$=" branch"], button[data-testid="anchor-button"][aria-label$=" tag"]');
    const refLabel = refSelector?.getAttribute('aria-label');
    if (refLabel) {
      const branch = refLabel.replace(/ (branch|tag)$/, '');
      const combinedPath = pathParts.slice(3).join('/');
      const prefix = `${branch}/`;
      if (combinedPath.startsWith(prefix)) {
        return {
          owner: pathParts[0],
          repo: pathParts[1],
          branch,
          filePath: combinedPath.slice(prefix.length)
        };
      }
    }

    const embeddedDataScript = doc.querySelector('script[data-target="react-app.embeddedData"]');
    if (!embeddedDataScript || !embeddedDataScript.textContent) {
      return fallback;
    }

    try {
      const embeddedData = JSON.parse(embeddedDataScript.textContent);
      const layoutRoute = embeddedData?.payload?.codeViewLayoutRoute;
      const blobRoute = embeddedData?.payload?.codeViewBlobLayoutRoute;
      const owner = layoutRoute?.repo?.ownerLogin;
      const repo = layoutRoute?.repo?.name;
      const branch = blobRoute?.refInfo?.name || layoutRoute?.refInfo?.name;
      const filePath = blobRoute?.path || layoutRoute?.path;

      if (!owner || !repo || !branch || !filePath) {
        return fallback;
      }

      return { owner, repo, branch, filePath };
    } catch (err) {
      console.warn('Affi: Could not parse GitHub embedded blob data', err);
      return fallback;
    }
  }

  async function init() {
    const blobContext = parseGitHubBlobContext(window.location.pathname, document);
    if (!blobContext) return;

    const { owner, repo, branch, filePath } = blobContext;
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

  function createStatsSpan(repoStats, globalStats, affiliation, roles) {
    const span = document.createElement('span');
    span.className = 'affi-stats';
    
    // Roles - only add if we have them
    if (roles && roles.length > 0) {
        const roleSpan = document.createElement('span');
        roleSpan.className = 'affi-role-text';
        roleSpan.innerText = ` *${roles.join(', ')}*`;
        span.appendChild(roleSpan);
    }

    // Affiliation - only add if we have it
    if (affiliation && affiliation !== 'Unknown') {
        const affiSpan = document.createElement('span');
        affiSpan.className = 'affi-affiliation-text';
        affiSpan.innerText = ` [${affiliation}]`;
        span.appendChild(affiSpan);
    }

    // Stats - always add the span, but CSS will control its text visibility
    const statsTextSpan = document.createElement('span');
    statsTextSpan.className = 'affi-stats-text';
    const getVal = (s, key) => (s && s[key] !== undefined) ? s[key] : '?';
    const rPRs = getVal(repoStats, 'pr_comments');
    const rDS = getVal(repoStats, 'devstats_score');
    const gPRs = getVal(globalStats, 'pr_comments');
    const gDS = getVal(globalStats, 'devstats_score');
    statsTextSpan.innerText = ` (Repo: ${rPRs}/${rDS} | All: ${gPRs}/${gDS})`;
    span.appendChild(statsTextSpan);
    
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

    // Access global affiliations and roles
    const userAffiliations = statsData ? (statsData.users_affiliation || {}) : {};
    const userRoles = statsData ? (statsData.users_roles || {}) : {};

    // Calculate global stats across all repos and find latest date
    let latestDate = '';
    const globalStats = {};
    if (statsData && statsData.repositories) {
        Object.values(statsData.repositories).forEach(repo => {
            if (repo.date_generated && (!latestDate || repo.date_generated > latestDate)) {
                latestDate = repo.date_generated;
            }
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
      let inEmeritusSection = false;
      let inLabelsSection = false;
      lines.forEach(line => {
        const lineDiv = document.createElement('div');
        lineDiv.className = 'affi-line';
        
        if (line.trim() === '') {
            lineDiv.textContent = ' ';
            fileBody.appendChild(lineDiv);
            return;
        }

        const analysis = analyzeOwnersLine(line);
        
        // Tracking section state
        const isTopLevelKey = !line.startsWith(" ") && !line.startsWith("-") && line.includes(":");
        
        if (analysis.isEmeritusBlock) {
            inEmeritusSection = true;
            inLabelsSection = false;
        } else if (analysis.isLabelsBlock) {
            inLabelsSection = true;
            inEmeritusSection = false;
        } else if (isTopLevelKey) {
            inEmeritusSection = false;
            inLabelsSection = false;
        }

        if (!analysis.isComment && (analysis.isListItem || analysis.isAliasKey) && !inLabelsSection && !analysis.isLabelsBlock) {
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
                    const affiliation = userAffiliations[mLower];
                    const roles = userRoles[mLower];
                    
                    const statusClass = getContributorStatus(rStat, gStat);
                    const link = createGitHubLink(member, statusClass);
                    if (inEmeritusSection) link.classList.add('affi-emeritus');
                    item.appendChild(link);
                    
                    if (rStat || gStat || affiliation || roles) {
                        item.appendChild(createStatsSpan(rStat, gStat, affiliation, roles));
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
            } else if (!part.startsWith('#') && analysis.isListItem && part.match(/^[\w-]+$/) && part !== '-') {
              const rStat = userStats[partLower];
              const gStat = globalStats[partLower];
              const affiliation = userAffiliations[partLower];
              const roles = userRoles[partLower];
              const statusClass = getContributorStatus(rStat, gStat);
              const link = createGitHubLink(part, statusClass);
              if (inEmeritusSection) link.classList.add('affi-emeritus');
              lineDiv.appendChild(link);
              
              if (rStat || gStat || affiliation || roles) {
                  lineDiv.appendChild(createStatsSpan(rStat, gStat, affiliation, roles));
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

    // Button Bar
    const buttonBar = document.createElement('div');
    buttonBar.id = 'affi-button-bar';

    const createToggle = (label, cls) => {
        const b = document.createElement('button');
        b.className = 'affi-toggle-btn';
        b.innerText = label;
        b.onclick = () => {
            const isActive = container.classList.toggle(cls);
            b.classList.toggle('active', isActive);
        };
        return b;
    };

    const btnStats = createToggle('stats', 'affi-show-stats');
    const btnAffi = createToggle('affi', 'affi-show-affiliations');
    const btnRoles = createToggle('roles', 'affi-show-roles');
    
    const btnAll = document.createElement('button');
    btnAll.className = 'affi-toggle-btn';
    btnAll.innerText = 'all';

    const updateAllButton = () => {
        const targetClasses = ['affi-show-stats', 'affi-show-affiliations', 'affi-show-roles'];
        const allActive = targetClasses.every(c => container.classList.contains(c));
        btnAll.classList.toggle('active', allActive);
    };

    // Override onclick for individual buttons to also update the 'all' button
    [btnStats, btnAffi, btnRoles].forEach((btn, i) => {
        const cls = ['affi-show-stats', 'affi-show-affiliations', 'affi-show-roles'][i];
        btn.onclick = () => {
            const isActive = container.classList.toggle(cls);
            btn.classList.toggle('active', isActive);
            updateAllButton();
        };
    });

    btnAll.onclick = () => {
        const targetClasses = ['affi-show-stats', 'affi-show-affiliations', 'affi-show-roles'];
        const anyMissing = targetClasses.some(c => !container.classList.contains(c));
        
        targetClasses.forEach(c => {
            if (anyMissing) container.classList.add(c);
            else container.classList.remove(c);
        });

        // Update all buttons
        btnStats.classList.toggle('active', container.classList.contains('affi-show-stats'));
        btnAffi.classList.toggle('active', container.classList.contains('affi-show-affiliations'));
        btnRoles.classList.toggle('active', container.classList.contains('affi-show-roles'));
        updateAllButton();
    };

    buttonBar.appendChild(btnStats);
    buttonBar.appendChild(btnAffi);
    buttonBar.appendChild(btnRoles);
    buttonBar.appendChild(btnAll);

    // Find collection date for this repo or fallback to latest across all
    let displayDate = latestDate;
    if (statsData && statsData.repositories) {
        const matchingKey = Object.keys(statsData.repositories).find(k => {
            return k.toLowerCase().replace(/\/$/, "") === repoPath.replace(/\/$/, "");
        });
        if (matchingKey && statsData.repositories[matchingKey].date_generated) {
            displayDate = statsData.repositories[matchingKey].date_generated;
        }
    }

    container.appendChild(toggle);
    container.appendChild(header);
    container.appendChild(buttonBar);
    container.appendChild(contentDiv);

    // Create dynamic footer
    const footer = document.createElement('div');
    footer.id = 'affi-footer';
    
    const dateDiv = document.createElement('div');
    dateDiv.innerText = `Data collected on: ${displayDate || 'unknown'}`;
    footer.appendChild(dateDiv);

    const toolDiv = document.createElement('div');
    toolDiv.innerHTML = 'Collected using <a href="https://github.com/kubernetes-sigs/maintainers/" target="_blank" class="affi-footer-link">maintainers</a> tool.';
    footer.appendChild(toolDiv);

    const updateDiv = document.createElement('div');
    updateDiv.innerHTML = 'Update data at <a href="https://github.com/SergeyKanzhelev/affi" target="_blank" class="affi-footer-link">affi repo</a>.';
    footer.appendChild(updateDiv);

    container.appendChild(footer);

    document.body.appendChild(container);
  }

  if (typeof location !== 'undefined') {
    init();
  }

  // Export functions for testing if we are in a Node environment
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      fetchOwnersHierarchy,
      parseGitHubBlobContext
    };
  }
})();
