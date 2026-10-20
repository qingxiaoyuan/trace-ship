import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface Fixture {
  username: string;
  password: string;
  reading: { project_id: string; project_name: string; repository_id: string; software_name: string; release_ids: string[] };
  repackage: { release_id: string; config_id: string; dispatch_receipts: string };
  tasks: { success: { id: string; artifacts: { id: string; name: string; size: number }[] } };
}

const fixture = JSON.parse(readFileSync(process.env.SMOKE_MANIFEST!, 'utf8')) as Fixture;
const reportDir = process.env.SMOKE_REPORT_DIR!;
const sample = fixture.reading;
const evidence: Record<string, unknown> = {
  role: 'maintainer', data: '隔离 REST 服务中的长名称、14 条已发布版本与 Markdown 边界样本',
  mobile: 'Chromium 视口模拟；未验证手机真机、系统软键盘或 OA 原生容器',
};
let pageErrors: string[] = [];
let serverErrors: { path: string; status: number }[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  serverErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 500) serverErrors.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
});

async function actualViewport(page: Page) {
  return page.evaluate(() => ({ width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, scrollY }));
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: '本地账号', exact: true }).click();
  await page.getByPlaceholder('请输入本地账号').fill(fixture.username);
  await page.getByPlaceholder('请输入密码', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: '登 录', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.waitForLoadState('networkidle');
  await page.goto('/dashboard');
  await expect(page.locator('.mnt-release-list')).toBeVisible();
  await page.waitForLoadState('networkidle');
}

async function noOperations(page: Page) {
  await expect(page.getByRole('button', { name: /导出|下载|补打|重试任务|重试打包|收藏|新建发布|停止构建|删除任务|推送 SVN/ })).toHaveCount(0);
  await expect(page.locator('a[download]')).toHaveCount(0);
}

async function documentChecks(page: Page, width: number) {
  await expect(page.getByRole('heading', { name: '手机完整阅读验收', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '原始额外字段必须保留', exact: true })).toBeVisible();
  expect(await page.getByText('重要更新', { exact: true }).evaluate(element => element.tagName)).toBe('STRONG');
  expect(await page.getByText('换行后强调', { exact: true }).evaluate(element => element.tagName)).toBe('STRONG');
  await expect(page.getByRole('link', { name: '安全链接', exact: true })).toHaveAttribute('href', 'https://example.invalid/help');
  expect(await page.getByRole('cell', { name: /第一行/ }).locator('br').count()).toBe(1);
  await expect(page.locator('code').filter({ hasText: '<br><script>字面代码</script>' })).toBeVisible();
  await expect(page.locator('pre code')).toHaveText('<br><img src=x onerror=alert(1)>\n');
  expect(await page.locator('.release-markdown a').evaluateAll(links => links.some(link => /^(javascript|data):/i.test(link.getAttribute('href') || '')))).toBe(false);
  await expect(page.locator('.release-markdown script, .release-markdown img[onerror]')).toHaveCount(0);
  expect(await page.evaluate(() => 'smokeUnsafe' in window)).toBe(false);
  const table = page.getByRole('region', { name: '发布说明表格', exact: true }).last();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(reportDir, `readonly-${width}-document-top.png`), fullPage: false, animations: 'disabled' });
  const before = await table.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth, left: element.scrollLeft }));
  await table.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  const after = await table.evaluate(element => ({ left: element.scrollLeft, maximum: element.scrollWidth - element.clientWidth }));
  if (width === 375) {
    expect(before.scroll).toBeGreaterThan(before.client);
    expect(after.left).toBeGreaterThan(before.left);
    expect(Math.abs(after.left - after.maximum)).toBeLessThanOrEqual(1);
  }
  await table.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(reportDir, `readonly-${width}-table-end.png`), fullPage: false, animations: 'disabled' });
  const tail = page.getByText('长文档结尾：全部发布说明完整可读。', { exact: true });
  await tail.scrollIntoViewIfNeeded();
  await expect(tail).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const bottom = await tail.boundingBox();
  expect(bottom).not.toBeNull();
  expect(bottom!.y + bottom!.height).toBeLessThanOrEqual((await actualViewport(page)).height - (width === 375 ? 68 : 0));
  expect((await actualViewport(page)).documentWidth).toBeLessThanOrEqual(width);
  await noOperations(page);
  await page.screenshot({ path: path.join(reportDir, `readonly-${width}-document-bottom.png`), fullPage: false, animations: 'disabled' });
  evidence[`document${width}`] = { table: { before, after }, bottom, viewport: await actualViewport(page), contentComplete: true, semanticsAndSafety: true };
}

