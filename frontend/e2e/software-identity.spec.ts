import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const fixture = JSON.parse(readFileSync(process.env.SMOKE_MANIFEST!, 'utf8')) as {
  password: string;
  software_identity: { repository_id: string; project_id: string; owner: string; reader: string };
};
const { repository_id, project_id, owner, reader } = fixture.software_identity;
const softwareName = '身份验收客户端';
const renamed = '移动端验收客户端';

async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: '本地账号', exact: true }).click();
  await page.getByPlaceholder('请输入本地账号').fill(username);
  await page.getByPlaceholder('请输入密码', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: '登 录', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test('从仓库维护软件，关联项目自动可用，手机端可编辑和停用', async ({ page, browser }) => {
  await login(page, owner);
  await page.goto(`/repositories/${repository_id}/software`);
  await expect(page.getByRole('link', { name: '软件', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '登记软件' }).click();
  const registration = page.getByRole('dialog', { name: '登记软件' });
  await registration.getByLabel('软件名称').fill(softwareName);
  await registration.getByLabel('软件标识').fill('smoke-client');
  await registration.getByRole('button', { name: /^登\s*记$/ }).click();
  const row = page.getByRole('row').filter({ hasText: softwareName });
  await expect(row).toContainText('smoke-client');
  await expect(page.getByRole('columnheader', { name: '最近正式版' })).toBeVisible();
  const search = page.getByRole('searchbox', { name: '搜索软件' });
  await search.fill('missing-software');
  await expect(page.getByRole('table', { name: '仓库软件列表' }).getByText('没有匹配的软件')).toBeVisible();
  await search.fill('smoke-client');
  await expect(row).toBeVisible();
  await expect(page.getByText('共 1 个软件')).toBeVisible();
  await page.reload();
  await expect(row).toContainText('smoke-client');
  expect(await page.evaluate(() => [innerWidth, innerHeight])).toEqual([1440, 1000]);
  await page.screenshot({ path: path.join(process.env.SMOKE_REPORT_DIR!, 'software-identity-desktop.png') });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('article').filter({ hasText: softwareName }).getByRole('button', { name: /^编\s*辑$/ }).click();
  const editor = page.getByRole('dialog', { name: '编辑软件' });
  await editor.getByLabel('软件名称').fill(renamed);
  await editor.getByRole('button', { name: /^保\s*存$/ }).click();
  const renamedRow = page.getByRole('article').filter({ hasText: renamed });
  await expect(renamedRow.getByText('smoke-client')).toBeVisible();
  expect(await page.evaluate(() => [innerWidth, innerHeight])).toEqual([375, 812]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.screenshot({ path: path.join(process.env.SMOKE_REPORT_DIR!, 'software-identity-mobile.png') });

  await page.goto(`/projects/${project_id}/repos`);
  await expect(page.getByRole('heading', { name: '关联仓库', exact: true })).toBeVisible();
  await expect(page.getByText('选用软件', { exact: true })).toHaveCount(0);
  await page.goto(`/releases/create?project=${project_id}&repository=${repository_id}`);
  const target = page.getByLabel('目标软件', { exact: true });
  await target.click();
  await expect(page.locator('.ant-select-item-option-content').filter({ hasText: renamed })).toBeVisible();

  await page.goto(`/repositories/${repository_id}/software`);
  await renamedRow.getByRole('button', { name: '停用', exact: true }).click();
  await page.getByRole('button', { name: /^确\s*认$/ }).click();
  await expect(renamedRow.getByText('已停用', { exact: true })).toBeVisible();
  await page.goto(`/releases/create?project=${project_id}&repository=${repository_id}`);
  await target.click();
  await expect(page.locator('.ant-select-item-option-content').getByText('按仓库发布', { exact: true })).toBeVisible();
  await expect(page.locator('.ant-select-item-option-content').filter({ hasText: renamed })).toHaveCount(0);

  const readerPage = await browser.newPage();
  try {
    await login(readerPage, reader);
    await readerPage.goto(`/repositories/${repository_id}/software`);
    const readRow = readerPage.getByRole('row').filter({ hasText: renamed });
    await expect(readRow).toContainText('已停用');
    await expect(readRow.getByRole('button', { name: /^编\s*辑$/ })).toHaveCount(0);
    await expect(readerPage.getByRole('button', { name: '登记软件' })).toHaveCount(0);
  } finally {
    await readerPage.close();
  }
});
