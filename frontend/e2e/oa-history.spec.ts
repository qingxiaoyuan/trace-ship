import { test, expect } from '@playwright/test';
import type { Page, Locator } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openArchiveDirectoryPicker, searchArchiveDirectory } from './helpers/oa-directory';

const fixture = JSON.parse(readFileSync(process.env.SMOKE_MANIFEST!, 'utf8'));
const sample = fixture.oa_archive;
const reportDir = process.env.SMOKE_REPORT_DIR!;
const paths = { history: '目录 空格/历史安装包@1%.zip', supplement: '目录 空格/补录安装包.zip' };
let evidence: Record<string, unknown>;

async function control(body?: object) {
  const response = await fetch(sample.control_url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  expect(response.ok).toBeTruthy();
  return await response.json();
}
async function releasePage(page: Page) {
  await page.goto(`/releases/${sample.release_id}`);
  await expect(page.getByRole('heading', { name: sample.version, exact: true })).toBeVisible();
}
async function shot(page: Page, name: string, table?: Locator) {
  const bounds = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth }));
  expect(bounds.documentWidth).toBeLessThanOrEqual(bounds.width);
  if (table) {
    const box = await table.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(bounds.width);
  }
  evidence[name] = bounds;
  await page.screenshot({ path: path.join(reportDir, `oa-history-${name}.png`), animations: 'disabled' });
}
async function choose(page: Page, key: keyof typeof paths) {
  await openArchiveDirectoryPicker(page);
  const selectedOption = await searchArchiveDirectory(page, sample.tasks[key].name);
  await selectedOption.click();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /进入目录/ })).toHaveCount(0);
  await shot(page, `${key}-picker`);
  const response = page.waitForResponse(item => item.url().endsWith('/oa-archive/prepare/') && item.request().method() === 'POST');
  await page.getByRole('button', { name: '填写申请资料', exact: true }).click();
  expect((await response).status()).toBe(200);
  const table = page.getByRole('table', { name: '软件归档申请资料', exact: true });
  await expect(table).toBeVisible();
  await expect(page.getByText(`${key === 'supplement' ? '从 SVN 补录' : '当前 SVN 目录'} · 整个产物目录`, { exact: true })).toBeVisible();
  await expect(page.getByLabel('SN', { exact: true })).toHaveValue(sample.git_hash);
  await expect(page.getByLabel('代码 Git 分支', { exact: true })).toHaveValue(sample.branch);
  return table;
}
async function submit(page: Page) {
  const pending = page.waitForResponse(item => item.url().endsWith('/oa-archive/submit/') && item.request().method() === 'POST');
  await page.getByRole('button', { name: '提交 OA 归档', exact: true }).click();
  return await pending;
}

test.beforeEach(async ({ page }) => {
  evidence = { source: '真实隔离 SVN + HTTP，历史清单与无清单样本，未连接业务服务', viewportKind: '浏览器视口模拟，未测手机真机' };
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
  await control({ mode: 'success' });
});
test.afterEach(async ({ page, browser }, info) => {
  evidence.status = info.status;
  evidence.browser = { name: 'Chromium', version: browser.version(), platform: process.platform };
  if (info.status !== 'passed') {
    evidence.errors = info.errors.map(error => error.message);
    await page.screenshot({ path: path.join(reportDir, `oa-history-${info.testId.slice(-8)}-failure.png`), fullPage: true }).catch(() => {});
  }
  writeFileSync(path.join(reportDir, `oa-history-${info.testId.slice(-8)}-evidence.json`), JSON.stringify(evidence, null, 2));
});