test.afterEach(async ({ page, browser }, info) => {
  evidence.browser = { name: 'Chromium', version: browser.version(), headless: true };
  evidence.environment = { node: process.version, platform: process.platform, arch: process.arch, runReport: 'report.json' };
  evidence[info.title] = { status: info.status, failure: info.errors.map(error => error.message), viewport: await actualViewport(page).catch(() => null), pageErrors, serverErrors };
  if (info.status !== 'passed') await page.screenshot({ path: path.join(reportDir, `readonly-failure-${info.title.includes('375') ? 'mobile' : 'desktop'}.png`), fullPage: true }).catch(() => {});
  const previous = path.join(reportDir, 'readonly-evidence.json');
  writeFileSync(previous, JSON.stringify({ ...(existsSync(previous) ? JSON.parse(readFileSync(previous, 'utf8')) : {}), ...evidence }, null, 2));
});

test('1440px 维保只读查看说明、在线日志与产物元信息，直接操作请求均拒绝', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page);
  await expect(page.getByRole('heading', { name: '维保工作台', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '查看 VA.39.1.0 的发布说明', exact: true }).click();
  await documentChecks(page, 1440);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('main').getByRole('button', { name: '打包任务', exact: true }).click();
  await expect(page.getByText(fixture.tasks.success.id)).toHaveCount(0);
  await noOperations(page);
  await page.goto(`/packages/${fixture.tasks.success.id}`);
  await expect(page.getByText('任务结束：万行日志末尾完整', { exact: true })).toBeVisible();
  for (const artifact of fixture.tasks.success.artifacts) await expect(page.getByText(artifact.name, { exact: true }).first()).toBeVisible();
  await noOperations(page);
  await page.screenshot({ path: path.join(reportDir, 'readonly-desktop-task.png'), fullPage: true, animations: 'disabled' });
  const receiptBefore = existsSync(fixture.repackage.dispatch_receipts) ? readFileSync(fixture.repackage.dispatch_receipts, 'utf8') : '';
  const result = await page.evaluate(async ({ release, config, task, artifact, project }) => {
    const headers = { Authorization: `Bearer ${localStorage.getItem('accessToken')}`, 'Content-Type': 'application/json' };
    const total = async () => (await (await fetch(`/api/packages/tasks/?project=${project}`, { headers })).json()).data.total as number;
    const before = await total();
    const actions = [
      ['GET', `/api/releases/${release}/export-md/`], ['GET', `/api/releases/${release}/export-pdf/`],
      ['GET', `/api/releases/${release}/export-word/`], ['GET', `/api/packages/tasks/${task}/logs/`],
      ['GET', `/api/packages/tasks/${task}/artifacts/${artifact}/download/`], ['GET', `/api/packages/tasks/${task}/download-all/`],
      ['POST', `/api/packages/configs/${config}/trigger/`], ['POST', `/api/packages/configs/${config}/favorite/`],
    ];
    const rejected = [];
    for (const [method, url] of actions) {
      const response = await fetch(url, { method, headers, ...(method === 'POST' ? { body: JSON.stringify({ release_id: release }) } : {}) });
      rejected.push({ method, url, status: response.status, file: response.headers.get('Content-Disposition'), contentType: response.headers.get('Content-Type') });
    }
    return { before, after: await total(), rejected };
  }, { release: fixture.repackage.release_id, config: fixture.repackage.config_id, task: fixture.tasks.success.id, artifact: fixture.tasks.success.artifacts[0].id, project: sample.project_id });
  for (const rejected of result.rejected) {
    expect(rejected.status, rejected.url).toBe(403);
    expect(rejected.file).toBeNull();
    expect(rejected.contentType).toContain('application/json');
  }
  expect(result.after).toBe(result.before);
  expect(existsSync(fixture.repackage.dispatch_receipts) ? readFileSync(fixture.repackage.dispatch_receipts, 'utf8') : '').toBe(receiptBefore);
  evidence.directApi = { ...result, noDispatch: true };
  expect(pageErrors).toEqual([]);
  expect(serverErrors).toEqual([]);
});

