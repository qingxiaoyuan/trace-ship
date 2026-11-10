import { test, expect } from '@playwright/test';
import type { APIResponse, Download, Page, Route } from '@playwright/test';
import { appendFileSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
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
  settings: { username: string };
  reading: { release_ids: string[] };
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

async function downloadFromEndpoint(page: Page, action: () => Promise<void>, filename: string, endpoint: string) {
  const matches = (url: URL) => url.pathname === endpoint;
  let response: APIResponse | undefined;
  const forward = async (route: Route) => {
    // 透传真实服务响应，避免 Chromium 调试接口按文本读取时丢失 BOM。
    response = await route.fetch();
    await route.fulfill({ response });
  };
  await page.route(matches, forward);
  try {
    const bytes = await download(page, action, filename);
    expect(response?.status()).toBe(200);
    expect(response?.headers()['content-disposition']).toMatch(/^attachment;/);
    const source = await response!.body();
    expect(bytes.equals(source), `${filename} 必须逐字节等于同一次请求的后端响应`).toBe(true);
    return bytes;
  } finally {
    await page.unroute(matches, forward);
  }
}

async function capturePageEvidence(page: Page, screenshot: string, width: number, height: number) {
  await page.waitForLoadState('networkidle');
  const actual = await viewport(page);
  expect(actual).toMatchObject({ width, height });
  await page.screenshot({ path: path.join(reportDir, screenshot), fullPage: true });
  return { url: page.url(), viewport: actual, screenshot };
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
  test.setTimeout(90_000);
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

  await test.step('全部或部分产物缺失时批量下载返回 404，仍可单独下载有效产物', async () => {
    const availableArtifact = fixture.tasks.expired.artifacts[1];
    const availablePath = path.join(path.dirname(fixture.tasks.expired.log), 'artifacts', availableArtifact.path);
    const availableSource = readFileSync(availablePath);
    unlinkSync(availablePath);
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
    observations.expiredDownload = { single: { status: singleResult.status(), message: singleBody.message }, all: { status: result.status(), message: body.message }, downloadCount: downloads.length };
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: path.join(reportDir, 'expired-download.png'), fullPage: true });

    // 在同一个隔离任务恢复一份实际文件，保留另一份缺失记录，覆盖部分过期。
    writeFileSync(availablePath, availableSource);
    const partial = page.waitForResponse(item => item.url().endsWith(`/api/packages/tasks/${fixture.tasks.expired.id}/download-all/`));
    await page.getByRole('button', { name: '下载全部', exact: true }).click();
    const partialResult = await partial;
    expect(partialResult.status()).toBe(404);
    expect(partialResult.headers()['content-disposition']).toBeUndefined();
    const partialBody = await partialResult.json() as { message: string };
    expect(partialBody.message).toBe('部分产物文件不存在或已清理，请逐个下载仍可用的产物');
    await expect(page.getByText(partialBody.message, { exact: true })).toBeVisible();
    expect(downloads).toHaveLength(0);
    page.off('download', observeDownload);
    const available = await download(
      page, () => page.getByRole('button', { name: `下载 ${availableArtifact.name}`, exact: true }).click(), availableArtifact.name,
    );
    expect(available.equals(availableSource)).toBe(true);
    observations.partiallyExpired = { status: partialResult.status(), rejectedDownloadCount: downloads.length, availableSha256: hash(available) };
    await page.screenshot({ path: path.join(reportDir, 'partially-expired-download.png'), fullPage: true });
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

  await test.step('系统配置保存后，白名单外仍可在线查看，文件接口拒绝下载', async () => {
    const releasePath = `/releases/${fixture.reading.release_ids[0]}`;
    const reportPath = '/api/releases/dashboard/weekly-report/';
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/dashboard');
    const weeklyButton = page.getByRole('main').getByRole('button', { name: '导出周报', exact: true });
    const weekly = await downloadFromEndpoint(page, () => weeklyButton.click(), 'weekly-report.csv', reportPath);
    expect(weekly.subarray(0, 3).toString('hex')).toBe('efbbbf');
    expect(weekly.toString('utf8')).toContain('"VA.39.1.0"');
    const allowedWeekly = { url: page.url(), viewport: await viewport(page) };

    await page.goto(releasePath);
    const markdown = await downloadFromEndpoint(
      page, () => page.getByRole('button', { name: '导出 MD' }).click(), 'release.md', `/api${releasePath}/export-md/`,
    );
    expect(markdown.toString('utf8')).toContain('长文档结尾：全部发布说明完整可读。');
    const pdf = await downloadFromEndpoint(
      page, () => page.getByRole('button', { name: '导出 PDF' }).click(), 'release.pdf', `/api${releasePath}/export-pdf/`,
    );
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const word = await downloadFromEndpoint(
      page, () => page.getByRole('button', { name: '导出 Word' }).click(), 'release.docx', `/api${releasePath}/export-word/`,
    );
    const checkWord = spawnSync(process.env.CHECK_PYTHON || 'python', ['-c', [
      'import json, sys, zipfile',
      'from xml.etree import ElementTree',
      'with zipfile.ZipFile(sys.argv[1]) as archive:',
      '    assert archive.testzip() is None',
      '    for entry in archive.namelist():',
      '        if entry.endswith((".xml", ".rels")):',
      '            ElementTree.fromstring(archive.read(entry))',
      '    text = "".join(ElementTree.fromstring(archive.read("word/document.xml")).itertext())',
      '    assert "VA.39.1.0" in text',
      '    print(json.dumps(sorted(archive.namelist())))',
    ].join('\n'), path.join(reportDir, 'release.docx')], { encoding: 'utf8', windowsHide: true });
    expect(checkWord.status, checkWord.stderr).toBe(0);
    const wordEntries = JSON.parse(checkWord.stdout) as string[];
    expect(wordEntries).toEqual(expect.arrayContaining(['[Content_Types].xml', 'word/document.xml', '_rels/.rels']));
    const allowedRelease = { url: page.url(), viewport: await viewport(page) };

    const adminContext = await page.context().browser()!.newContext({ viewport: { width: 1440, height: 1000 } });
    const admin = await adminContext.newPage();
    try {
      await admin.goto(new URL('/login', process.env.SMOKE_BASE_URL).href);
      await admin.getByRole('button', { name: '本地账号', exact: true }).click();
      await admin.getByPlaceholder('请输入本地账号').fill(fixture.settings.username);
      await admin.getByPlaceholder('请输入密码', { exact: true }).fill(fixture.password);
      await admin.getByRole('button', { name: '登 录', exact: true }).click();
      await expect(admin).not.toHaveURL(/\/login/);
      await admin.goto(new URL('/system/configs', process.env.SMOKE_BASE_URL).href);
      const whitelist = admin.getByLabel('允许下载的 IP 地址或网段');
      const trustedProxies = admin.getByLabel('可信上游代理 IP（直连可留空）');
      const save = admin.getByRole('button', { name: '保存下载白名单' });
      const saveWhitelist = async () => {
        const saved = admin.waitForResponse((response) =>
          response.url().endsWith('/configs/download-policy/') && response.request().method() === 'PUT',
        );
        await save.click();
        expect((await saved).status()).toBe(200);
      };
      await expect(whitelist).toHaveValue('127.0.0.1/32');
      try {
        const hosts = ['127.0.0.1', ...Array.from({ length: 640 }, (_, i) => `10.20.${Math.floor(i / 256)}.${i % 256}`)];
        const normalized = hosts.map(host => `${host}/32`).join('\n');
        await whitelist.fill(hosts.join('\n'));
        await saveWhitelist();
        await admin.reload();
        await expect(whitelist).toHaveValue(normalized);
        await saveWhitelist();
        await expect(whitelist).toHaveValue(normalized);

        await trustedProxies.fill('192.0.2.0/24');
        const invalidProxy = admin.waitForResponse((response) =>
          response.url().endsWith('/configs/download-policy/') && response.request().method() === 'PUT',
        );
        await save.click();
        expect((await invalidProxy).status()).toBe(400);
        await expect(admin.getByText('请逐个填写上游代理的固定 IP 地址', { exact: true })).toBeVisible();
        await trustedProxies.fill('192.0.2.10');
        await whitelist.fill('10.20.30.0/24');
        await saveWhitelist();
        await admin.reload();
        await expect(trustedProxies).toHaveValue('192.0.2.10');
        await expect(whitelist).toBeEnabled();
        const settingsDesktop = await capturePageEvidence(admin, 'download-policy-config-desktop.png', 1440, 1000);
        await admin.setViewportSize({ width: 375, height: 812 });
        await expect(whitelist).toBeVisible();
        const settingsMobile = await capturePageEvidence(admin, 'download-policy-config-mobile.png', 375, 812);

        const rejectedDownloads: Download[] = [];
        const observeRejectedDownload = (item: Download) => rejectedDownloads.push(item);
        page.on('download', observeRejectedDownload);
        const rejected = page.waitForResponse((response) =>
          new URL(response.url()).pathname === `/api${releasePath}/export-md/`,
        );
        // 已打开页面可能仍有入口，实际点击验证后端拒绝且浏览器没有生成文件。
        await page.getByRole('button', { name: '导出 MD' }).click();
        const rejectedResponse = await rejected;
        expect(rejectedResponse.status()).toBe(403);
        expect(rejectedResponse.headers()['content-disposition']).toBeUndefined();
        await expect(page.getByText('当前网络不允许下载，请连接允许下载的内网后重试', { exact: true })).toBeVisible();
        expect(rejectedDownloads).toHaveLength(0);
        page.off('download', observeRejectedDownload);

        await page.goto(deepLink);
        await expect(page.getByText('任务结束：万行日志末尾完整', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: /下载/ })).toHaveCount(0);
        const token = await page.evaluate(() => localStorage.getItem('accessToken'));
        const denied = async (url: string) => {
          const response = await page.request.get(url, { headers: { Authorization: `Bearer ${token}` } });
          expect(response.status()).toBe(403);
          expect(response.headers()['content-disposition']).toBeUndefined();
          expect(response.headers()['content-type']).toContain('application/json');
          expect(await response.json()).toMatchObject({ message: '当前网络不允许下载，请连接允许下载的内网后重试' });
          return response.status();
        };
        const taskPath = `/api/packages/tasks/${fixture.tasks.success.id}/`;
        const taskStatuses = await Promise.all([
          denied(`${taskPath}logs/`),
          denied(`${taskPath}artifacts/${fixture.tasks.success.artifacts[0].id}/download/`),
          denied(`${taskPath}download-all/`),
        ]);
        const desktopTask = await capturePageEvidence(page, 'download-policy-denied.png', 1440, 1000);

        await page.setViewportSize({ width: 375, height: 812 });
        await expect(page.getByText('任务结束：万行日志末尾完整', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: /下载/ })).toHaveCount(0);
        const mobileTask = await capturePageEvidence(page, 'download-policy-denied-mobile.png', 375, 812);

        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(releasePath);
        await expect(page.getByText('长文档结尾：全部发布说明完整可读。')).toBeVisible();
        await expect(page.getByRole('button', { name: /导出/ })).toHaveCount(0);
        const releaseStatuses = await Promise.all(['md', 'pdf', 'word'].map(
          extension => denied(`/api${releasePath}/export-${extension}/`),
        ));
        const desktopRelease = await capturePageEvidence(page, 'download-policy-release-denied-desktop.png', 1440, 1000);
        await page.setViewportSize({ width: 375, height: 812 });
        await expect(page.getByText('长文档结尾：全部发布说明完整可读。')).toBeVisible();
        await expect(page.getByRole('button', { name: /导出/ })).toHaveCount(0);
        const mobileRelease = await capturePageEvidence(page, 'download-policy-release-denied-mobile.png', 375, 812);

        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto('/dashboard');
        const dashboard = page.getByRole('main');
        await expect(dashboard.getByRole('button', { name: '新建发布', exact: true })).toBeVisible();
        await expect(dashboard.getByRole('button', { name: '导出周报', exact: true })).toHaveCount(0);
        const deniedWeekly = await capturePageEvidence(page, 'download-policy-weekly-denied.png', 1440, 1000);
        observations.downloadPolicy = {
          settings: { desktop: settingsDesktop, mobile: settingsMobile, resavedWhitelistCharacters: normalized.length },
          task: { desktop: desktopTask, mobile: mobileTask, onlineLog: true, deniedStatuses: taskStatuses },
          release: {
            allowed: allowedRelease, denied: { desktop: desktopRelease, mobile: mobileRelease },
            downloaded: { markdown: hash(markdown), pdf: hash(pdf), word: hash(word), wordEntries, sourceBytesEqual: true },
            deniedStatuses: releaseStatuses, rejectedClickDownloads: rejectedDownloads.length,
          },
          weekly: {
            allowed: allowedWeekly, denied: deniedWeekly, deniedStatus: await denied(reportPath),
            downloaded: { filename: 'weekly-report.csv', sha256: hash(weekly), sourceBytesEqual: true },
            mobile: '周报入口仅桌面提供',
          },
        };
      } finally {
        const token = await admin.evaluate(() => localStorage.getItem('accessToken'));
        const restored = await admin.request.put(new URL('/api/system/configs/download-policy/', process.env.SMOKE_BASE_URL).href, {
          data: { allowed_cidrs: '127.0.0.1/32' },
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(restored.status()).toBe(200);
      }
    } finally {
      await adminContext.close();
    }
  });
  expect(pageErrors).toEqual([]);
  expect(serverErrors).toEqual([]);
  // React Query 会主动取消过时请求；保留取消证据，真实网络失败仍须为零。
  expect(failedRequests.filter(request => request.error !== 'net::ERR_ABORTED')).toEqual([]);
});