for (const key of ['history', 'supplement'] as const) {
  test(`${key === 'history' ? '1440px 历史清单' : '375px 无清单补录'}在真实 SVN 选择整个目录并编辑提交及回读独立来源`, async ({ page }) => {
    test.setTimeout(90_000);
    if (key === 'supplement') await page.setViewportSize({ width: 375, height: 812 });
    await releasePage(page);
    let table = await choose(page, key);
    const before = (await control()).count;
    if (key === 'history') {
      await control({ svn: 'delete', path: key });
      await page.getByLabel('代码 Git 分支', { exact: true }).fill('release/other-branch');
      const denied = await submit(page);
      expect(denied.status()).toBe(409);
      expect((await denied.json()).data.state).toBe('missing');
      expect((await control()).count).toBe(before);
      await expect(page.getByText('SVN 当前路径不存在', { exact: true }).first()).toBeVisible();
      await shot(page, 'history-deleted');
      evidence.deletedBeforeSubmit = { status: 409, dispatched: false, manualBranchCannotBypass: true };
      await control({ svn: 'write', path: `${key}/${paths[key]}`, content: '恢复当前文件' });
      await releasePage(page);
      table = await choose(page, key);
    }
    // 选择目录后覆盖其中交付文件；提交保存最新当前文件依据，不冒充原构建元数据。
    const content = `归档时当前内容-${key}`;
    await control({ svn: 'write', path: `${key}/${paths[key]}`, content });
    const edited = `${sample.changes}\n\n历史归档人工补充 | ${key}\n保留末行`;
    await page.getByLabel('变更内容', { exact: true }).fill(edited);
    await page.getByLabel('代码 Git 分支', { exact: true }).fill('release/manual-branch');
    await page.getByLabel('其他说明', { exact: true }).fill(`${key} 的独立草稿`);
    await page.getByLabel('SN', { exact: true }).scrollIntoViewIfNeeded();
    await shot(page, `${key}-form`, table);
    expect(evidence[`${key}-form`]).toMatchObject({ width: key === 'history' ? 1440 : 375 });
    await expect(page.getByRole('button', { name: '提交 OA 归档', exact: true })).toBeInViewport();
    const response = await submit(page);
    expect(response.status()).toBe(201);
    const record = (await response.json()).data;
    expect(record.status).toBe('success');
    expect(record.source).toMatchObject({ kind: 'svn', supplemented: key === 'supplement', task_id: sample.tasks[key].id, scope: 'directory', path: '.', git_hash: sample.git_hash });
    const source = record.source.artifact;
    expect(source.scope).toBe('directory');
    expect(source.current.kind).toBe('dir');
    expect(source.current.files).toEqual(expect.arrayContaining([expect.objectContaining({ path: paths[key], size: Buffer.byteLength(content) })]));
    if (key === 'history') expect(source.original.files).toEqual([expect.objectContaining({ path: paths[key], size: null, sha256: null, revision: null })]);
    else expect(source.original).toEqual({ artifact_count: null, files: [] });
    expect(source.current).not.toHaveProperty('size');
    expect(source.original).not.toHaveProperty('sha256');
    expect(record.form.sn_code).toBe(sample.git_hash);
    expect(record.form.edit_content).toBe(edited);
    expect(record.form.git_svn).toBe('release/manual-branch');
    const receipts = await control();
    expect(receipts.count).toBe(before + 1);
    expect(receipts.requests.at(-1).body).toEqual(record.form);
    expect(receipts.requests.at(-1).hasAuthorization).toBe(false);
    await expect(page.getByRole('table', { name: '软件归档申请资料', exact: true })).not.toBeVisible();
    await releasePage(page);
    await page.getByRole('main').getByRole('button', { name: '打包任务', exact: true }).click();
    const article = page.getByLabel('归档申请历史').getByRole('article').filter({ hasText: sample.tasks[key].name });
    await expect(article).toContainText(key === 'supplement' ? '从 SVN 补录' : '当前 SVN 目录');
    await article.getByRole('button', { name: '查看申请资料', exact: true }).click();
    const history = page.getByRole('table', { name: '已提交归档资料', exact: true });
    const changes = history.getByRole('row').filter({ has: page.getByRole('rowheader', { name: '变更内容', exact: true }) }).getByRole('cell');
    await expect(changes).toHaveText(edited);
    expect(await changes.evaluate(element => getComputedStyle(element).whiteSpace)).toBe('pre-wrap');
    await shot(page, `${key}-record`, history);
    evidence.application = record;
    evidence.currentSize = Buffer.byteLength(content);
    evidence.originalUnknown = true;
    evidence.requestsAdded = 1;
  });
}
