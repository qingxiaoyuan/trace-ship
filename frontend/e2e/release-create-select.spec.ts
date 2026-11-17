import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(process.env.SMOKE_MANIFEST!, 'utf8')) as {
  operator: { username: string }; password: string;
  release_flow: { project_id: string; repository_id: string; software_id: string; software_label: string; legacy_project_id: string };
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

test('新建发布的软件深链仅预选当前项目可用软件，无选用的项目保留空状态', async ({ page }) => {
  await signIn(page);
  const flow = fixture.release_flow;
  await page.goto(`/releases/create?project=${flow.project_id}&software=${flow.software_id}`);
  await expect(page.getByTitle(flow.software_label, { exact: true })).toBeVisible();
  await expect(page.getByLabel('分支', { exact: true })).toBeEnabled();
  await page.goto(`/releases/create?project=${flow.legacy_project_id}&software=${flow.software_id}`);
  await expect(page.getByText('当前项目没有可发布的软件', { exact: true })).toBeVisible();
  await expect(page.getByLabel('目标软件', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('目标仓库', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '创建发布', exact: true })).toBeDisabled();
  const oldCreateStatus = await page.evaluate(async ({ project, repository }) => {
    const response = await fetch('/api/releases/', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('accessToken'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, repository, release_type: 'formal', branch: 'main' }),
    });
    return response.status;
  }, { project: flow.legacy_project_id, repository: flow.repository_id });
  expect(oldCreateStatus).toBe(400);
  await page.getByRole('button', { name: '查看选用软件', exact: true }).click();
  await expect(page).toHaveURL(`/projects/${flow.legacy_project_id}/software`);
});
