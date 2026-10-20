import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface RepackageSample {
  release_id: string;
  config_id: string;
  config_name: string;
  project_id: string;
  repository_id: string;
  actor_id: string;
  version: string;
  tag_name: string;
  commit_hash: string;
  dispatch_receipts: string;
}

interface TaskIdentity {
  id: string;
  release: string;
  config: string;
  project: string;
  repository: string;
  triggered_by: string;
  triggered_by_name: string;
  name: string;
  version: string;
  tag_name: string;
  commit_hash: string;
  status: string;
  config_snapshot: {
    trigger_source: string;
    svn_push_enabled: boolean;
    custom_script: string;
    env_vars: Record<string, string>;
  };
}

const fixture = JSON.parse(readFileSync(process.env.SMOKE_MANIFEST!, 'utf8')) as {
  username: string;
  operator: { username: string; role: string; id: string };
  password: string;
  repackage: RepackageSample;
};
const sample = fixture.repackage;
const reportDir = process.env.SMOKE_REPORT_DIR!;
const observations: Record<string, unknown> = {
  sample: {
    release: sample.release_id, config: sample.config_id, project: sample.project_id,
    repository: sample.repository_id, actor: sample.actor_id, version: sample.version,
    tag: sample.tag_name, commit: sample.commit_hash,
  },
  externalBoundary: '外部仓库返回固定 Tag/SHA，投递仅记录任务；未执行构建、连接远端仓库或推送 SVN',
  steps: [],
};
const steps: string[] = [];
const pageErrors: string[] = [];
const serverErrors: { path: string; status: number }[] = [];

async function viewport(page: Page) {
  return page.evaluate(() => ({
    width: window.innerWidth, height: window.innerHeight,
    documentWidth: document.documentElement.scrollWidth,
  }));
}

function receipts() {
  if (!existsSync(sample.dispatch_receipts)) return [];
  return readFileSync(sample.dispatch_receipts, 'utf8').trim().split('\n')
    .filter(Boolean).map(line => JSON.parse(line) as { task_id: string });
}

test.afterEach(async ({ page, browser, context }, info) => {
  observations.actor = { role: fixture.operator.role, id: fixture.operator.id };
  observations.browser = { name: 'Chromium', version: browser.version(), headless: true };
  observations.environment = { node: process.version, platform: process.platform, arch: process.arch, runReport: 'report.json' };
  observations.mobile = '375px 浏览器视口模拟，未验证手机真机';
  observations.status = info.status;
  observations.actualViewport = await viewport(page).catch(() => null);
  observations.steps = steps;
  observations.pageErrors = pageErrors;
  observations.serverErrors = serverErrors;
  observations.stepsReport = 'playwright.json';
  if (info.status !== 'passed') {
    observations.failure = info.errors.map(error => error.message);
    await Promise.all(context.pages().map((current, index) => current.screenshot({
      path: path.join(reportDir, `repackage-failure-${index}.png`), fullPage: true, animations: 'disabled',
    }).catch(() => {})));
  }
  writeFileSync(path.join(reportDir, 'repackage-evidence.json'), JSON.stringify(observations, null, 2));
});

