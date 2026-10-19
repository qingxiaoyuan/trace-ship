import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { App, ConfigProvider } from 'antd';
import request from '@/api/request';
import ReleaseDetail from './Detail';

const originalAdapter = request.defaults.adapter;
let projectRole = 'maintainer';
let releaseStatus = 'released';
let releaseDoc = '发布说明正文';
let formalRelease = false;

beforeEach(() => {
  projectRole = 'maintainer';
  releaseStatus = 'released';
  releaseDoc = '发布说明正文';
  formalRelease = false;
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
  });
  request.defaults.adapter = async (config) => {
    if (config.url?.endsWith('/update-doc/')) releaseDoc = JSON.parse(config.data).release_doc;
    const data = config.url?.includes('/projects/') ? {
      id: 'project', my_role: projectRole, name: '维保项目',
    } : config.url?.endsWith('/source-reference/') ? {
      available: true, reference: 'V1.0.0', reason: '',
    } : config.url?.endsWith('/changes-preview/') ? {
      base_tag: '', base_git_hash: '', head_hash: 'b'.repeat(40), first_release: true,
      no_changes: false, warnings: [], commits: [], merge_requests: [], parsed_updates: [],
    } : config.url?.endsWith('/review-issues/') ? [] : {
      id: 'release', project: 'project', version: 'V1.0.0', status: releaseStatus,
      release_type: formalRelease ? 'formal' : 'rc', source_rc: formalRelease ? 'source-rc' : undefined,
      rejected_reason: '推 tag 失败',
      release_doc: releaseDoc, can_review: false, can_reply: false, package_tasks: [],
    };
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data } };
  };
});

afterEach(() => { cleanup(); request.defaults.adapter = originalAdapter; vi.unstubAllGlobals(); });

