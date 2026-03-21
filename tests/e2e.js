// tests/e2e.js - Logic for the Affi E2E Test Page

let statsData = {};
let countdown = 10;
let countdownTimer;

/**
 * Fetch a text asset by path relative to /tests/
 */
async function fetchAsset(path) {
    const r = await fetch(path);
    return r.ok ? r.text() : "";
}

/**
 * Define test cases with data loaded from assets/
 */
async function getTestCases() {
    // 1. kubernetes/kubernetes/blob/master/OWNERS
    // Source: https://raw.githubusercontent.com/kubernetes/kubernetes/master/OWNERS
    const k8sRootOwners = await fetchAsset('assets/k8s-root-OWNERS');
    const k8sAliases = await fetchAsset('assets/k8s-OWNERS_ALIASES');
    
    // 2. kubernetes/kubernetes/blob/master/pkg/probe/OWNERS
    // Source hierarchy:
    // /OWNERS: https://raw.githubusercontent.com/kubernetes/kubernetes/master/OWNERS
    // /pkg/OWNERS: https://raw.githubusercontent.com/kubernetes/kubernetes/master/pkg/OWNERS
    // /pkg/probe/OWNERS: https://raw.githubusercontent.com/kubernetes/kubernetes/master/pkg/probe/OWNERS
    const k8sPkgOwners = await fetchAsset('assets/k8s-pkg-OWNERS');
    const k8sPkgProbeOwners = await fetchAsset('assets/k8s-pkg-probe-OWNERS');

    // 3. kubernetes/node-problem-detector/blob/master/OWNERS
    // Source: https://raw.githubusercontent.com/kubernetes/node-problem-detector/master/OWNERS
    const npdRootOwners = await fetchAsset('assets/npd-root-OWNERS');
    const npdAliases = await fetchAsset('assets/npd-OWNERS_ALIASES');

    const k8sAliasesData = parseYamlAliases(k8sAliases);
    const npdAliasesData = parseYamlAliases(npdAliases);

    return [
      {
        name: "Kubernetes Root (k8s/k8s)",
        sourceUrl: "https://github.com/kubernetes/kubernetes/blob/master/OWNERS",
        hierarchy: {
          files: [
            { path: "/", content: k8sRootOwners }
          ],
          truncated: false
        },
        aliases: k8sAliasesData,
        repoPath: "kubernetes/kubernetes"
      },
      {
        name: "Kubernetes Subfolder (k8s/k8s/pkg/probe)",
        sourceUrl: "https://github.com/kubernetes/kubernetes/blob/master/pkg/probe/OWNERS",
        hierarchy: {
          files: [
            { path: "/pkg/probe", content: k8sPkgProbeOwners },
            { path: "/pkg", content: k8sPkgOwners },
            { path: "/", content: k8sRootOwners }
          ],
          truncated: false
        },
        aliases: k8sAliasesData,
        repoPath: "kubernetes/kubernetes"
      },
      {
        name: "Node Problem Detector Root (k8s/npd)",
        sourceUrl: "https://github.com/kubernetes/node-problem-detector/blob/master/OWNERS",
        hierarchy: {
          files: [
            { path: "/", content: npdRootOwners }
          ],
          truncated: false
        },
        aliases: npdAliasesData,
        repoPath: "kubernetes/node-problem-detector"
      }
    ];
}

async function loadStats() {
    try {
        const response = await fetch('../maintainers_stats.json');
        statsData = await response.json();
    } catch (err) {
        console.error("Failed to load statsData", err);
    }
}

async function renderTests() {
    const testCases = await getTestCases();
    const container = document.getElementById('test-rows');
    container.innerHTML = '';
    
    testCases.forEach((test, index) => {
        const row = document.createElement('div');
        row.className = 'test-row';
        
        const visual = document.createElement('div');
        visual.className = 'test-container';

        const header = document.createElement('div');
        header.className = 'test-header';
        header.style.marginTop = "15px";
        header.innerHTML = `<h2>${test.name}</h2>
            <p><strong>Repo:</strong> ${test.repoPath}</p>
            <p><a href="${test.sourceUrl}" target="_blank" style="font-size: 0.8em; color: #0969da; text-decoration: none;">view on github</a></p>`;

        const footer = document.createElement('div');
        footer.className = 'test-footer';
        footer.innerHTML = `
            <button class="toggle-source-btn" id="toggle-source-${index}">Show OWNERS source</button>
            <div class="source-code" id="source-code-${index}">
                <pre style="max-height: 200px; overflow: auto; background: #f6f8fa; padding: 10px; border: 1px solid #d0d7de; border-radius: 6px; font-size: 11px;">${test.hierarchy.files.map(f => `File: ${f.path}/OWNERS\n${f.content}`).join('\n\n')}</pre>
            </div>`;
        
        row.appendChild(visual);
        row.appendChild(header);
        row.appendChild(footer);
        container.appendChild(row);

        // Add toggle functionality
        const toggleBtn = footer.querySelector('.toggle-source-btn');
        const sourceDiv = footer.querySelector('.source-code');
        toggleBtn.onclick = () => {
            const isVisible = sourceDiv.classList.toggle('visible');
            toggleBtn.innerText = isVisible ? 'Hide OWNERS source' : 'Show OWNERS source';
        };
        
        const githubBlobUrl = `https://github.com/${test.repoPath}/blob/master`;
        renderAffiOverlay(visual, test.hierarchy, test.aliases, githubBlobUrl, statsData, test.repoPath);
        
        // Ensure it's not collapsed by default for better visibility in tests
        const overlay = visual.querySelector('.affi-overlay');
        if (overlay) {
            overlay.classList.remove('affi-collapsed');
            // Also enable stats by default in E2E for better verification
            overlay.classList.add('affi-show-stats', 'affi-show-affiliations', 'affi-show-roles');
        }
    });
}

function updateCountdown() {
    const el = document.getElementById('countdown');
    el.innerText = countdown;
    if (countdown <= 0) {
        countdown = 10;
        renderTests();
    } else {
        countdown--;
    }
}

async function init() {
    await loadStats();
    await renderTests();
    
    countdownTimer = setInterval(updateCountdown, 1000);
    
    document.getElementById('refresh-btn').onclick = () => {
        window.location.reload();
    };
}

init();
