(function() {
  console.log('Affi extension initialized');

  let lastUrl = typeof location !== 'undefined' ? location.href : '';
  let isInitializing = false;
  let navSeq = 0;

  function onUrlChange() {
    navSeq++;
    const existing = document.querySelector('.affi-overlay');
    if (existing) {
        existing.remove();
    }
    // Small delay to let GitHub's SPA navigation settle
    setTimeout(() => init(), 100);
  }

  if (typeof location !== 'undefined' && typeof MutationObserver !== 'undefined') {
    // Detect URL changes via MutationObserver
    const observer = new MutationObserver(() => {
      const url = location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        onUrlChange();
      } else {
        // If we are on an OWNERS page but no overlay is present, try to init
        // This handles cases where the DOM was updated but URL stayed same,
        // or initial init failed because DOM wasn't ready.
        const path = window.location.pathname;
        if ((path.endsWith('/OWNERS') || path.endsWith('/OWNERS_ALIASES')) && 
            path.includes('/blob/') &&
            !document.querySelector('.affi-overlay') && 
            !isInitializing) {
          init();
        }
      }
    });
    observer.observe(document, { subtree: true, childList: true });

    // Also listen for popstate (back/forward)
    window.addEventListener('popstate', onUrlChange);

    // Hook into pushState/replaceState for SPA navigation
    const wrapHistory = (type) => {
      const original = history[type];
      return function() {
        const result = original.apply(this, arguments);
        const url = location.href;
        if (url !== lastUrl) {
          lastUrl = url;
          onUrlChange();
        }
        return result;
      };
    };
    history.pushState = wrapHistory('pushState');
    history.replaceState = wrapHistory('replaceState');
  }

  function parseGitHubBlobContext(pathname, doc) {
    const pathParts = pathname.split('/').filter(Boolean);
    // GitHub blob URLs: /owner/repo/blob/branch/path
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

    // Try to find the branch name from the UI (more reliable for branches with slashes)
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

    // Try to get data from GitHub's embedded JSON (React view)
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
    if (isInitializing) return;

    const pathname = window.location.pathname;
    const blobContext = parseGitHubBlobContext(pathname, document);
    if (!blobContext) return;

    const { owner, repo, branch, filePath } = blobContext;
    const isOwnersFile = filePath.endsWith('OWNERS');
    const isAliasesFile = filePath.endsWith('OWNERS_ALIASES');

    if (!isOwnersFile && !isAliasesFile) return;

    // Check if overlay already exists for THIS file to avoid double rendering
    const existing = document.querySelector('.affi-overlay');
    if (existing && existing.dataset.path === pathname) {
        return;
    }

    isInitializing = true;
    const mySeq = navSeq;
    const rawBaseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`;
    const aliasesUrl = `${rawBaseUrl}/OWNERS_ALIASES`;

    try {
      const statsUrl = chrome.runtime.getURL('maintainers_stats.json');
      const [aliasesResp, statsResp] = await Promise.all([
        fetch(aliasesUrl).then(r => r.ok ? r.text() : ''),
        fetch(statsUrl).then(r => r.ok ? r.json() : {}).catch(() => ({}))
      ]);

      // Abort if user has navigated away since this init started
      if (navSeq !== mySeq) {
          isInitializing = false;
          return;
      }

      const aliasesData = aliasesResp ? parseYamlAliases(aliasesResp) : {};

      const hierarchy = await fetchOwnersHierarchy(rawBaseUrl, filePath);
      const githubBlobUrl = `https://github.com/${owner}/${repo}/blob/${branch}`;
      const repoPath = window.location.pathname.split('/').slice(1, 3).join('/').toLowerCase();

      // Final check before rendering (URL might have changed during fetch)
      if (navSeq !== mySeq || window.location.pathname !== pathname) {
          isInitializing = false;
          return;
      }

      const currentExisting = document.querySelector('.affi-overlay');
      if (currentExisting) currentExisting.remove();

      const overlay = renderAffiOverlay(document.body, hierarchy, aliasesData, githubBlobUrl, statsResp, repoPath);
      if (overlay) {
          overlay.dataset.path = pathname;
      }
    } catch (err) {
      console.error('Affi: Error fetching data', err);
    } finally {
      isInitializing = false;
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

    let truncated = results.some((r, i) => i > 0 && shouldTruncate(r.content));
    return { files: results, truncated };
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
