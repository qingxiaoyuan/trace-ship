import { test, expect } from '@playwright/test';
import type { Page, Locator } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface Artifact { id: string; name: string; path: string }
interface OaSample {
  username: string; actor_id: string; actor_name: string; release_id: string; version: string;
  git_hash: string; software_name: string; changes: string; release_doc: string; document_source: string;
  oa_url: string; control_url: string;
  tasks: Record<string, { id: string; name: string; artifacts: Artifact[]; root_url: string }>;
}
interface Application {
  id: string; status: string; form: Record<string, string | number>;
  operator: { id: string; username: string }; source: { task_id: string; path: string; git_hash: string };
  soft_number: string; software_archive_id: unknown; number_apply_id: unknown;
}
interface Receipt { body: Record<string, string | number>; contentType: string; hasAuthorization: boolean; hasCookie: boolean; mode: string }
const fixture = JSON.parse(readFileSync(process.env.SMOKE_MANIFEST!, 'utf8')) as { password: string; oa_archive: OaSample };
const sample = fixture.oa_archive;
const reportDir = process.env.SMOKE_REPORT_DIR!;
const labels = ['申请人', '软件名称', '软件版本', '接收人', '软件来源', '产物 SVN 地址', 'SN', '变更内容', '变更原因', '其他说明', '软件编号', '申请数量'];
let evidence: Record<string, unknown>;
let pageErrors: string[];

