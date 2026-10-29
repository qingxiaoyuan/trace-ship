import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const fixture = JSON.parse(readFileSync(process.env.SMOKE_MANIFEST!, 'utf8')) as {
  operator: { username: string }; password: string;
  ai_review: { username: string; instance_id: string; file: string; other_file: string; finding: { id: string; title: string } };
};
const sample = fixture.ai_review;
const reportDir = process.env.SMOKE_REPORT_DIR!;

test('AI 审查直接展示固定差异与行内评论，并在评论内采纳整改', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/login');
  await page.getByRole('button', { name: '本地账号', exact: true }).click();
  await page.getByPlaceholder('请输入本地账号').fill(sample.username);
  await page.getByPlaceholder('请输入密码', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: '登 录', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.getByRole('dialog', { name: /事项提醒/ }).getByRole('button', { name: '知道了', exact: true }).click();
  await page.goto(`/workflows/${sample.instance_id}`);
  await page.getByRole('tab', { name: 'AI 审查', exact: true }).click();
  const diff = page.getByRole('region', { name: '本轮代码差异', exact: true });
  await expect(diff.getByText('固定审查范围', { exact: true })).toBeVisible();
  const comment = diff.getByRole('article', { name: `审查意见：${sample.finding.title}`, exact: true });
  await expect(comment).toBeVisible();
  await expect(comment.locator('xpath=..')).toHaveAttribute('data-line-side', 'new');
  await expect(diff.getByText('<p dangerouslySetInnerHTML={{ __html: user.bio }} />', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '查看代码差异', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '展开代码差异', exact: true })).toHaveCount(0);
  await diff.getByRole('button', { name: `查看文件 ${sample.other_file}`, exact: true }).click();
  await expect(diff.getByText('export const canRemove = () => true;', { exact: true })).toBeVisible();
  await diff.getByRole('button', { name: `查看文件 ${sample.file}`, exact: true }).click();
  await expect(comment).toBeVisible();
  await diff.screenshot({ path: path.join(reportDir, 'ai-comments-desktop.png') });

  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))).toEqual({ width: 375, height: 812 });
  await comment.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const tableRegion = comment.getByRole('region', { name: '审查意见表格', exact: true });
  const tableScroll = await tableRegion.evaluate(element => {
    element.scrollLeft = element.scrollWidth;
    const last = element.querySelector('tbody tr:last-child td:last-child')!.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    return { scrollWidth: element.scrollWidth, width: element.clientWidth, left: element.scrollLeft, lastRight: last.right, right: bounds.right };
  });
  expect(tableScroll.scrollWidth).toBeGreaterThan(tableScroll.width);
  expect(tableScroll.left).toBeGreaterThan(0);
  expect(tableScroll.lastRight).toBeLessThanOrEqual(tableScroll.right + 1);
  await expect(tableRegion.getByRole('cell', { name: '末列表格内容完整', exact: true })).toBeVisible();
  await tableRegion.screenshot({ path: path.join(reportDir, 'ai-table-mobile-end.png') });
  await tableRegion.evaluate(element => { element.scrollLeft = 0; });
  const adoptButton = comment.getByRole('button', { name: `采纳：${sample.finding.title}`, exact: true });
  expect((await adoptButton.boundingBox())!.height).toBeGreaterThanOrEqual(36);
  await diff.screenshot({ path: path.join(reportDir, 'ai-comments-mobile.png') });
  const adoptedResponse = page.waitForResponse(response => response.url().endsWith('/remediations/') && response.request().method() === 'POST');
  await adoptButton.click();
  const adopted = await adoptedResponse;
  expect(adopted.status()).toBe(200);
  expect(adopted.request().postDataJSON()).toEqual({ action: 'adopt', node_id: 'ai', finding_id: sample.finding.id });
  await expect(comment.getByRole('link', { name: /已采纳，待修复/ })).toBeVisible();
  await expect(adoptButton).toHaveCount(0);
  await comment.getByRole('link', { name: /已采纳，待修复/ }).click();
  const remediation = page.getByRole('article', { name: `整改项：${sample.finding.title}`, exact: true });
  await expect(remediation).toBeInViewport();
  await expect(page.getByRole('region', { name: '代码审查整改', exact: true }).getByText('2 / 2', { exact: true })).toBeVisible();
  await expect.poll(async () => (await remediation.getByRole('heading', { level: 5 }).boundingBox())!.y).toBeGreaterThanOrEqual(60);
  await expect.poll(async () => (await remediation.getByRole('heading', { level: 5 }).boundingBox())!.y).toBeLessThanOrEqual(160);
  await page.screenshot({ path: path.join(reportDir, 'remediation-mobile-viewport.png') });
  await expect(remediation.getByText('节点标识', { exact: true })).toBeHidden();
  await remediation.screenshot({ path: path.join(reportDir, 'remediation-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await remediation.screenshot({ path: path.join(reportDir, 'remediation-desktop.png') });
  await remediation.getByText('来源与处置记录', { exact: true }).click();
  await expect(remediation.getByText('审查提交', { exact: true })).toBeVisible();
  await expect(remediation.getByText('处置历史', { exact: true })).toBeVisible();
  await remediation.screenshot({ path: path.join(reportDir, 'remediation-history.png') });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.reload();
  await page.getByRole('tab', { name: 'AI 审查', exact: true }).click();
  await expect(comment.getByRole('link', { name: /已采纳，待修复/ })).toBeVisible();
  await expect(adoptButton).toHaveCount(0);
  await comment.screenshot({ path: path.join(reportDir, 'ai-comment-adopted.png') });
  expect(errors).toEqual([]);
  writeFileSync(path.join(reportDir, 'ai-comments.json'), JSON.stringify({
    backend: '隔离 SQLite + 生产 REST、授权与整改实现', source: '固定虚构差异与报告；未调用外部模型',
    instanceId: sample.instance_id, inline: true, adopted: true, reload: true, widths: [1440, 375], tableScroll, remediationPage: 2, pageErrors: errors,
  }, null, 2));
});
