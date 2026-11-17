import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const fixture = JSON.parse(readFileSync(process.env.SMOKE_MANIFEST!, 'utf8')) as {
  operator: { username: string };
  password: string;
  software_release: {
    project_id: string;
    shared_project_id: string;
    shared_reader: string;
    shared_builder: string;
    shared_project_name: string;
    repository_name: string;
    software: { id: string; name: string; slug: string; config: string; config_name: string }[];
  };
};
const sample = fixture.software_release;
const reportDir = process.env.SMOKE_REPORT_DIR!;

async function signIn(page: Page, username: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: '本地账号', exact: true }).click();
  await page.getByPlaceholder('请输入本地账号').fill(username);
  await page.getByPlaceholder('请输入密码', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: '登 录', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function choose(page: Page, name: string, option: string | RegExp) {
  await page.getByLabel(name, { exact: true }).click();
  await page.locator('.ant-select-item-option-content').filter({ hasText: option }).click();
}

test('同仓库软件分别选择自动打包配置，按选用项目复用固定版本', async ({ browser, page }) => {
  const [client, server] = sample.software;
  await signIn(page, fixture.operator.username);
  await page.goto('/releases/create?project_id=' + sample.project_id);
  await page.getByRole('button', { name: /^RC / }).click();
  await choose(page, '目标软件', server.name);
  await choose(page, '分支', /^main$/);
  const tag = page.getByLabel('Tag 名', { exact: true });
  await expect(tag).toHaveValue(/^server-b\/V\.8\.0\.4-rc/);
  await expect(page.getByTitle('server-b/V.8.0.3-rc', { exact: true })).toBeVisible();
  const serverConfig = page.locator('label').filter({ hasText: server.config_name }).getByRole('checkbox');
  await expect(serverConfig).toBeChecked();
  await page.getByRole('button', { name: '全不选', exact: true }).click();
  await expect(serverConfig).not.toBeChecked();
  await page.screenshot({ path: path.join(reportDir, 'software-release-selection-desktop.png'), fullPage: true });

  await page.setViewportSize({ width: 375, height: 812 });
  await choose(page, '目标软件', client.name);
  await expect(tag).toHaveValue('');
  await choose(page, '分支', /^main$/);
  await expect(tag).toHaveValue(/^client-a\/V\.5\.2\.13-rc/);
  await expect(page.getByTitle('client-a/V.5.2.12-rc', { exact: true })).toBeVisible();
  await expect(page.getByText(server.config_name, { exact: true })).toHaveCount(0);
  await expect(page.locator('label').filter({ hasText: client.config_name }).getByRole('checkbox')).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.screenshot({ path: path.join(reportDir, 'software-release-selection-mobile.png'), fullPage: true });

  const creating = page.waitForResponse(response => new URL(response.url()).pathname === '/api/releases/' && response.request().method() === 'POST');
  const generating = page.waitForResponse(response => response.url().endsWith('/generate-doc/'));
  await page.getByRole('button', { name: '创建发布', exact: true }).click();
  const created = await creating;
  expect(created.status()).toBe(201);
  const draft = (await created.json()).data as { id: string; tag_name: string; git_hash: string };
  expect(created.request().postDataJSON()).toMatchObject({ software: client.id, package_config_ids: [client.config] });
  expect(draft.git_hash).toBe('a'.repeat(40));
  const generated = await generating;
  expect(generated.status()).toBe(200);
  const notes = (await generated.json()).data as string;
  expect(notes).toContain('| 软件 | ' + client.name + ' |');
  expect(notes).toContain('| 发布 Tag | ' + draft.tag_name + ' |');
  const submitting = page.waitForResponse(response => response.url().endsWith('/submit-audit/'));
  await page.getByRole('button', { name: '提交审批', exact: true }).click();
  expect((await submitting).status()).toBe(200);
  const origin = await page.evaluate(async (id) => {
    const response = await fetch('/api/releases/' + id + '/', {
      headers: { Authorization: 'Bearer ' + localStorage.getItem('accessToken') },
    });
    return (await response.json()).data as { package_tasks: { id: string; name: string }[] };
  }, draft.id);
  expect(origin.package_tasks).toHaveLength(1);
  const originTask = origin.package_tasks[0];

  const builderContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const builder = await builderContext.newPage();
    await signIn(builder, sample.shared_builder);
    const url = '/releases/' + draft.id + '?project=' + sample.shared_project_id;
    await builder.goto(url);
    await builder.getByRole('main').getByRole('button', { name: '打包任务', exact: true }).click();
    const section = builder.getByRole('region', { name: '补打已发布版本', exact: true });
    await expect(section.getByText('任务归属项目：' + sample.shared_project_name)).toBeVisible();
    await expect(builder.getByText(originTask.name, { exact: true })).toHaveCount(0);
    await builder.setViewportSize({ width: 375, height: 812 });
    await section.getByRole('combobox', { name: '打包配置' }).click();
    await builder.getByRole('option', { name: client.config_name }).click();
    const posted = builder.waitForResponse(response => response.url().endsWith('/api/packages/configs/' + client.config + '/trigger/'));
    await section.getByRole('button', { name: '补打当前版本' }).click();
    const trigger = await posted;
    expect(trigger.status()).toBe(201);
    expect(trigger.request().postDataJSON()).toEqual({
      release_id: draft.id, project: sample.shared_project_id, software: client.id,
    });
    const reuseTask = (await trigger.json()).data as { id: string; project: string; software: string; tag_name: string };
    expect(reuseTask).toMatchObject({ project: sample.shared_project_id, software: client.id, tag_name: draft.tag_name });
    expect(await builder.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await builder.screenshot({ path: path.join(reportDir, 'software-repackage-mobile.png'), fullPage: true });
    await section.getByRole('button', { name: '查看新任务' }).click();
    await expect(builder).toHaveURL(new RegExp('/packages/' + reuseTask.id + '$'));
    await builder.reload();
    await expect(builder.getByRole('link', { name: /发布/ }).filter({ hasText: 'V.5.2.13' }))
      .toHaveAttribute('href', url);
    expect(await builder.evaluate(async (id) => (await fetch('/api/packages/tasks/' + id + '/', {
      headers: { Authorization: 'Bearer ' + localStorage.getItem('accessToken') },
    })).status, originTask.id)).toBe(404);
    writeFileSync(path.join(reportDir, 'software-repackage-evidence.json'), JSON.stringify(reuseTask, null, 2));
  } finally {
    await builderContext.close();
  }

  const sharedContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  try {
    const shared = await sharedContext.newPage();
    await signIn(shared, sample.shared_reader);
    await shared.goto('/releases/' + draft.id + '?project=' + sample.shared_project_id);
    await shared.reload();
    const notesTable = shared.getByRole('table');
    await expect(notesTable.getByRole('rowheader', { name: '软件', exact: true })).toBeVisible();
    await expect(notesTable.getByRole('cell', { name: client.name, exact: true })).toBeVisible();
    await expect(notesTable.getByRole('cell', { name: draft.tag_name, exact: true })).toBeVisible();
    await expect(shared.getByRole('tab', { name: '提交记录' })).toHaveCount(0);
    await expect(shared.getByRole('button', { name: /编辑说明|下载|导出|发起 OA 归档|删除版本/ })).toHaveCount(0);
    await shared.getByRole('tab', { name: '打包任务' }).click();
    await expect(shared.getByRole('region', { name: '补打已发布版本' })).toHaveCount(0);
    expect(await shared.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await shared.screenshot({ path: path.join(reportDir, 'software-release-shared-mobile.png'), fullPage: true });
    writeFileSync(path.join(reportDir, 'software-release-evidence.json'), JSON.stringify({ tag: draft.tag_name, git_hash: draft.git_hash, notes }, null, 2));
  } finally {
    await sharedContext.close();
  }
});
