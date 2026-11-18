import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(process.env.SMOKE_MANIFEST!, 'utf8')) as {
  operator: { username: string }; password: string;
  release_flow: { project_id: string; repository_id: string; software_id: string; software_label: string; repository_name: string; legacy_project_id: string };
};

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: '本地账号', exact: true }).click();
  await page.getByPlaceholder('请输入本地账号').fill(fixture.operator.username);
  await page.getByPlaceholder('请输入密码', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: '登 录', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test('创建发布选择目标软件，下拉菜单缩屏后可重新打开并使用键盘选择', async ({ page }) => {
  await signIn(page);
  await page.goto(`/releases/create?project=${fixture.release_flow.project_id}`);

  await page.getByLabel('关联仓库', { exact: true }).click();
  await page.locator('.ant-select-item-option-content').filter({ hasText: fixture.release_flow.repository_name }).click();
  const software = page.getByLabel('目标软件', { exact: true });
  await software.click();
  const softwareOption = page.locator('.ant-select-item-option-content').filter({ hasText: fixture.release_flow.software_label });
  await expect(softwareOption).toBeVisible();
  await softwareOption.click();

  const branch = page.getByLabel('分支', { exact: true });
  const mainOption = page.locator('.ant-select-item-option-content').filter({ hasText: /^main$/ });
  await branch.click();
  await expect(mainOption).toBeVisible();
  await mainOption.click();
  await page.waitForLoadState('networkidle');
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  await branch.focus();
  await branch.press('ArrowDown');
  await expect(mainOption).toBeVisible();
  await branch.press('Enter');
  await expect(mainOption).toBeHidden();
  await expect(branch).toBeFocused();
  await branch.press('ArrowDown');
  await expect(mainOption).toBeVisible();
  await branch.press('Enter');
  await expect(mainOption).toBeHidden();
  await expect(branch).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('关联仓库后软件深链可直接使用，同一仓库可按原 Tag 发布', async ({ page }) => {
  await signIn(page);
  const flow = fixture.release_flow;
  await page.goto(`/releases/create?project=${flow.project_id}&software=${flow.software_id}`);
  await expect(page.getByTitle(flow.software_label, { exact: true })).toBeVisible();
  await expect(page.getByLabel('分支', { exact: true })).toBeEnabled();

  await page.goto(`/releases/create?project=${flow.legacy_project_id}&repository=${flow.repository_id}`);
  const software = page.getByLabel('目标软件', { exact: true });
  await expect(software).toBeEnabled();
  await software.click();
  await expect(page.locator('.ant-select-item-option-content').getByText(flow.software_label, { exact: true })).toBeVisible();
  await page.locator('.ant-select-item-option-content').getByText('按仓库发布', { exact: true }).click();
  await page.getByLabel('分支', { exact: true }).click();
  await page.locator('.ant-select-item-option-content').filter({ hasText: /^main$/ }).click();
  await expect(page.getByLabel('Tag 名', { exact: true })).toHaveValue(/^V\.\d+\.\d+\.\d+/);
  const createdResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/releases/' && response.request().method() === 'POST');
  await page.getByRole('button', { name: '创建发布', exact: true }).click();
  const created = await createdResponse;
  expect(created.status()).toBe(201);
  expect(created.request().postDataJSON().software).toBeUndefined();
  expect((await created.json()).data.tag_name).toMatch(/^V\.\d+\.\d+\.\d+/);
});
