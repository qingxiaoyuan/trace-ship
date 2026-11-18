import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const fixture = JSON.parse(readFileSync(process.env.SMOKE_MANIFEST!, 'utf8')) as {
  username: string;
  password: string;
  operator: { username: string };
  shared_packaging: {
    config: string; name: string; software: string; software_name: string;
    project: string; other_project: string; project_name: string; actor: string; reader: string;
  };
};
const sample = fixture.shared_packaging;

async function login(page: Page, user: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: '本地账号', exact: true }).click();
  await page.getByPlaceholder('请输入本地账号').fill(user);
  await page.getByPlaceholder('请输入密码', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: '登 录', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function call(page: Page, url: string, method = 'GET', body?: object) {
  return page.evaluate(async ({ url, method, body }) => {
    const response = await fetch('/api' + url, {
      method,
      headers: {
        Authorization: 'Bearer ' + localStorage.getItem('accessToken'),
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, json: await response.json() };
  }, { url, method, body });
}

test('项目复用同一软件配置并以真实项目创建分支打包，手机维保只查看任务', async ({ page, browser }) => {
  await login(page, fixture.operator.username);
  for (const project of [sample.other_project, sample.project]) {
    const result = await call(page, '/packages/configs/?project=' + project + '&software=' + sample.software);
    expect(result.status).toBe(200);
    expect(result.json.data.results.map((config: { id: string }) => config.id)).toEqual([sample.config]);
  }
  await page.goto('/projects/' + sample.project + '/packages');
  const ownerConfig = page.getByRole('group', { name: sample.name + ' · ' + sample.software_name });
  await expect(ownerConfig).toBeVisible();
  await ownerConfig.getByRole('button', { name: '编辑配置' }).click();
  const editor = page.getByRole('dialog', { name: /编辑打包配置/ });
  await expect(editor.getByRole('combobox', { name: /归属软件/ })).toBeDisabled();
  await page.screenshot({ path: path.join(process.env.SMOKE_REPORT_DIR!, 'shared-packaging-config.png') });

  const actor = await browser.newPage();
  try {
    await login(actor, sample.actor);
    const configUrl = '/packages/configs/' + sample.config + '/';
    await actor.goto('/projects/' + sample.project + '/packages');
    const actorConfig = actor.getByRole('group', { name: sample.name + ' · ' + sample.software_name });
    await expect(actorConfig).toBeVisible();
    await expect(actorConfig.getByRole('button', { name: '编辑配置' })).toHaveCount(0);
    expect((await call(actor, configUrl, 'PATCH', { name: '越权修改' })).status).toBe(403);
    await actorConfig.getByRole('button', { name: '触发打包' }).click();
    const dialog = actor.getByRole('dialog', { name: '新建打包' });
    await expect(dialog.getByText(sample.project_name, { exact: true })).toBeVisible();
    await dialog.getByRole('combobox', { name: '选择分支' }).click();
    await actor.locator('.ant-select-item-option-content').filter({ hasText: /^main$/ }).click();
    const created = actor.waitForResponse((response) =>
      response.url().endsWith(configUrl + 'trigger-branch/') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: '开始打包', exact: true }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    const { data: task } = await response.json();
    expect(task).toMatchObject({
      project: sample.project, software: sample.software, software_name: sample.software_name,
      release: null, source_ref: 'main', commit_hash: 'a'.repeat(40),
    });
    await expect(actor).toHaveURL(new RegExp('/packages/' + task.id + '$'));
    expect((await call(actor, configUrl + 'trigger-branch/', 'POST', {
      project: sample.other_project, software: sample.software, branch: 'main',
    })).status).toBe(404);

    const reader = await browser.newPage({ viewport: { width: 375, height: 812 } });
    try {
      await login(reader, sample.reader);
      await reader.goto('/packages/' + task.id);
      await expect(reader.getByText(sample.name + ' / main', { exact: true })).toBeVisible();
      await expect(reader.getByRole('heading', { name: '构建日志' })).toBeVisible();
      await reader.reload();
      await expect(reader.getByText(sample.software_name + ' · 虚构交付仓库', { exact: true })).toBeVisible();
      expect((await call(reader, '/packages/tasks/' + task.id + '/logs/')).status).toBe(403);
      expect((await call(reader, configUrl + 'favorite/', 'POST', { project: sample.project })).status).toBe(403);
      expect(await reader.evaluate(() => [innerWidth, innerHeight])).toEqual([375, 812]);
      expect(await reader.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
      await reader.screenshot({ path: path.join(process.env.SMOKE_REPORT_DIR!, 'shared-packaging-mobile.png') });
    } finally {
      await reader.close();
    }
  } finally {
    await actor.close();
  }
});
