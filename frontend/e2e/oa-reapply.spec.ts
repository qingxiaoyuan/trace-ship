import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openArchiveDirectoryPicker, searchArchiveDirectory } from './helpers/oa-directory';

interface Application {
  id: string; submission_id: string; previous_id: string | null; confirmation: string; status: string;
  form: Record<string, string | number>; source: { task_id: string; scope: string; path: string };
}
const fixture = JSON.parse(readFileSync(process.env.SMOKE_MANIFEST!, 'utf8')) as {
  password: string; oa_archive: { username: string; release_id: string; version: string; oa_url: string; control_url: string;
    tasks: Record<string, { id: string; name: string }> };
};
const sample = fixture.oa_archive;
const reportDir = process.env.SMOKE_REPORT_DIR!;
let evidence: Record<string, unknown>;
let errors: string[];
async function control(mode?: string) {
  const response = await fetch(sample.control_url, mode ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) } : {});
  expect(response.ok).toBeTruthy();
  return await response.json() as { count: number; requests: unknown[] };
}
async function releasePage(page: Page) {
  await page.goto(`/releases/${sample.release_id}`);
  await expect(page.getByRole('heading', { name: sample.version, exact: true })).toBeVisible();
  await page.getByRole('main').getByRole('button', { name: '打包任务', exact: true }).click();
}
async function openForm(page: Page, filename: string) {
  const selected = sample.tasks[filename.replace(/\.zip$/, '')];
  await openArchiveDirectoryPicker(page);
  const selectedOption = await searchArchiveDirectory(page, selected.name);
  await selectedOption.click();
  await page.getByRole('button', { name: '填写申请资料', exact: true }).click();
  await expect(page.getByRole('table', { name: '软件归档申请资料', exact: true })).toBeVisible();
}
async function responseTo(page: Page, action: () => Promise<unknown>, status = 201) {
  const pending = page.waitForResponse(response => response.url().endsWith('/oa-archive/submit/') && response.request().method() === 'POST', { timeout: 45_000 });
  await action();
  const response = await pending;
  expect(response.status()).toBe(status);
  return (await response.json()).data as Application;
}
async function send(page: Page) {
  return responseTo(page, () => page.getByRole('button', { name: '提交 OA 归档', exact: true }).click());
}
async function prompt(page: Page, title: string) {
  await page.getByRole('button', { name: '提交 OA 归档', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function capture(page: Page, label: string) {
  const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth }));
  expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
  const boxes = await page.getByRole('dialog').evaluateAll(dialogs => dialogs.map(dialog => {
    const rect = dialog.getBoundingClientRect();
    return { x: rect.x, width: rect.width };
  }).filter(rect => rect.width > 0));
  for (const rect of boxes) {
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(size.width);
  }
  evidence[label] = size;
  await page.screenshot({ path: path.join(reportDir, `oa-reapply-${label}.png`), animations: 'disabled' });
}
async function readHistory(page: Page, filename: string) {
  // 只读取导航后的查询，提交后的旧页面自动刷新可能仍在返回。
  const navigated = page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame() });
  const pending = navigated.then(() => page.waitForResponse(response => response.url().endsWith('/oa-archive/records/') && response.request().method() === 'GET')).then(response => response.json());
  await page.goto(`/releases/${sample.release_id}`);
  await expect(page.getByRole('heading', { name: sample.version, exact: true })).toBeVisible();
  await page.getByRole('main').getByRole('button', { name: '打包任务', exact: true }).click();
  const records = (await pending).data as Application[];
  return records.filter(item => item.source.task_id === sample.tasks[filename.replace(/\.zip$/, '')].id && item.source.scope === 'directory' && item.source.path === '.');
}

