import { test, expect } from '@playwright/test';
import type { Download, Page } from '@playwright/test';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

interface TaskSample {
  id: string;
  name: string;
  log: string;
  sha256: string | null;
  artifacts: { id: string; name: string; path: string; size: number }[];
}

const fixture = JSON.parse(readFileSync(process.env.SMOKE_MANIFEST!, 'utf8')) as {
  username: string;
  operator: { username: string; role: string; id: string };
  password: string;
  tasks: Record<'success' | 'running' | 'expired' | 'nolog', TaskSample>;
};
const reportDir = process.env.SMOKE_REPORT_DIR!;
const observations: Record<string, unknown> = { samples: Object.fromEntries(Object.entries(fixture.tasks).map(([key, task]) => [key, { id: task.id, sha256: task.sha256, artifacts: task.artifacts }])) };
const failedRequests: { path: string; method: string; error: string | undefined; page: string; at: string }[] = [];
const serverErrors: { path: string; status: number }[] = [];

function hash(bytes: Buffer) { return createHash('sha256').update(bytes).digest('hex'); }

async function download(page: Page, action: () => Promise<void>, filename: string) {
  const waiting = page.waitForEvent('download');
  await action();
  const result: Download = await waiting;
  expect(await result.failure()).toBeNull();
  const destination = path.join(reportDir, filename);
  await result.saveAs(destination);
  return readFileSync(destination);
}

async function viewport(page: Page) {
  return page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, documentWidth: document.documentElement.scrollWidth }));
}

test.afterEach(async ({ page, context, browser }, info) => {
  observations.actor = { role: fixture.operator.role, id: fixture.operator.id };
  observations.browser = { name: 'Chromium', version: browser.version(), headless: true, mobile: '浏览器视口模拟，未验证手机真机' };
  observations.status = info.status;
  observations.actualViewport = await viewport(page).catch(() => null);
  observations.pageErrors = pageErrors;
  observations.failedRequests = failedRequests;
  observations.serverErrors = serverErrors;
  observations.stepsReport = 'playwright.json';
  if (info.status !== 'passed') {
    await Promise.all(context.pages().map((current, index) => current.screenshot({
      path: path.join(reportDir, `failure-page-${index}.png`), fullPage: true,
    }).catch(() => {})));
  }
  writeFileSync(path.join(reportDir, 'browser-evidence.json'), JSON.stringify(observations, null, 2));
});

const pageErrors: string[] = [];

