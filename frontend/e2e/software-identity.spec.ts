import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const fixture = JSON.parse(readFileSync(process.env.SMOKE_MANIFEST!, 'utf8')) as {
  username: string;
  password: string;
  operator: { username: string };
  software_identity: { repository_id: string; project_id: string; delegate: string };
};
const { repository_id, project_id, delegate } = fixture.software_identity;
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

test('仓库登记、协作撤销与手机端项目选用均通过生产接口', async ({ page, browser }) => {
  await login(page, fixture.operator.username);
  await page.goto(`/repositories/${repository_id}/software`);
  await page.getByRole('button', { name: '登记软件' }).click();
  const registration = page.getByRole('dialog', { name: '登记软件' });
  await registration.getByLabel('软件名称').fill(softwareName);
  await registration.getByLabel('软件标识').fill('smoke-client');
  await registration.getByRole('button', { name: /^登\s*记$/ }).click();
  const row = page.getByRole('listitem').filter({ hasText: softwareName });
  await expect(row).toContainText('smoke-client');
  await page.reload();
  await expect(row).toContainText('smoke-client');
  await row.getByRole('button', { name: '维护授权' }).click();
  const grants = page.getByRole('dialog', { name: '维护授权' });
  await grants.getByLabel('协作维护者登录名').fill(delegate);
  await grants.getByRole('button', { name: /^授\s*权$/ }).click();
  await expect(grants.getByText(delegate, { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(process.env.SMOKE_REPORT_DIR!, 'software-identity-desktop.png') });

  const mobile = await browser.newPage({ viewport: { width: 375, height: 812 } });
  try {
    await login(mobile, delegate);
    await mobile.goto('/software');
    const delegateRow = mobile.getByRole('listitem').filter({ hasText: softwareName });
    await delegateRow.getByRole('button', { name: /^编\s*辑$/ }).click();
    const editor = mobile.getByRole('dialog', { name: '编辑软件' });
    await editor.getByLabel('软件名称').fill(renamed);
    await editor.getByRole('button', { name: /^保\s*存$/ }).click();
    await expect(mobile.getByText(renamed, { exact: true })).toBeVisible();
    await expect(mobile.getByRole('button', { name: '维护授权' })).toHaveCount(0);
    await expect.poll(() => mobile.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    const softwareId = await mobile.evaluate(async (name) => {
      const response = await fetch('/api/software/', {
        headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
      });
      const { data } = await response.json();
      return data.results.find((item: { name: string }) => item.name === name).id as string;
    }, renamed);
    await grants.getByRole('button', { name: `撤销 ${delegate}` }).click();
    await expect(grants.getByText(delegate, { exact: true })).toHaveCount(0);
    expect(await mobile.evaluate(async (id) => {
      const response = await fetch(`/api/software/${id}/`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '越权修改' }),
      });
      return response.status;
    }, softwareId)).toBe(404);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/projects/${project_id}/software`);
    await expect(page.getByText('当前项目尚未选用软件')).toBeVisible();
    await page.getByRole('button', { name: '选用已有软件', exact: true }).click();
    const selection = page.getByRole('dialog', { name: '选用软件' });
    await selection.getByRole('combobox', { name: '候选软件' }).click();
    await page.locator('.ant-select-item-option-content').filter({ hasText: renamed }).click();
    await selection.getByRole('button', { name: /^选\s*用$/ }).click();
    const selected = page.getByRole('listitem').filter({ hasText: renamed });
    await expect(selected.getByText('使用中', { exact: true })).toBeVisible();
    await selected.getByRole('button', { name: '停止选用' }).click();
    await page.getByRole('button', { name: '确认停止' }).click();
    await expect(selected).toContainText('已停止选用');
    await page.reload();
    await expect(selected).toContainText('已停止选用');
    expect(await page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([375, 812]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.screenshot({ path: path.join(process.env.SMOKE_REPORT_DIR!, 'software-selection-mobile.png') });

    const reader = await browser.newPage({ viewport: { width: 375, height: 812 } });
    try {
      await login(reader, fixture.username);
      await reader.goto(`/projects/${project_id}/software`);
      await expect(reader.getByText(renamed, { exact: true })).toBeVisible();
      await expect(reader.getByRole('button', { name: '选用已有软件', exact: true })).toHaveCount(0);
      await expect(reader.getByRole('button', { name: '恢复选用' })).toHaveCount(0);
    } finally {
      await reader.close();
    }
  } finally {
    await mobile.close();
  }
});
