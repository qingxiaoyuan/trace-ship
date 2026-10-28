import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(process.env.SMOKE_MANIFEST!, 'utf8')) as {
  operator: { username: string }; password: string;
  release_flow: { project_id: string; repository_name: string };
};

test('创建发布的下拉菜单在缩屏后可重新打开并使用键盘选择', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: '本地账号', exact: true }).click();
  await page.getByPlaceholder('请输入本地账号').fill(fixture.operator.username);
  await page.getByPlaceholder('请输入密码', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: '登 录', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto(`/releases/create?project_id=${fixture.release_flow.project_id}`);

  const repository = page.getByLabel('目标仓库', { exact: true });
  await repository.click();
  const repositoryOption = page.locator('.ant-select-item-option-content').filter({ hasText: fixture.release_flow.repository_name });
  await expect(repositoryOption).toBeVisible();
  await repositoryOption.click();

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