describe('维保发布详情', () => {
  it('非标准表格和普通说明保留原始正文', async () => {
    releaseDoc = '部署命令：\n  backup --all\n\n| 额外约束 | A \\| B 管道表达式 |\n最后请检查日志。';
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><App><MemoryRouter initialEntries={['/releases/release']}>
      <Routes><Route path="/releases/:id" element={<ReleaseDetail />} /></Routes>
    </MemoryRouter></App></QueryClientProvider>);
    expect((await screen.findByText(/部署命令：/)).textContent).toBe(releaseDoc);
  });

  it('多行说明中的命令缩进不被表格转换删去', async () => {
    releaseDoc = '| 字段 | 内容 |\n|------|------|\n| 部署步骤 | 执行以下命令\n    backup --all\n完成后重启 |';
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><App><MemoryRouter initialEntries={['/releases/release']}>
      <Routes><Route path="/releases/:id" element={<ReleaseDetail />} /></Routes>
    </MemoryRouter></App></QueryClientProvider>);
    expect((await screen.findByText(/backup --all/)).textContent).toContain('\n    backup --all\n');
  });

  it('无说明时维保只能阅读空状态，没有编辑或生成入口', async () => {
    releaseDoc = '';
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><App><MemoryRouter initialEntries={['/releases/release']}>
      <Routes><Route path="/releases/:id" element={<ReleaseDetail />} /></Routes>
    </MemoryRouter></App></QueryClientProvider>);
    await screen.findByText('尚未生成发布说明');
    await waitFor(() => expect(client.getQueryState(['project', 'project'])?.status).toBe('success'));
    expect(screen.queryByRole('button', { name: /修改文档|生成.*说明/ })).toBeNull();
  });

  it('按保存顺序显示所有说明字段，并保留选项备注、空行和长文本尾部', async () => {
    const longDescription = '部署兼容性说明。'.repeat(160) + '末尾验收内容。';
    releaseDoc = [
      '| 字段 | 内容 |',
      '|------|------|',
      '| 额外前置字段 | 请先核对离线安装包 |',
      '| 测试验证 | 研发测试复验通过；专项性能测试待现场确认 |',
      '| 更新内容 | 第一行',
      '',
      '第三行 |',
      `| 兼容性说明 | ${longDescription} |`,
      '| 额外末尾字段 | 无需额外迁移 |',
    ].join('\n');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><App><MemoryRouter initialEntries={['/releases/release']}>
      <Routes><Route path="/releases/:id" element={<ReleaseDetail />} /></Routes>
    </MemoryRouter></App></QueryClientProvider>);

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').map((row) => within(row).getAllByRole('cell'));
    expect(rows.map((cells) => cells[0].textContent)).toEqual(['额外前置字段', '测试验证', '更新内容', '兼容性说明', '额外末尾字段']);
    expect(rows[1][1].textContent).toBe('研发测试复验通过；专项性能测试待现场确认');
    expect(rows[2][1].textContent).toBe('第一行\n\n第三行');
    expect(rows[3][1].textContent).toBe(longDescription);
    await waitFor(() => expect(client.getQueryState(['project', 'project'])?.status).toBe('success'));
    expect(screen.queryByRole('button', { name: /修改文档|生成.*说明/ })).toBeNull();
  });

  it('完整阅读混合 Markdown 说明，不丢弃表格外正文和额外列', async () => {
    releaseDoc = [
      '# 升级说明',
      '部署前请先备份业务库。',
      '',
      '| 字段 | 内容 |',
      '|------|------|',
      '| 更新内容 | 修复登录问题 |',
      '',
      '## 升级步骤',
      '1. 停止应用服务。',
      '2. 完成迁移后重新启动。',
      '',
      '| 组件 | 升级前 | 升级后 |',
      '|------|--------|--------|',
      '| 数据库 | 旧索引 | 新索引及完整兼容说明 |',
      '',
      '附录：升级完成后检查版本。',
    ].join('\n');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><App><MemoryRouter initialEntries={['/releases/release']}>
      <Routes><Route path="/releases/:id" element={<ReleaseDetail />} /></Routes>
    </MemoryRouter></App></QueryClientProvider>);

    const document = await screen.findByText(/部署前请先备份业务库/);
    expect(document.textContent).toBe(releaseDoc);
  });

  it('开发人员保存混合说明时保留表格外正文和全部列', async () => {
    projectRole = 'developer';
    releaseDoc = '部署前备份。\n\n| 组件 | 原版本 | 新版本 |\n|------|--------|--------|\n| 服务 | V1 | V2 |\n\n升级后确认健康检查。';
    const updatedDoc = releaseDoc + '\n补充现场验收步骤。';
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ConfigProvider theme={{ token: { motion: false } }}><App><MemoryRouter initialEntries={['/releases/release']}>
      <Routes><Route path="/releases/:id" element={<ReleaseDetail />} /></Routes>
    </MemoryRouter></App></ConfigProvider></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: '修改文档' }));
    const dialog = await screen.findByRole('dialog', { name: '修改发布说明' });
    const editor = within(dialog).getByRole('textbox');
    expect((editor as HTMLTextAreaElement).value).toBe(releaseDoc);
    fireEvent.change(editor, { target: { value: updatedDoc } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await screen.findByText(/补充现场验收步骤/)).textContent).toBe(updatedDoc);
  });

  it('正式说明保留身份字段只读，开发人员仍可修改其余内容', async () => {
    projectRole = 'developer';
    formalRelease = true;
    const gitHash = 'b'.repeat(40);
    releaseDoc = [
      '| 项目 | 内容 |', '|------|------|',
      '| 当前发布版本号 | V1.0.0 |', `| Git提交hash | ${gitHash} |`,
      '| 来源 RC | V0.9.0-rc |', '| 正式基线 | 首次正式发布 |', '| 基线提交 | 无 |',
      '| 变更范围 | 首次正式发布：截至来源提交的全部可达历史 |',
      '| 变更类型 | 无配置项改动 |', '| 配置项改动 | 无 |', '| 变更内容 | 原始说明 |',
      '| 关联项改动 | 无 |', '| 是否影响其他功能 | 否 |', '| 测试验证 | 未完成 |', '| 发布人 | 测试开发 |',
    ].join('\n');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ConfigProvider theme={{ token: { motion: false } }}><App><MemoryRouter initialEntries={['/releases/release']}>
      <Routes><Route path="/releases/:id" element={<ReleaseDetail />} /></Routes>
    </MemoryRouter></App></ConfigProvider></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: '修改文档' }));
    const dialog = await screen.findByRole('dialog', { name: '修改发布说明' });
    for (const field of ['当前发布版本号', 'Git提交hash', '来源 RC', '正式基线', '基线提交', '变更范围']) {
      const row = within(dialog).getByRole('cell', { name: field }).parentElement!;
      expect(within(row).queryByRole('textbox')).toBeNull();
    }
    fireEvent.change(within(dialog).getByDisplayValue('原始说明'), { target: { value: '变更后的完整说明' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('cell', { name: '变更后的完整说明' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'V1.0.0' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: gitHash })).toBeTruthy();
  });

  it.each(['released', 'draft', 'rejected'])('维保读取 %s 版本而不显示写操作', async (status) => {
    releaseStatus = status;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><App><MemoryRouter initialEntries={['/releases/release']}>
      <Routes><Route path="/releases/:id" element={<ReleaseDetail />} /></Routes>
    </MemoryRouter></App></QueryClientProvider>);

    await screen.findByText('发布说明正文');
    await waitFor(() => expect(client.getQueryState(['project', 'project'])?.status).toBe('success'));
    expect(screen.queryByRole('button', { name: /删除|重试推/ })).toBeNull();
  });

  it('在管理项目中保留已发布版本的删除操作', async () => {
    projectRole = 'manager';
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><App><MemoryRouter initialEntries={['/releases/release']}>
      <Routes><Route path="/releases/:id" element={<ReleaseDetail />} /></Routes>
    </MemoryRouter></App></QueryClientProvider>);
    expect(await screen.findByRole('button', { name: /删除版本/ })).toBeTruthy();
  });
});
