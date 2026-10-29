import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const fixture = JSON.parse(readFileSync(process.env.SMOKE_MANIFEST!, 'utf8')) as {
  password: string; workflow_status: { username: string; samples: Array<{ id: string; title: string; state: string; label: string; node: string }> };
};
const sample = fixture.workflow_status;
const reportDir = process.env.SMOKE_REPORT_DIR!;

test('审批列表按真实状态展示，终态隐藏旧节点且个人已办显示处理结果', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: '本地账号', exact: true }).click();
  await page.getByPlaceholder('请输入本地账号').fill(sample.username);
  await page.getByPlaceholder('请输入密码', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: '登 录', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.getByRole('dialog', { name: /事项提醒/ }).getByRole('button', { name: '知道了', exact: true }).click();
  await expect(page.locator('.ant-modal-mask')).toBeHidden();
  await page.goto('/workflows');
  await page.getByRole('button', { name: '我发起的', exact: true }).click();
  for (const item of sample.samples) {
    const row = page.locator(`[data-workflow-id="${item.id}"]`);
    await expect(row.getByText(item.label, { exact: true }).filter({ visible: true })).toBeVisible();
    if (item.state === 'running') await expect(row.getByText(item.node, { exact: true }).filter({ visible: true })).toBeVisible();
    else await expect(row.locator('.pulse-dot')).toHaveCount(0);
  }
  await expect(page.getByText(/approval_internal_/)).toHaveCount(0);
  const completed = sample.samples.find(item => item.state === 'completed')!;
  const rejected = sample.samples.find(item => item.state === 'rejected')!;
  const doneBadge = page.locator(`[data-workflow-id="${completed.id}"]`).getByText('已完成', { exact: true }).filter({ visible: true });
  const rejectedBadge = page.locator(`[data-workflow-id="${rejected.id}"]`).getByText('已驳回', { exact: true }).filter({ visible: true });
  const colors = await Promise.all([doneBadge.evaluate(element => getComputedStyle(element).color), rejectedBadge.evaluate(element => getComputedStyle(element).color)]);
  expect(colors[0]).not.toBe(colors[1]);
  await page.screenshot({ path: path.join(reportDir, 'workflow-status-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  for (const item of sample.samples) {
    const row = page.locator(`[data-workflow-id="${item.id}"]`);
    await expect(row.getByText(item.label, { exact: true }).filter({ visible: true })).toBeVisible();
    const title = row.getByText(item.title, { exact: true }).filter({ visible: true });
    await expect(title).toBeVisible();
    expect((await title.boundingBox())!.width).toBeGreaterThan(100);
  }
  await page.screenshot({ path: path.join(reportDir, 'workflow-status-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: '我的已办', exact: true }).click();
  await expect(page.getByText('已通过', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('已完成', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '待我审批', exact: true }).click();
  await expect(page.getByText('待审批', { exact: true }).filter({ visible: true })).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/workflows/${completed.id}`);
  const recordViewports = [await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))];
  expect(recordViewports[0]).toEqual({ width: 1440, height: 1000 });
  const rounds = page.getByRole('region', { name: '审批轮次', exact: true });
  const opinions = page.getByRole('region', { name: '审批意见', exact: true });
  await expect(rounds).toHaveCount(0);
  await expect(opinions.getByRole('listitem')).toHaveCount(4);
  await expect(opinions.getByText('已通过', { exact: true })).toHaveCount(4);
  await expect(opinions.locator('.ant-tag')).toHaveCount(0);
  const longComment = opinions.locator('p');
  await expect(longComment).toHaveText('同意发布。\n请在发布后关注服务运行情况，并核对审批中的配置说明。回归验证已完成，详细记录：review-check-' + 'a'.repeat(100));
  const compactRows = await opinions.getByRole('listitem').evaluateAll(elements => elements.filter(element => !element.querySelector('p')).map(element => element.getBoundingClientRect().height));
  expect(compactRows.every(height => height <= 64)).toBe(true);
  await opinions.screenshot({ path: path.join(reportDir, 'approval-opinions-desktop.png') });
  await page.screenshot({ path: path.join(reportDir, 'approval-records-desktop.png'), fullPage: true });
  const responsiveWidths = [];
  for (const width of [1024, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    const measurements = await opinions.evaluate(element => {
      const rows = Array.from(element.querySelectorAll('li'));
      return {
        width: innerWidth, height: innerHeight,
        sectionRight: element.getBoundingClientRect().right,
        clippedRows: rows.filter(row => row.scrollWidth > row.clientWidth).length,
        timeRight: Math.max(...Array.from(element.querySelectorAll('time')).map(time => time.getBoundingClientRect().right)),
      };
    });
    expect(measurements.width).toBe(width);
    expect(measurements.clippedRows).toBe(0);
    expect(measurements.timeRight).toBeLessThanOrEqual(measurements.sectionRight);
    responsiveWidths.push(measurements);
    await opinions.screenshot({ path: path.join(reportDir, `approval-opinions-${width}.png`) });
  }
  await page.setViewportSize({ width: 375, height: 812 });
  recordViewports.push(await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
  expect(recordViewports[1]).toEqual({ width: 375, height: 812 });
  await expect(opinions.getByRole('listitem')).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  expect(await longComment.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await opinions.evaluate(element => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 90, behavior: 'instant' }));
  const lastOpinion = await opinions.getByRole('listitem').last().boundingBox();
  expect(lastOpinion!.y + lastOpinion!.height).toBeLessThan(812 - 96);
  await page.screenshot({ path: path.join(reportDir, 'approval-opinions-mobile-viewport.png') });
  await opinions.screenshot({ path: path.join(reportDir, 'approval-opinions-mobile.png') });
  await page.screenshot({ path: path.join(reportDir, 'approval-records-mobile.png'), fullPage: true });
  writeFileSync(path.join(reportDir, 'approval-records.json'), JSON.stringify({ handledTasks: 4, comments: 1, compactRows, viewports: recordViewports, responsiveWidths, mobileOverflow: false, originalCommentComplete: true, tags: 0, lastOpinionClearOfNavigation: true }, null, 2));
  writeFileSync(path.join(reportDir, 'workflow-status.json'), JSON.stringify({ states: sample.samples.map(item => item.state), widths: [1440, 375], colors, terminalPulse: false, rawNodeIdsVisible: false, doneIsPersonalResult: true }, null, 2));
});
