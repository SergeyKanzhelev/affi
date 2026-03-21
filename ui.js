// ui.js - logic for rendering the Affi overlay

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

function renderAffiOverlay(container, hierarchy, aliases, githubBlobUrl, statsData, repoPath) {
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

  const overlayDiv = document.createElement('div');
  overlayDiv.className = 'affi-overlay affi-overlay-instance';
  
  const toggle = document.createElement('div');
  toggle.className = 'affi-toggle';
  toggle.innerText = 'Affi';
  toggle.onclick = (e) => {
      e.stopPropagation();
      overlayDiv.classList.toggle('affi-collapsed');
  };

  const header = document.createElement('div');
  header.className = 'affi-header';
  header.innerText = 'Affi - Kubernetes OWNERS Hierarchy';

  const contentDiv = document.createElement('div');
  contentDiv.className = 'affi-content';

  hierarchy.files.forEach((file, index) => {
    const isLast = index === hierarchy.files.length - 1;
    
    const fileSection = document.createElement('div');
    fileSection.className = 'affi-file-section';
    if (!isLast) fileSection.classList.add('affi-file-collapsed');
    // Indent the whole frame
    fileSection.style.marginLeft = `${index * 20}px`;
    
    const pathRow = document.createElement('div');
    pathRow.className = 'affi-path-row';

    // Toggle [+] at beginning
    const toggleBtn = document.createElement('span');
    toggleBtn.className = 'affi-tree-action';
    toggleBtn.style.minWidth = '20px';
    toggleBtn.style.display = 'inline-block';
    toggleBtn.innerText = isLast ? '[-]' : '[+]';
    toggleBtn.onclick = () => {
        const isCollapsed = fileSection.classList.toggle('affi-file-collapsed');
        toggleBtn.innerText = isCollapsed ? '[+]' : '[-]';
    };
    pathRow.appendChild(toggleBtn);

    // Folder name: show relative to previous
    const folderSpan = document.createElement('span');
    folderSpan.className = 'affi-folder-name';
    if (file.path === '/') {
        folderSpan.innerText = '/';
    } else {
        const prevPath = index > 0 ? hierarchy.files[index-1].path : '';
        let relPath = file.path;
        if (prevPath && prevPath !== '/' && file.path.startsWith(prevPath)) {
            relPath = file.path.substring(prevPath.length);
            if (relPath.startsWith('/')) relPath = relPath.substring(1);
        } else if (prevPath === '/' && file.path.startsWith('/')) {
            relPath = file.path.substring(1);
        }
        folderSpan.innerText = relPath + (relPath.endsWith('/') ? '' : '/');
    }
    pathRow.appendChild(folderSpan);

    // Pale OWNERS label
    const ownersLabel = document.createElement('span');
    ownersLabel.className = 'affi-owners-label';
    ownersLabel.innerText = 'OWNERS ';
    pathRow.appendChild(ownersLabel);

    // Ignored tag logic: if ANY subsequent file has no_parent_owners, this one is ignored
    let isIgnored = false;
    for (let j = index + 1; j < hierarchy.files.length; j++) {
        if (shouldTruncate(hierarchy.files[j].content)) {
            isIgnored = true;
            break;
        }
    }

    if (isIgnored) {
        const ignoredTag = document.createElement('span');
        ignoredTag.className = 'affi-ignored-tag';
        ignoredTag.innerText = '[ignored] ';
        pathRow.appendChild(ignoredTag);
    }

    // Open link
    const openLink = document.createElement('a');
    openLink.className = 'affi-tree-action';
    openLink.innerText = '[open]';
    const relativePath = file.path === '/' ? '' : (file.path.startsWith('/') ? file.path : '/' + file.path);
    openLink.href = `${githubBlobUrl}${relativePath}/OWNERS`;
    pathRow.appendChild(openLink);

    fileSection.appendChild(pathRow);

    const fileBody = document.createElement('div');
    fileBody.className = 'affi-file-body';
    fileBody.style.paddingLeft = '24px';
    fileBody.style.marginLeft = '8px'; 
    
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
            const btn = document.createElement('button');
            btn.className = 'affi-expand-btn';
            btn.innerText = '[+]';

            const span = document.createElement('span');
            span.className = 'affi-alias';
            span.innerText = part;

            const expandAlias = () => {
              const next = btn.nextElementSibling.nextElementSibling; // Skip the span
              if (next && next.classList.contains('affi-expanded-list')) {
                next.remove();
                btn.innerText = '[+]';
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
                span.after(list);
                btn.innerText = '[-]';
              }
            };

            btn.onclick = (e) => {
              e.stopPropagation();
              expandAlias();
            };
            
            lineDiv.appendChild(btn);
            lineDiv.appendChild(span);
            
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
  buttonBar.className = 'affi-button-bar';

  const createToggle = (label, cls) => {
      const b = document.createElement('button');
      b.className = 'affi-toggle-btn';
      b.innerText = label;
      b.onclick = () => {
          const isActive = overlayDiv.classList.toggle(cls);
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

  // Initialize button active states based on overlayDiv classes
  if (overlayDiv.classList.contains('affi-show-stats')) btnStats.classList.add('active');
  if (overlayDiv.classList.contains('affi-show-affiliations')) btnAffi.classList.add('active');
  if (overlayDiv.classList.contains('affi-show-roles')) btnRoles.classList.add('active');

  const updateAllButton = () => {
      const targetClasses = ['affi-show-stats', 'affi-show-affiliations', 'affi-show-roles'];
      const allActive = targetClasses.every(c => overlayDiv.classList.contains(c));
      btnAll.classList.toggle('active', allActive);
  };

  updateAllButton();

  // Override onclick for individual buttons to also update the 'all' button
  [btnStats, btnAffi, btnRoles].forEach((btn, i) => {
      const cls = ['affi-show-stats', 'affi-show-affiliations', 'affi-show-roles'][i];
      btn.onclick = () => {
          const isActive = overlayDiv.classList.toggle(cls);
          btn.classList.toggle('active', isActive);
          updateAllButton();
      };
  });

  btnAll.onclick = () => {
      const targetClasses = ['affi-show-stats', 'affi-show-affiliations', 'affi-show-roles'];
      const anyMissing = targetClasses.some(c => !overlayDiv.classList.contains(c));
      
      targetClasses.forEach(c => {
          if (anyMissing) overlayDiv.classList.add(c);
          else overlayDiv.classList.remove(c);
      });

      // Update all buttons
      btnStats.classList.toggle('active', overlayDiv.classList.contains('affi-show-stats'));
      btnAffi.classList.toggle('active', overlayDiv.classList.contains('affi-show-affiliations'));
      btnRoles.classList.toggle('active', overlayDiv.classList.contains('affi-show-roles'));
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

  overlayDiv.appendChild(toggle);
  overlayDiv.appendChild(header);
  overlayDiv.appendChild(buttonBar);
  overlayDiv.appendChild(contentDiv);

  // Create dynamic footer
  const footer = document.createElement('div');
  footer.className = 'affi-footer';
  
  // Combined sources line
  const sourcesContainer = document.createElement('div');
  sourcesContainer.className = 'affi-footer-sources';

  const sources = [
      { label: 'Stats', link: 'https://k8s.devstats.cncf.io', text: 'DevStats' },
      { label: 'Affiliations', link: 'https://github.com/cncf/gitdm', text: 'gitdm' },
      { label: 'Roles', link: 'https://github.com/kubernetes/community/blob/master/sigs.yaml', text: 'sigs.yaml' }
  ];

  sources.forEach(src => {
      const span = document.createElement('span');
      span.className = 'affi-footer-source';
      span.innerHTML = `${src.label}: <a href="${src.link}" target="_blank" class="affi-footer-link">${src.text}</a>`;
      sourcesContainer.appendChild(span);
  });
  footer.appendChild(sourcesContainer);

  const dateDiv = document.createElement('div');
  dateDiv.innerText = `Data collected on: ${displayDate || 'unknown'}`;
  footer.appendChild(dateDiv);

  const updateDiv = document.createElement('div');
  updateDiv.innerHTML = 'Update data at <a href="https://github.com/SergeyKanzhelev/affi" target="_blank" class="affi-footer-link">affi repo</a>.';
  footer.appendChild(updateDiv);

  overlayDiv.appendChild(footer);

  container.appendChild(overlayDiv);
}

window.renderAffiOverlay = renderAffiOverlay;