test.beforeEach(async ({ page }) => {
  evidence = { scope: '真实 Chromium、生产页面/REST、隔离 OA HTTP；未访问业务 OA', viewportKind: '浏览器视口模拟，未测手机真机' };
  errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/login');
  await page.getByRole('button', { name: '本地账号', exact: true }).click();
  await page.getByPlaceholder('请输入本地账号').fill(sample.username);
  await page.getByPlaceholder('请输入密码', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: '登 录', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto('/system/configs');
  const section = page.getByRole('region', { name: 'OA 软件归档', exact: true });
  await section.getByLabel('归档接口完整地址', { exact: true }).fill(sample.oa_url);
  const saved = page.waitForResponse(response => response.url().endsWith('/configs/oa-archive/') && response.request().method() === 'PUT');
  await section.getByRole('button', { name: '保存归档配置', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await control('success');
  await releasePage(page);
});
test.afterEach(async ({ page, browser }, info) => {
  evidence.status = info.status;
  evidence.browser = browser.version();
  evidence.node = process.version;
  evidence.pageErrors = errors;
  evidence.externalCount = (await control()).count;
  if (info.status !== 'passed') {
    evidence.failures = info.errors.map(error => error.message);
    await page.screenshot({ path: path.join(reportDir, `oa-reapply-${info.testId.slice(-8)}-failure.png`), fullPage: true }).catch(() => {});
  }
  writeFileSync(path.join(reportDir, `oa-reapply-${info.testId.slice(-8)}.json`), JSON.stringify(evidence, null, 2));
});

test('桌面再次申请提醒可取消，刷新不重发，多窗口旧确认被拒绝且历史不覆盖', async ({ page, context }) => {
  const filename = 'reapply.zip';
  const before = (await control()).count;
  await openForm(page, filename);
  await page.getByLabel('其他说明', { exact: true }).fill('首次资料\n原始末尾');
  const first = await send(page);
  expect(first.status).toBe('success');
  await page.reload();
  await page.getByRole('main').getByRole('button', { name: '打包任务', exact: true }).click();
  expect((await control()).count).toBe(before + 1);
  await openForm(page, filename);
  await expect(page.getByLabel('软件编号', { exact: true })).toHaveCount(0);
  await page.getByLabel('其他说明', { exact: true }).fill('第二次资料\n新末尾');
  const cancel = await prompt(page, '确认再次申请');
  await cancel.getByRole('button', { name: /取\s*消/ }).click();
  await expect(cancel).not.toBeVisible();
  expect((await control()).count).toBe(before + 1);
  const observer = await context.newPage();
  await releasePage(observer);
  await openForm(observer, filename);
  const stale = await prompt(observer, '确认再次申请');
  const confirmed = await prompt(page, '确认再次申请');
  await capture(page, 'desktop-confirmation');
  const second = await responseTo(page, () => confirmed.getByRole('button', { name: '确认再次申请', exact: true }).click());
  expect(second.previous_id).toBe(first.id);
  expect(second.confirmation).toBe('reapply');
  expect(second.submission_id).not.toBe(first.submission_id);
  expect(second.form.soft_number).toBe('');
  await responseTo(observer, () => stale.getByRole('button', { name: '确认再次申请', exact: true }).click(), 400);
  await expect(observer.getByText('该产物已有新的申请记录，请重新读取并确认最新结果', { exact: true })).toBeVisible();
  expect((await control()).count).toBe(before + 2);
  const records = await readHistory(page, filename);
  expect(records).toEqual([second, first]);
  const article = page.getByLabel('归档申请历史').getByRole('article').filter({ hasText: sample.tasks[filename.replace(/\.zip$/, '')].name }).last();
  await article.getByRole('button', { name: '查看申请资料', exact: true }).click();
  await expect(page.getByRole('table', { name: '已提交归档资料', exact: true })).toContainText('首次资料');
  await capture(page, 'desktop-history');
  evidence.records = records;
  evidence.noAutomaticResend = true;
  await observer.close();
  expect(errors).toEqual([]);
});

test('375px真实超时须核对未建单后主动重试，发送中其他窗口不能派发', async ({ page, context }) => {
  test.setTimeout(100_000);
  await page.setViewportSize({ width: 375, height: 812 });
  const filename = 'reapply-unknown.zip';
  await openForm(page, filename);
  await page.getByLabel('其他说明', { exact: true }).fill('超时仍保留\n完整末尾');
  await control('timeout');
  const before = (await control()).count;
  const started = Date.now();
  const pending = send(page);
  await expect.poll(async () => (await control()).count).toBe(before + 1);
  const observer = await context.newPage();
  await releasePage(observer);
  await openForm(observer, filename);
  await expect(observer.getByRole('button', { name: '提交 OA 归档', exact: true })).toBeDisabled();
  await observer.close();
  const first = await pending;
  expect(first.status).toBe('unknown');
  expect(Date.now() - started).toBeGreaterThanOrEqual(29_000);
  await page.reload();
  await page.getByRole('main').getByRole('button', { name: '打包任务', exact: true }).click();
  await openForm(page, filename);
  await expect(page.getByLabel('其他说明', { exact: true })).toHaveValue('超时仍保留\n完整末尾');
  const confirmation = await prompt(page, '确认主动重试');
  const retry = confirmation.getByRole('button', { name: '确认重试', exact: true });
  await expect(retry).toBeDisabled();
  await capture(page, 'mobile-unknown-confirmation');
  await confirmation.getByRole('checkbox', { name: '我已核对 OA，确认此前申请未建单', exact: true }).check();
  await expect(retry).toBeEnabled();
  await control('success');
  const second = await responseTo(page, () => retry.click());
  expect(second.confirmation).toBe('checked_no_order');
  expect(second.previous_id).toBe(first.id);
  expect((await control()).count).toBe(before + 2);
  const records = await readHistory(page, filename);
  expect(records).toEqual([second, first]);
  const historyRow = page.getByLabel('归档申请历史').getByRole('article').filter({ hasText: sample.tasks[filename.replace(/\.zip$/, '')].name }).first();
  await historyRow.scrollIntoViewIfNeeded();
  await expect(historyRow).toContainText('已核对 OA 未建单后重试');
  await capture(page, 'mobile-history');
  evidence.records = records;
  evidence.elapsedMs = Date.now() - started;
  expect(errors).toEqual([]);
});

test('明确失败保留修改后主动重试，独立历史保留原资料和确认方式', async ({ page }) => {
  const filename = 'reapply-failure.zip';
  await openForm(page, filename);
  await page.getByLabel('其他说明', { exact: true }).fill('失败时的资料');
  await control('failure');
  const before = (await control()).count;
  const first = await send(page);
  expect(first.status).toBe('failure');
  await page.getByLabel('其他说明', { exact: true }).fill('修改后的重试资料');
  const confirmation = await prompt(page, '确认主动重试');
  await expect(confirmation).toContainText('OA 返回失败不保证没有外部副作用');
  await control('success');
  const second = await responseTo(page, () => confirmation.getByRole('button', { name: '确认重试', exact: true }).click());
  expect(second.confirmation).toBe('retry');
  expect(second.previous_id).toBe(first.id);
  expect(second.form.other_description).toBe('修改后的重试资料');
  expect((await control()).count).toBe(before + 2);
  expect(await readHistory(page, filename)).toEqual([second, first]);
  evidence.records = [second, first];
  expect(errors).toEqual([]);
});
