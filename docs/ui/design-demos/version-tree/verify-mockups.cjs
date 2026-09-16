const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('/home/bduser/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = __dirname;
const cases = [
  ['direction-a-tree-table.html', 'direction-a-tree-table'],
  ['direction-b-repository-cards.html', 'direction-b-repository-cards'],
  ['direction-c-split-view.html', 'direction-c-split-view'],
];
const viewports = [
  { width: 1440, height: 900, name: '1440x900' },
  { width: 375, height: 667, name: '375x667' },
];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/home/bduser/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  let failed = false;
  for (const [file, folder] of cases) {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`console: ${message.text()}`);
      });
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
      await page.goto(pathToFileURL(path.join(root, file)).href, { waitUntil: 'load' });
      await page.waitForTimeout(300);
      const metrics = await page.evaluate(() => ({
        bodyWidth: document.body.scrollWidth,
        bodyHeight: document.body.scrollHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        title: document.title,
      }));
      await page.screenshot({
        path: path.join(root, 'screenshots', folder, `${viewport.name}.png`),
        fullPage: false,
      });
      if (errors.length) failed = true;
      console.log(JSON.stringify({ file, viewport: viewport.name, metrics, errors }));
      await page.close();
    }
  }
  const interactions = [
    {
      file: 'direction-a-tree-table.html',
      run: async (page) => {
        await page.locator('#expandA').click();
        const expanded = await page.locator('#expandA').textContent();
        await page.locator('#searchA').fill('VM.2.3.0-beta');
        const found = await page.locator('body').textContent();
        return expanded.includes('全部折叠') && found.includes('VM.2.3.0-beta');
      },
    },
    {
      file: 'direction-b-repository-cards.html',
      run: async (page) => {
        await page.locator('#searchB').fill('VM.2.2.5');
        const found = await page.locator('body').textContent();
        await page.locator('#searchB').fill('');
        await page.locator('button[data-repo="w"]').click();
        return found.includes('VM.2.2.5');
      },
    },
    {
      file: 'direction-c-split-view.html',
      run: async (page) => {
        await page.locator('button[data-repo="web"]').click();
        const found = await page.locator('#detailC').textContent();
        return found.includes('VW.1.8.4') && found.includes('E2E Web Console');
      },
    },
  ];
  for (const item of interactions) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(pathToFileURL(path.join(root, item.file)).href, { waitUntil: 'load' });
    const passed = await item.run(page);
    if (!passed) failed = true;
    console.log(JSON.stringify({ file: item.file, interaction: passed ? 'passed' : 'failed' }));
    await page.close();
  }
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
