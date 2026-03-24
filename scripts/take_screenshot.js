const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

(async () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  const version = packageJson.version;
  const majorMinor = version.split('.').slice(0, 2).join('.');
  
  const screenshotDefault = `screenshot-${majorMinor}.png`;
  const screenshotAll = `screenshot-${majorMinor}-all.png`;

  const extensionPath = path.resolve(__dirname, '..');
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--window-size=1280,1000',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    const targetUrl = 'https://github.com/kubernetes/kubernetes/blob/master/pkg/probe/OWNERS';
    console.log(`Navigating to ${targetUrl}...`);
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });

    console.log('Waiting for Affi overlay...');
    await page.waitForSelector('.affi-overlay', { timeout: 15000 });

    // Helper to hide GitHub UI
    const hideGitHubUI = async () => {
      await page.evaluate(() => {
        const selectorsToHide = [
            '#gh-as-app-wrapper',
            '.gh-header-actions',
            'footer',
            '.AppHeader',
            '.repository-content header',
            '.gh-header-sticky',
            '#repository-container-header'
        ];
        selectorsToHide.forEach(s => {
            const el = document.querySelector(s);
            if (el) el.style.display = 'none';
        });

        const overlay = document.querySelector('.affi-overlay');
        if (overlay) {
            overlay.classList.remove('affi-collapsed');
            overlay.style.top = '20px';
            overlay.style.height = '760px';
        }
      });
    };

    // 1. Take Default Screenshot
    console.log('Taking default screenshot...');
    await hideGitHubUI();
    await new Promise(r => setTimeout(r, 1000));
    await page.screenshot({ path: screenshotDefault });
    console.log(`Saved ${screenshotDefault}`);

    // 2. Click "all" and expand sections, then take "All" Screenshot
    console.log('Expanding sections and toggling all stats...');
    await page.evaluate(() => {
        // Expand sub-sections, skip root
        const collapsedButtons = Array.from(document.querySelectorAll('.affi-file-collapsed .affi-tree-action'))
            .filter(btn => btn.innerText === '[+]');
        const buttonsToClick = collapsedButtons.length > 1 ? collapsedButtons.slice(1) : [];
        buttonsToClick.forEach(btn => btn.click());

        // Toggle "all" stats
        const allButton = document.querySelector('.affi-toggle-btn:last-child');
        if (allButton && !allButton.classList.contains('active')) {
            allButton.click();
        }
    });

    await new Promise(r => setTimeout(r, 2000));
    console.log('Taking "all" screenshot...');
    await page.screenshot({ path: screenshotAll });
    console.log(`Saved ${screenshotAll}`);

  } catch (err) {
    console.error('Error taking screenshots:', err);
  } finally {
    await browser.close();
  }
})();