test('项目管理员可恢复任务深链，读取长日志与真实下载，并看到缺失和过期错误', async ({ page, context }) => {
  page.on('pageerror', error => pageErrors.push(error.message));
  context.on('page', current => current.on('pageerror', error => pageErrors.push(error.message)));
  context.on('requestfailed', request => failedRequests.push({ path: new URL(request.url()).pathname, method: request.method(), error: request.failure()?.errorText, page: request.frame().page().url(), at: new Date().toISOString() }));
  context.on('response', response => {
    if (response.status() >= 500) serverErrors.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
  // 完整登录页调用生产登录 API；没有 route/mock 或预制 JWT。
  await test.step('通过真实登录接口建立项目管理员会话', async () => {
    await page.goto('/login');
    await page.getByRole('button', { name: '本地账号', exact: true }).click();
    await page.getByPlaceholder('请输入本地账号').fill(fixture.operator.username);
    await page.getByPlaceholder('请输入密码', { exact: true }).fill(fixture.password);
    const loginResponse = page.waitForResponse(response => response.url().endsWith('/api/auth/login/') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '登 录', exact: true }).click();
    expect((await loginResponse).status()).toBe(200);
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForLoadState('networkidle');
  });

  const deepLink = `/packages/${fixture.tasks.success.id}?source=smoke&keep=%E4%B8%AD%E6%96%87`;
  await test.step('新文档直达与刷新保留完整路径和查询，万行日志尾部可见', async () => {
    // 新页面只共享浏览器持久化存储；内存中的认证状态不会从旧页面继承。
    const direct = await context.newPage();
    await direct.goto(deepLink);
    await expect(direct).toHaveURL(new URL(deepLink, process.env.SMOKE_BASE_URL).href);
    await expect(direct.getByText('任务结束：万行日志末尾完整', { exact: true })).toBeVisible();
    await direct.waitForLoadState('networkidle');
    await direct.reload();
    await expect(direct).toHaveURL(new URL(deepLink, process.env.SMOKE_BASE_URL).href);
    await expect(direct.getByText('构建日志第 10000 行：中文校验通过', { exact: true })).toBeVisible();
    await expect(direct.getByText('任务结束：万行日志末尾完整', { exact: true })).toBeVisible();
    await direct.waitForLoadState('networkidle');
    expect(await viewport(direct)).toMatchObject({ width: 1440, height: 1000 });
    observations.desktopViewport = await viewport(direct);
    await expect(direct.getByText('网络异常，请检查网络连接', { exact: true })).toHaveCount(0);
    await expect(direct.getByRole('button', { name: '新建打包', exact: true })).toHaveCount(0);
    const pushButton = direct.getByRole('button', { name: '推送 SVN', exact: true });
    await expect(pushButton).toBeVisible();
    await expect(pushButton).toHaveClass(/ant-btn-primary/);
    await expect(direct.getByRole('button', { name: '下载全部', exact: true })).toBeVisible();
    const actionsHeader = direct.getByRole('heading', { name: '打包产物', exact: true }).locator('..').locator('..');
    await actionsHeader.screenshot({ path: path.join(reportDir, 'svn-actions-desktop.png') });
    await direct.screenshot({ path: path.join(reportDir, 'desktop-task.png'), fullPage: true });
    await direct.setViewportSize({ width: 375, height: 812 });
    await pushButton.scrollIntoViewIfNeeded();
    await expect(pushButton).toBeVisible();
    const buttonBounds = await pushButton.boundingBox();
    expect(buttonBounds).not.toBeNull();
    expect(buttonBounds!.x).toBeGreaterThanOrEqual(0);
    expect(buttonBounds!.x + buttonBounds!.width).toBeLessThanOrEqual(375);
    expect((await viewport(direct)).documentWidth).toBeLessThanOrEqual(375);
    await actionsHeader.screenshot({ path: path.join(reportDir, 'svn-actions-mobile.png') });
    observations.svnActions = { directPrimaryButton: true, desktop: true, mobileWidth: 375, mobileBounds: buttonBounds };
    await direct.close();
    await page.goto(deepLink);
    await expect(page.getByText('任务结束：万行日志末尾完整', { exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
  });

  await test.step('完整日志下载与源字节及 SHA-256 完全相同', async () => {
    const bytes = await download(page, () => page.getByRole('button', { name: '下载完整日志', exact: true }).click(), 'full-build.log');
    expect(bytes.equals(readFileSync(fixture.tasks.success.log))).toBe(true);
    expect(hash(bytes)).toBe(fixture.tasks.success.sha256);
    expect(bytes.toString('utf8').split('构建日志第 ').length - 1).toBe(10_000);
    observations.fullLog = { bytes: bytes.length, sha256: hash(bytes), sourceBytesEqual: true, numberedLines: 10_000 };
  });

  await test.step('中文单文件与含嵌套目录 ZIP 下载内容完整', async () => {
    const single = fixture.tasks.success.artifacts[0];
    const bytes = await download(page, () => page.getByRole('button', { name: `下载 ${single.name}`, exact: true }).click(), single.name);
    const source = path.join(path.dirname(fixture.tasks.success.log), 'artifacts', single.path);
    expect(bytes.equals(readFileSync(source))).toBe(true);
    const zip = await download(page, () => page.getByRole('button', { name: '下载全部', exact: true }).click(), 'artifacts.zip');
    const verify = spawnSync(process.env.CHECK_PYTHON || 'python', ['-c',
      'import base64,json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({n:base64.b64encode(z.read(n)).decode() for n in z.namelist()}))',
      path.join(reportDir, 'artifacts.zip')], { encoding: 'utf8', windowsHide: true });
    expect(verify.status, verify.stderr).toBe(0);
    const entries = JSON.parse(verify.stdout) as Record<string, string>;
    expect(Object.keys(entries).sort()).toEqual(fixture.tasks.success.artifacts.map(artifact => artifact.path).sort());
    for (const artifact of fixture.tasks.success.artifacts) {
      expect(Buffer.from(entries[artifact.path], 'base64').equals(readFileSync(path.join(path.dirname(source), artifact.path)))).toBe(true);
    }
    observations.downloads = { single: { bytes: bytes.length, sha256: hash(bytes) }, zip: { bytes: zip.length, sha256: hash(zip), entries: Object.keys(entries) } };
  });

  await test.step('运行中中文与 CRLF 日志由真实轮询追加显示', async () => {
    await page.goto(`/packages/${fixture.tasks.running.id}`);
    await expect(page.getByText('增量验收：初始日志', { exact: true })).toBeVisible();
    appendFileSync(fixture.tasks.running.log, '增量验收：中文追加完整\r\n第二行：CRLF 边界正常\r\n', 'utf8');
    await expect(page.getByText('增量验收：中文追加完整', { exact: true })).toBeVisible();
    await expect(page.getByText('第二行：CRLF 边界正常', { exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    observations.incrementalLog = { chinese: true, crlf: true, sha256: hash(readFileSync(fixture.tasks.running.log)) };
    await page.screenshot({ path: path.join(reportDir, 'desktop-incremental.png'), fullPage: true });
  });

  await test.step('终态日志缺失显示真实错误而非成功空态', async () => {
    await page.goto(`/packages/${fixture.tasks.nolog.id}`);
    await expect(page.getByText('日志加载失败', { exact: true })).toBeVisible();
    await expect(page.getByText('日志未生成或已清理', { exact: true })).toBeVisible();
    await expect(page.getByText('暂无日志', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '重试日志', exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: path.join(reportDir, 'missing-log.png'), fullPage: true });
  });

  await test.step('过期产物下载返回真实 404，界面显示原因且不创建空包', async () => {
    await page.goto(`/packages/${fixture.tasks.expired.id}`);
    const downloads: Download[] = [];
    const observeDownload = (item: Download) => downloads.push(item);
    page.on('download', observeDownload);
    const expiredArtifact = fixture.tasks.expired.artifacts[0];
    const singleResponse = page.waitForResponse(item => item.url().endsWith(`/api/packages/tasks/${fixture.tasks.expired.id}/artifacts/${expiredArtifact.id}/download/`));
    await page.getByRole('button', { name: `下载 ${expiredArtifact.name}`, exact: true }).click();
    const singleResult = await singleResponse;
    expect(singleResult.status()).toBe(404);
    const singleBody = await singleResult.json() as { message: string };
    expect(singleBody.message).toBe('产物文件不存在');
    await expect(page.getByText(singleBody.message, { exact: true })).toBeVisible();
    const response = page.waitForResponse(item => item.url().endsWith(`/api/packages/tasks/${fixture.tasks.expired.id}/download-all/`));
    await page.getByRole('button', { name: '下载全部', exact: true }).click();
    const result = await response;
    expect(result.status()).toBe(404);
    const body = await result.json() as { message: string };
    expect(body.message).toBe('没有可下载的有效产物文件');
    await expect(page.getByText(body.message, { exact: true })).toBeVisible();
    expect(downloads).toHaveLength(0);
    page.off('download', observeDownload);
    observations.expiredDownload = { single: { status: singleResult.status(), message: singleBody.message }, all: { status: result.status(), message: body.message }, downloadCount: downloads.length };
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: path.join(reportDir, 'expired-download.png'), fullPage: true });
  });

  await test.step('375px 实际视口可读取日志尾部，整页不意外横向溢出', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(deepLink);
    await expect(page.getByText('任务结束：万行日志末尾完整', { exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    const actual = await viewport(page);
    expect(actual).toMatchObject({ width: 375, height: 812 });
    expect(actual.documentWidth).toBeLessThanOrEqual(actual.width);
    observations.mobileViewport = actual;
    await expect(page.getByText('网络异常，请检查网络连接', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: path.join(reportDir, 'mobile-task.png'), fullPage: true });
  });
  expect(pageErrors).toEqual([]);
  expect(serverErrors).toEqual([]);
  // React Query 会主动取消过时请求；保留取消证据，真实网络失败仍须为零。
  expect(failedRequests.filter(request => request.error !== 'net::ERR_ABORTED')).toEqual([]);
});