test('项目管理员从桌面发布详情选择已有配置补打固定版本，手机隐藏补打入口', async ({ page, context }) => {
  page.on('pageerror', error => pageErrors.push(error.message));
  context.on('response', response => {
    if (response.status() >= 500) serverErrors.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
  const beforeReceipts = receipts();
  let created: TaskIdentity;

  await test.step('生产登录页与 REST 接口建立项目管理员会话', async () => {
    await page.goto('/login');
    await page.getByRole('button', { name: '本地账号', exact: true }).click();
    await page.getByPlaceholder('请输入本地账号').fill(fixture.operator.username);
    await page.getByPlaceholder('请输入密码', { exact: true }).fill(fixture.password);
    const response = page.waitForResponse(item => item.url().endsWith('/api/auth/login/') && item.request().method() === 'POST');
    await page.getByRole('button', { name: '登 录', exact: true }).click();
    expect((await response).status()).toBe(200);
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForLoadState('networkidle');
    steps.push('项目管理员真实登录通过');
  });

  await test.step('1440px 发布详情展示固定版本补打和已有启用配置', async () => {
    const initialResponse = page.waitForResponse(response => response.url().endsWith(`/api/releases/${sample.release_id}/`) && response.request().method() === 'GET');
    await page.goto(`/releases/${sample.release_id}`);
    const initial = (await (await initialResponse).json() as { data: { id: string; status: string } }).data;
    observations.initialRelease = { id: initial.id, idType: typeof initial.id, status: initial.status, statusType: typeof initial.status };
    await expect(page.getByRole('heading', { name: sample.version, exact: true })).toBeVisible();
    await expect(page.getByText(`当前源码引用：${sample.tag_name}`, { exact: true })).toBeVisible();
    await expect(page.getByText(/源码引用核验失败/)).toHaveCount(0);
    const configResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/packages/configs/' && response.request().method() === 'GET');
    await page.getByRole('main').getByRole('button', { name: '打包任务', exact: true }).click();
    const section = page.getByRole('region', { name: '补打已发布版本', exact: true });
    await expect(section).toBeVisible();
    const configs = await configResponse;
    expect(configs.status()).toBe(200);
    const configQuery = new URL(configs.url()).searchParams;
    expect(configQuery.get('project')).toBe(sample.project_id);
    expect(configQuery.get('repository')).toBe(sample.repository_id);
    expect(configQuery.get('is_active')).toBe('true');
    await expect(section.getByText(`当前版本：${sample.version} / ${sample.tag_name}`, { exact: true })).toBeVisible();
    const select = section.getByRole('combobox', { name: '打包配置', exact: true });
    await expect(select).toBeVisible();
    await select.click();
    await page.getByText(sample.config_name, { exact: true }).click();
    await expect(section.getByTitle(sample.config_name, { exact: true })).toBeVisible();
    await select.click();
    await expect(page.getByText('已停用配置不得选择', { exact: true })).toHaveCount(0);
    await expect(page.getByText('其他项目配置不得选择', { exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(section.getByRole('textbox')).toHaveCount(0);
    await expect(section.getByRole('combobox')).toHaveCount(1);
    await page.waitForLoadState('networkidle');
    const actual = await viewport(page);
    expect(actual).toMatchObject({ width: 1440, height: 1000 });
    expect(actual.documentWidth).toBeLessThanOrEqual(actual.width);
    observations.desktopViewport = actual;
    await page.screenshot({ path: path.join(reportDir, 'desktop-repackage-config.png'), fullPage: true, animations: 'disabled' });
    steps.push('桌面显示固定发布与合法已有配置，停用和跨项目配置不可选');
  });

  await test.step('只提交 release_id，生产 API 创建固定身份任务并刷新摘要', async () => {
    const post = page.waitForResponse(response => response.url().endsWith(`/api/packages/configs/${sample.config_id}/trigger/`) && response.request().method() === 'POST');
    const refresh = page.waitForResponse(response => response.url().endsWith(`/api/releases/${sample.release_id}/`) && response.request().method() === 'GET');
    await page.getByRole('button', { name: '补打当前版本', exact: true }).click();
    const response = await post;
    expect(response.request().postDataJSON()).toEqual({ release_id: sample.release_id });
    expect(response.status()).toBe(201);
    created = (await response.json() as { data: TaskIdentity }).data;
    expect(created).toMatchObject({
      config: sample.config_id, release: sample.release_id, project: sample.project_id,
      repository: sample.repository_id, triggered_by: sample.actor_id, version: sample.version,
      tag_name: sample.tag_name, commit_hash: sample.commit_hash, status: 'queued',
      config_snapshot: {
        trigger_source: 'manual_release', svn_push_enabled: false,
        custom_script: 'exit 27', env_vars: { FIXED_SAMPLE: 'configured' },
      },
    });
    const refreshed = await refresh;
    expect(refreshed.status()).toBe(200);
    const release = (await refreshed.json() as { data: { id: string; status: string; package_tasks: { id: string }[] } }).data;
    observations.refreshedRelease = { id: release.id, idType: typeof release.id, status: release.status, statusType: typeof release.status };
    expect(release.package_tasks.map(task => task.id)).toContain(created.id);
    await expect(page.getByRole('main').getByText(created.name, { exact: true })).toBeVisible();
    await expect(page.getByText('已创建补打任务', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '查看新任务', exact: true })).toBeVisible();
    expect(receipts()).toEqual([...beforeReceipts, { task_id: created.id }]);
    observations.createdTask = created;
    observations.request = { method: 'POST', status: response.status(), body: { release_id: sample.release_id } };
    observations.summaryRefreshed = true;
    observations.dispatchReceipts = receipts();
    await page.screenshot({ path: path.join(reportDir, 'desktop-repackage-created.png'), fullPage: true, animations: 'disabled' });
    steps.push('POST 固定发布成功，任务身份与实际操作人正确，手动策略禁 SVN，摘要刷新');
  });

  await test.step('查看新任务进入正确详情并由真实 API 再次确认身份', async () => {
    const detail = page.waitForResponse(response => response.url().endsWith(`/api/packages/tasks/${created.id}/`) && response.request().method() === 'GET');
    await page.getByRole('button', { name: '查看新任务', exact: true }).click();
    await expect(page).toHaveURL(new URL(`/packages/${created.id}`, process.env.SMOKE_BASE_URL).href);
    const response = await detail;
    expect(response.status()).toBe(200);
    const task = (await response.json() as { data: TaskIdentity }).data;
    expect(task).toMatchObject({ ...created });
    await expect(page.getByRole('main').getByText('冒烟管理员', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '停止构建', exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    observations.taskDetail = { id: task.id, triggeredBy: task.triggered_by, path: new URL(page.url()).pathname };
    await page.screenshot({ path: path.join(reportDir, 'desktop-repackage-task.png'), fullPage: true, animations: 'disabled' });
    steps.push('查看新任务跳转与真实详情读取通过');
  });

  await test.step('375px 实际视口隐藏新增补打入口且不横向溢出', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/releases/${sample.release_id}`);
    await expect(page.getByRole('heading', { name: sample.version, exact: true })).toBeVisible();
    await page.getByRole('main').getByRole('button', { name: '打包任务', exact: true }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('region', { name: '补打已发布版本', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '补打当前版本', exact: true })).toHaveCount(0);
    const actual = await viewport(page);
    expect(actual).toMatchObject({ width: 375, height: 812 });
    expect(actual.documentWidth).toBeLessThanOrEqual(actual.width);
    observations.mobileViewport = actual;
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(reportDir, 'mobile-repackage-hidden.png'), animations: 'disabled' });
    steps.push('375px 手机隐藏补打入口，整页无横向溢出');
  });
  expect(pageErrors).toEqual([]);
  expect(serverErrors).toEqual([]);
});