test('375px 维保组合查询、临时范围、完整说明与返回状态保持只读', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await expect(page.locator('.mnt-package-panel')).toBeHidden();
  await noOperations(page);
  const search = page.getByRole('textbox', { name: '搜索版本、软件或发布说明', exact: true });
  await search.fill('长文档');
  await page.getByRole('button', { name: '正式', exact: true }).click();
  const initial = page.url();
  const trigger = page.getByRole('button', { name: /^选择项目与软件：/ });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '选择项目与软件', exact: true });
  await dialog.getByRole('radio', { name: `${sample.project_name} / ${sample.software_name}`, exact: true }).check();
  expect(page.url()).toBe(initial);
  await dialog.getByRole('button', { name: '关闭范围筛选', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(page.url()).toBe(initial);
  await trigger.click();
  await dialog.getByRole('radio', { name: `${sample.project_name} / ${sample.software_name}`, exact: true }).check();
  await dialog.getByRole('button', { name: '应用筛选', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`project=${sample.project_id}`));
  expect(new URL(page.url()).searchParams.get('repository')).toBe(sample.repository_id);
  await trigger.click();
  await dialog.getByRole('button', { name: '清空', exact: true }).click();
  expect(new URL(page.url()).searchParams.get('repository')).toBe(sample.repository_id);
  await dialog.getByRole('button', { name: '应用筛选', exact: true }).click();
  expect(new URL(page.url()).searchParams.has('project')).toBe(false);
  expect(new URL(page.url()).searchParams.get('search')).toBe('长文档');
  expect(new URL(page.url()).searchParams.get('type')).toBe('formal');
  await trigger.click();
  await dialog.getByRole('radio', { name: `${sample.project_name} / ${sample.software_name}`, exact: true }).check();
  await page.screenshot({ path: path.join(reportDir, 'readonly-mobile-range.png'), fullPage: false, animations: 'disabled' });
  await dialog.getByRole('button', { name: '应用筛选', exact: true }).click();
  const pageTwo = page.waitForResponse(response => new URL(response.url()).pathname === '/api/releases/' && new URL(response.url()).searchParams.get('page') === '2');
  await page.locator('.ant-pagination-item-2').click();
  expect((await pageTwo).status()).toBe(200);
  await expect(page).toHaveURL(/page=2/);
  await page.waitForLoadState('networkidle');
  const from = new URL(page.url()).pathname + new URL(page.url()).search;
  const link = page.getByRole('link', { name: /^查看 .* 的发布说明$/ }).last();
  await expect(page.locator('.mnt-release-list > li')).toHaveCount(6);
  await expect(link).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(reportDir, 'readonly-mobile-list-viewport.png'), fullPage: false, animations: 'disabled' });
  await link.scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => scrollY);
  expect(scroll).toBeGreaterThan(100);
  evidence.mobileList = { viewport: await actualViewport(page), from, scroll };
  await page.screenshot({ path: path.join(reportDir, 'readonly-mobile-list.png'), fullPage: true, animations: 'disabled' });
  await link.click();
  await documentChecks(page, 375);
  await page.evaluate(() => window.scrollTo(0, 0));
  const back = page.getByRole('button', { name: '维保工作台', exact: true });
  const target = await back.boundingBox();
  expect(target!.height).toBeGreaterThanOrEqual(36);
  await back.click();
  await expect(page).toHaveURL(new URL(from, process.env.SMOKE_BASE_URL).href);
  await page.waitForLoadState('networkidle');
  await expect.poll(async () => Math.abs((await page.evaluate(() => scrollY)) - scroll)).toBeLessThanOrEqual(100);
  evidence.returnState = { from, restoredScroll: await page.evaluate(() => scrollY), originalScroll: scroll };
  await search.scrollIntoViewIfNeeded();
  await search.focus();
  await page.setViewportSize({ width: 375, height: 480 });
  await search.fill('不存在的版本样本');
  await expect(page.getByText('没有匹配的已发布版本', { exact: true })).toBeVisible();
  await expect(search).toBeFocused();
  expect((await actualViewport(page)).documentWidth).toBeLessThanOrEqual(375);
  evidence.inputFocus = { viewport: await actualViewport(page), focusPreserved: true, note: '缩小浏览器高度检查输入与布局，不模拟或证明系统软键盘' };
  await page.screenshot({ path: path.join(reportDir, 'readonly-mobile-input-shrunken.png'), fullPage: false, animations: 'disabled' });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: '恢复全部', exact: true }).first().click();
  await expect(page).toHaveURL(new URL('/dashboard', process.env.SMOKE_BASE_URL).href);
  await expect(page.getByRole('link', { name: '查看 VA.39.1.0 的发布说明', exact: true })).toBeVisible();
  const targets = await page.locator('.mnt-scope-trigger, .mnt-type-filters button, .mnt-release-action a, .mnt-pagination li:not(.ant-pagination-disabled)').evaluateAll(elements => elements.filter(element => !!element.getClientRects().length).map(element => ({ text: element.textContent?.trim(), width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })));
  expect(targets.length).toBeGreaterThan(5);
  for (const touch of targets) { expect(touch.height, touch.text).toBeGreaterThanOrEqual(36); expect(touch.width, touch.text).toBeGreaterThanOrEqual(36); }
  evidence.touchTargets = targets;
  await page.goto(`/packages/${fixture.tasks.success.id}`);
  await expect(page.getByText('任务结束：万行日志末尾完整', { exact: true })).toBeVisible();
  await noOperations(page);
  expect((await actualViewport(page)).documentWidth).toBeLessThanOrEqual(375);
  await page.screenshot({ path: path.join(reportDir, 'readonly-mobile-task.png'), fullPage: true, animations: 'disabled' });
  expect(pageErrors).toEqual([]);
  expect(serverErrors).toEqual([]);
});
