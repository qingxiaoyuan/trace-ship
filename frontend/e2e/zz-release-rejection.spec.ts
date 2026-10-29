import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const fixture = JSON.parse(readFileSync(process.env.SMOKE_MANIFEST!, 'utf8')) as {
  password: string;
  workflow_status: { username: string; samples: Array<{ id: string; release_id: string; version: string; state: string; node: string }> };
};
const sample = fixture.workflow_status.samples.find(item => item.state === 'running' && item.node === '技术负责人审批')!;
const reportDir = process.env.SMOKE_REPORT_DIR!;

test('审批直接驳回并从看板及列表找到原申请，工作台无草稿和轮次操作', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: '本地账号', exact: true }).click();
  await page.getByPlaceholder('请输入本地账号').fill(fixture.workflow_status.username);
  await page.getByPlaceholder('请输入密码', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: '登 录', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.getByRole('dialog', { name: /事项提醒/ }).getByRole('button', { name: '知道了', exact: true }).click();
  await expect(page.locator('.ant-modal-mask')).toBeHidden();
  await page.goto(`/workflows/${sample.id}`);
  await expect(page.getByRole('button', { name: '退回修改', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '回退', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '审批轮次', exact: true })).toHaveCount(0);
  await page.getByPlaceholder('请输入审批意见…').fill('请修复问题后新建发布');
  await page.screenshot({ path: path.join(reportDir, 'simple-approval-desktop.png'), fullPage: true, animations: 'disabled' });
  const rejectedResponse = page.waitForResponse(response => response.url().endsWith('/reject/') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '驳回', exact: true }).click();
  const rejected = await rejectedResponse;
  expect(rejected.status()).toBe(200);
  expect((await rejected.json()).data.status).toBe('rejected');
  await page.goto('/releases');
  await expect(page.getByRole('button', { name: 'RC Tag 清理', exact: true })).toHaveCount(0);
  await expect(page.getByText(sample.version, { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(reportDir, 'rejected-release-board-desktop.png'), fullPage: true, animations: 'disabled' });
  await page.getByText(sample.version, { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/releases/${sample.release_id}$`));
  await expect(page.getByText('审批已结束，修改代码后请新建发布。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '提交审批', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '审批轮次', exact: true })).toHaveCount(0);
  await page.getByRole('main').getByRole('button', { name: '新建发布', exact: true }).click();
  await expect(page).toHaveURL(/\/releases\/create\?project_id=/);

  await page.goto('/releases');
  await page.getByRole('button', { name: '列表', exact: true }).click();
  const row = page.locator(`[data-release-id="${sample.release_id}"]`);
  await expect(row.getByText('已驳回', { exact: true }).filter({ visible: true })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await row.getByText(sample.version, { exact: true }).filter({ visible: true }).click();
  await expect(page).toHaveURL(new RegExp(`/releases/${sample.release_id}$`));
  await expect(page.getByRole('main').getByRole('button', { name: '新建发布', exact: true })).toBeVisible();
  await expect(page.locator('main .ts-fade-in-up')).toHaveCSS('opacity', '1');
  await expect(page.locator('main .page-fade-in')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: path.join(reportDir, 'rejected-release-mobile.png'), fullPage: true, animations: 'disabled' });
  const viewports = [];
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 });
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: width === 1440 ? '发布流水线' : '最近发布', exact: true })).toBeVisible();
    await expect(page.getByText('草稿', { exact: true })).toHaveCount(0);
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth }));
    expect(viewport.width).toBe(width);
    expect(viewport.scrollWidth).toBeLessThanOrEqual(width);
    viewports.push(viewport);
    await page.screenshot({ path: path.join(reportDir, `dashboard-no-drafts-${width}.png`), fullPage: true, animations: 'disabled' });
  }
  writeFileSync(path.join(reportDir, 'simple-approval.json'), JSON.stringify({ releaseId: sample.release_id,
    instanceId: sample.id, rejected: true, originalCannotResubmit: true, createNewReleaseVisible: true,
    noReturnOrRollbackButton: true, noRoundSelector: true, noRcCleanupButton: true,
    noDashboardDrafts: true, viewports, oldBusinessDataRewritten: false,
  }, null, 2));
});