async function control(body?: object) {
  const response = await fetch(sample.control_url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  expect(response.ok).toBeTruthy();
  return await response.json() as { count: number; requests: Receipt[] };
}
async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: '本地账号', exact: true }).click();
  await page.getByPlaceholder('请输入本地账号').fill(sample.username);
  await page.getByPlaceholder('请输入密码', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: '登 录', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
async function configure(page: Page) {
  await page.goto('/system/configs');
  const section = page.getByRole('region', { name: 'OA 软件归档', exact: true });
  await section.getByLabel('归档接口完整地址', { exact: true }).fill(sample.oa_url);
  const saved = page.waitForResponse(response => response.url().endsWith('/configs/oa-archive/') && response.request().method() === 'PUT');
  await section.getByRole('button', { name: '保存归档配置', exact: true }).click();
  expect((await saved).status()).toBe(200);
}
async function releasePage(page: Page) {
  await page.goto(`/releases/${sample.release_id}`);
  await expect(page.getByRole('heading', { name: sample.version, exact: true })).toBeVisible();
  await page.getByRole('main').getByRole('button', { name: '打包任务', exact: true }).click();
}
function artifact(name: string) {
  return sample.tasks.first.artifacts.find(item => item.name === name)!;
}
function archiveField(page: Page, label: string) {
  return page.getByRole(['申请人', '接收人', '软件来源'].includes(label) ? 'combobox' : 'textbox', { name: label, exact: true });
}
async function openForm(page: Page, selected: Artifact) {
  await page.getByRole('button', { name: '准备 OA 归档', exact: true }).click();
  await page.getByLabel('归档产物', { exact: true }).selectOption(`${sample.tasks.first.id}:${selected.id}`);
  await page.getByRole('button', { name: '填写申请资料', exact: true }).click();
  const table = page.getByRole('table', { name: '软件归档申请资料', exact: true });
  await expect(table).toBeVisible();
  return table;
}
async function screenshot(page: Page, key: string, table?: Locator) {
  const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth }));
  expect(actual.documentWidth).toBeLessThanOrEqual(actual.width);
  if (table) {
    const box = await table.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(actual.width);
  }
  evidence[key] = actual;
  await page.screenshot({ path: path.join(reportDir, `oa-${key}.png`), animations: 'disabled' });
}
async function history(page: Page, selected: Artifact, expected: Record<string, string | number>) {
  await page.waitForLoadState('networkidle');
  const release = page.waitForResponse(response => response.url().endsWith(`/releases/${sample.release_id}/`) && response.request().method() === 'GET');
  await page.reload();
  expect((await (await release).json()).data.release_doc).toBe(sample.release_doc);
  const records = page.waitForResponse(response => response.url().endsWith(`/releases/${sample.release_id}/oa-archive/records/`) && response.request().method() === 'GET');
  await page.getByRole('main').getByRole('button', { name: '打包任务', exact: true }).click();
  const items = (await (await records).json()).data as Application[];
  const item = items.find(row => row.source.task_id === sample.tasks.first.id && row.source.path === selected.path)!;
  expect(item.form).toEqual(expected);
  expect(item.operator).toMatchObject({ id: sample.actor_id, username: sample.username });
  expect(item.source.git_hash).toBe(sample.git_hash);
  const article = page.getByRole('article').filter({ hasText: selected.path });
  await article.getByRole('button', { name: '查看申请资料', exact: true }).click();
  const table = page.getByRole('table', { name: '已提交归档资料', exact: true });
  await expect(table).toBeVisible();
  const content = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: '变更内容', exact: true }) }).getByRole('cell');
  await expect(content).toHaveText(String(expected.edit_content));
  expect(await content.evaluate(element => getComputedStyle(element).whiteSpace)).toBe('pre-wrap');
  evidence.history = { record: item, rows: await table.getByRole('rowheader').allTextContents(), contentPreserved: true, originalReleaseUnchanged: true };
  await screenshot(page, `${test.info().testId.slice(-8)}-history`, table);
  // 展示并截图长文末尾，证明完整记录可以在弹窗内滚动阅读。
  await content.evaluate(element => element.scrollIntoView({ block: 'end' }));
  await page.screenshot({ path: path.join(reportDir, `oa-${test.info().testId.slice(-8)}-history-tail.png`), animations: 'disabled' });
  await table.locator('xpath=ancestor::*[@role="dialog"]').getByRole('button', { name: 'Close', exact: true }).click();
  return item;
}
async function send(page: Page) {
  const response = page.waitForResponse(item => item.url().endsWith('/oa-archive/submit/') && item.request().method() === 'POST', { timeout: 45_000 });
  await page.getByRole('button', { name: '提交 OA 归档', exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(201);
  evidence.submit = { status: result.status(), body: result.request().postDataJSON() };
  return (await result.json()).data as Application;
}

test.beforeEach(async ({ page }) => {
  evidence = { source: sample.document_source, releaseId: sample.release_id, role: '隔离超管/项目管理员', viewportKind: '浏览器视口模拟，未测手机真机' };
  pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await login(page);
  await configure(page);
  await control({ mode: 'success' });
});
test.afterEach(async ({ page, browser }, info) => {
  evidence.browser = { name: 'Chromium', version: browser.version(), headless: true };
  evidence.environment = { node: process.version, platform: process.platform, runReport: 'report.json' };
  evidence.status = info.status;
  evidence.pageErrors = pageErrors;
  evidence.external = await control().catch(() => null);
  if (info.status !== 'passed') {
    evidence.errors = info.errors.map(error => error.message);
    await page.screenshot({ path: path.join(reportDir, `oa-${info.testId.slice(-8)}-failure.png`), fullPage: true }).catch(() => {});
  }
  writeFileSync(path.join(reportDir, `oa-${info.testId.slice(-8)}-evidence.json`), JSON.stringify(evidence, null, 2));
});

test('桌面归档完整编辑、字段定位、对象草稿和标签保活，成功后从历史读取原样资料', async ({ page }) => {
  test.setTimeout(90_000);
  const selected = artifact('安装包@1%.zip');
  await page.goto(`/releases/${sample.release_id}`);
  await expect(page.getByRole('heading', { name: sample.version, exact: true })).toBeVisible();
  const notes = page.getByRole('table').filter({ hasText: '人工保存首行' });
  await expect(notes.locator('strong').filter({ hasText: '归档重点' })).toBeVisible();
  await expect(notes.getByRole('link', { name: '说明链接', exact: true })).toHaveAttribute('href', 'https://example.invalid/oa/help');
  expect(await notes.locator('br').count()).toBeGreaterThan(0);
  evidence.releaseDom = { strong: true, link: true, breaks: true };
  await page.getByRole('main').getByRole('button', { name: '打包任务', exact: true }).click();
  const table = await openForm(page, selected);
  expect((await table.getByRole('rowheader').allTextContents()).map(label => label.replace(' *', ''))).toEqual(labels);
  expect(await table.getByRole('row').count()).toBe(12);
  expect(await table.getByRole('cell').count()).toBe(12);
  await expect(page.getByLabel('变更内容', { exact: true })).toHaveValue(sample.changes);
  await expect(page.getByLabel('SN', { exact: true })).toHaveValue(sample.git_hash);
  await expect(archiveField(page, '软件名称')).toHaveValue(sample.software_name);
  for (const label of ['申请人', '软件名称', '软件版本', '接收人']) await archiveField(page, label).fill('');
  const before = (await control()).count;
  await page.getByRole('button', { name: '提交 OA 归档', exact: true }).click();
  await expect(archiveField(page, '申请人')).toBeFocused();
  for (const label of ['申请人', '软件名称', '软件版本', '接收人']) await expect(page.getByText(`请填写${label}`, { exact: true })).toBeVisible();
  expect((await control()).count).toBe(before);
  evidence.requiredFocus = '申请人';
  const expected = {
    docCreator: '人工申请人', applyCount: 1, soft_name: '人工确认软件 | 桌面', soft_version: '手填版本 88.1',
    developer: 'oa.receiver', soft_source: '内部自制', git_svn: 'https://example.invalid/manual/package.zip',
    sn_code: '人工补充 SN', edit_content: `${sample.changes}\n\n本次申请独立补充长文结尾。`,
    edit_reason: '修复说明\n保留第二行', other_description: '第一个产物独立草稿', soft_number: '',
  };
  const fields: [string, string][] = [['申请人', 'docCreator'], ['软件名称', 'soft_name'], ['软件版本', 'soft_version'], ['接收人', 'developer'], ['产物 SVN 地址', 'git_svn'], ['SN', 'sn_code'], ['变更内容', 'edit_content'], ['变更原因', 'edit_reason'], ['其他说明', 'other_description']];
  for (const [label, field] of fields) await archiveField(page, label).fill(String(expected[field as keyof typeof expected]));
  await page.getByLabel('软件来源', { exact: true }).selectOption('内部自制');
  await archiveField(page, '申请人').scrollIntoViewIfNeeded();
  await screenshot(page, 'desktop-form', table);
  expect(evidence['desktop-form']).toMatchObject({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '关闭并保留草稿', exact: true }).click();
  await openForm(page, artifact('second.zip'));
  await expect(page.getByLabel('其他说明', { exact: true })).toHaveValue('');
  await page.getByLabel('其他说明', { exact: true }).fill('第二个产物独立草稿');
  await page.getByRole('button', { name: '关闭并保留草稿', exact: true }).click();
  await page.getByRole('main').getByRole('button', { name: '发布说明', exact: true }).click();
  await page.getByRole('main').getByRole('button', { name: '打包任务', exact: true }).click();
  await openForm(page, selected);
  for (const [label, field] of fields) await expect(archiveField(page, label)).toHaveValue(String(expected[field as keyof typeof expected]));
  const result = await send(page);
  expect(result.status).toBe('success');
  const received = await control();
  expect(received.count).toBe(before + 1);
  expect(received.requests.at(-1)).toMatchObject({ body: expected, contentType: 'application/json', hasAuthorization: false, hasCookie: false });
  expect(Object.keys(received.requests.at(-1)!.body).sort()).toEqual(Object.keys(expected).sort());
  await expect(page.getByRole('table', { name: '软件归档申请资料', exact: true })).not.toBeVisible();
  await openForm(page, artifact('second.zip'));
  await expect(page.getByLabel('其他说明', { exact: true })).toHaveValue('第二个产物独立草稿');
  await page.getByRole('button', { name: '关闭并保留草稿', exact: true }).click();
  await openForm(page, selected);
  await expect(page.getByLabel('其他说明', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '关闭并保留草稿', exact: true }).click();
  const saved = await history(page, selected, expected);
  expect(saved.software_archive_id).toEqual({ opaque: { ticket: `archive-${received.count}` } });
  expect(saved.number_apply_id).toBe(`number-${received.count}`);
  expect((await control()).count).toBe(before + 1);
  evidence.drafts = { isolatedByArtifact: true, keptAcrossTabs: true, successClearedOnlyCurrent: true };
  expect(pageErrors).toEqual([]);
});

test('375px 手机可编辑并首次提交已有软件编号，历史表格和主操作完整可用', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await releasePage(page);
  const selected = artifact('mobile.zip');
  const table = await openForm(page, selected);
  await expect(page.getByLabel('变更内容', { exact: true })).toHaveValue(sample.changes);
  await screenshot(page, 'mobile-form-top', table);
  await archiveField(page, '接收人').fill('');
  await page.getByRole('button', { name: '提交 OA 归档', exact: true }).click();
  await expect(archiveField(page, '接收人')).toBeFocused();
  await archiveField(page, '接收人').fill(sample.username);
  evidence.requiredFocus = '接收人';
  await page.getByLabel('软件编号', { exact: true }).fill('EXISTING-SMOKE-088');
  await page.getByLabel('变更原因', { exact: true }).fill('手机确认\n第二行');
  await page.getByLabel('变更内容', { exact: true }).evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollIntoView({ block: 'center' }); });
  await screenshot(page, 'mobile-form-tail', table);
  expect(evidence['mobile-form-tail']).toMatchObject({ width: 375, height: 812 });
  await expect(page.getByRole('button', { name: '提交 OA 归档', exact: true })).toBeInViewport();
  const before = (await control()).count;
  const result = await send(page);
  expect(result.status).toBe('success');
  expect(result.soft_number).toBe('EXISTING-SMOKE-088');
  expect(result.number_apply_id).toBeNull();
  expect(result.form.edit_reason).toBe('手机确认\n第二行');
  expect(result.form.edit_content).toBe(sample.changes);
  const received = await control();
  expect(received.count).toBe(before + 1);
  expect(received.requests.at(-1)!.body).toEqual(result.form);
  await history(page, selected, result.form);
  expect((await control()).count).toBe(before + 1);
  expect(pageErrors).toEqual([]);
});

for (const mode of ['failure', 'timeout'] as const) {
  test(`${mode === 'failure' ? 'OA 明确失败' : '真实 OA 超时'}保留输入和历史，重开及刷新不自动重发`, async ({ page, context }) => {
    test.setTimeout(90_000);
    await releasePage(page);
    const selected = artifact(`${mode}.zip`);
    await openForm(page, selected);
    await page.getByLabel('其他说明', { exact: true }).fill(`${mode} 场景保留输入\n末行`);
    await control({ mode });
    const before = (await control()).count;
    const started = Date.now();
    const pending = send(page);
    if (mode === 'timeout') {
      await expect.poll(async () => (await control()).count).toBe(before + 1);
      await expect(archiveField(page, '申请人')).toBeDisabled();
      await page.getByRole('button', { name: /提交 OA 归档$/ }).click({ force: true });
      expect((await control()).count).toBe(before + 1);
      const observer = await context.newPage();
      await releasePage(observer);
      await expect(observer.getByRole('article').filter({ hasText: selected.path })).toContainText('发送中');
      await screenshot(observer, 'timeout-sending');
      await observer.close();
    }
    const result = await pending;
    expect(result.status).toBe(mode === 'failure' ? 'failure' : 'unknown');
    if (mode === 'timeout') expect(Date.now() - started).toBeGreaterThanOrEqual(29_000);
    evidence.elapsedMs = Date.now() - started;
    await expect(page.getByLabel('其他说明', { exact: true })).toHaveValue(`${mode} 场景保留输入\n末行`);
    await screenshot(page, `${mode}-result`);
    await page.getByRole('button', { name: '关闭并保留草稿', exact: true }).click();
    await openForm(page, selected);
    await expect(page.getByLabel('其他说明', { exact: true })).toHaveValue(`${mode} 场景保留输入\n末行`);
    await page.getByRole('button', { name: '关闭并保留草稿', exact: true }).click();
    await history(page, selected, result.form);
    expect((await control()).count).toBe(before + 1);
    evidence.noAutomaticResend = true;
    expect(pageErrors).toEqual([]);
  });
}
