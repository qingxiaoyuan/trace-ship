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
let sourceReferenceRequests = 0;

beforeEach(() => {
  projectRole = 'maintainer';
  releaseStatus = 'released';
  releaseDoc = '发布说明正文';
  formalRelease = false;
  sourceReferenceRequests = 0;
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
  });
  request.defaults.adapter = async (config) => {
    if (config.url?.endsWith('/source-reference/')) sourceReferenceRequests += 1;
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
  it.each(['maintainer', 'developer'])('目标项目 %s 仅在获准时提供导出，完整说明仍可阅读', async (role) => {
    projectRole = role;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><App><MemoryRouter initialEntries={['/releases/release']}>
      <Routes><Route path="/releases/:id" element={<ReleaseDetail />} /></Routes>
    </MemoryRouter></App></QueryClientProvider>);
    await screen.findByText('发布说明正文');
    await waitFor(() => expect(client.getQueryData<{ my_role: string }>(['project', 'project'])?.my_role).toBe(role));
    expect(screen.queryByText('RC 标签与源码')).toBeNull();
    expect(screen.queryByRole('link', { name: '预览并清理 RC Tag' })).toBeNull();
    expect(sourceReferenceRequests).toBe(0);
    if (role === 'maintainer') expect(screen.queryAllByRole('button', { name: /导出/ })).toHaveLength(0);
    else expect(await screen.findAllByRole('button', { name: /导出/ })).toHaveLength(3);
  });

  it('标准生成说明的转义管道和续行保持在同一字段，保存后不重复转义', async () => {
    projectRole = 'developer';
    releaseDoc = [
      '| 项目 | 内容 |', '|------|------|',
      '| 当前发布版本号 | V1.0.0 |',
      '| 变更内容 | A 支持 A \\| B',
      'F 修复终端故障 |',
      '| 测试验证 | 自测试通过 |',
    ].join('\n');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ConfigProvider theme={{ token: { motion: false } }}><App><MemoryRouter initialEntries={['/releases/release']}>
      <Routes><Route path="/releases/:id" element={<ReleaseDetail />} /></Routes>
    </MemoryRouter></App></ConfigProvider></QueryClientProvider>);
    const value = await screen.findByRole('cell', { name: /A 支持 A \| B/ });
    expect(value.textContent).toContain('F 修复终端故障');
    const table = value.closest('table')!;
    expect(within(table).getAllByRole('row').map((row) => within(row).getAllByRole('cell')[0].textContent))
      .toEqual(['当前发布版本号', '变更内容', '测试验证']);
    fireEvent.click(await screen.findByRole('button', { name: '修改文档' }));
    const dialog = await screen.findByRole('dialog', { name: '修改发布说明' });
    const editor = within(within(dialog).getByRole('cell', { name: '变更内容' }).parentElement!).getByRole('textbox');
    expect((editor as HTMLTextAreaElement).value).toBe('A 支持 A | B\nF 修复终端故障');
    fireEvent.change(editor, { target: { value: 'A 支持 A | B\nF 修复终端故障\n补充验收通过' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(releaseDoc).toContain('A 支持 A \\| B\nF 修复终端故障\n补充验收通过 |');
    expect(screen.getByRole('cell', { name: /A 支持 A \| B/ }).textContent).toContain('补充验收通过');
    fireEvent.click(screen.getByRole('button', { name: '修改文档' }));
    const reopened = await screen.findByRole('dialog');
    expect((within(within(reopened).getByRole('cell', { name: '变更内容' }).parentElement!).getByRole('textbox') as HTMLTextAreaElement).value)
      .toBe('A 支持 A | B\nF 修复终端故障\n补充验收通过');
  });

  it('标准字段行首换行后仍渲染强调和链接', async () => {
    releaseDoc = '| 项目 | 内容 |\n|------|------|\n| 说明 | <br>\n**重要说明**\n[MR](https://example.invalid/mr/1) |';
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><App><MemoryRouter initialEntries={['/releases/release']}>
      <Routes><Route path="/releases/:id" element={<ReleaseDetail />} /></Routes>
    </MemoryRouter></App></QueryClientProvider>);
    expect((await screen.findByText('重要说明')).tagName).toBe('STRONG');
    const value = screen.getByRole('cell', { name: /重要说明/ });
    expect(within(value).getByRole('link', { name: 'MR' }).getAttribute('href')).toBe('https://example.invalid/mr/1');
    expect(value.querySelector('br')).not.toBeNull();
  });

  it('标准表格值渲染链接、强调与换行，保留字段布局', async () => {
    releaseDoc = '| 字段 | 内容 |\n|------|------|\n| 说明 | [合并请求 !42](https://example.invalid/mr/42) **已修复**<br>第二行 |';
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><App><MemoryRouter initialEntries={['/releases/release']}>
      <Routes><Route path="/releases/:id" element={<ReleaseDetail />} /></Routes>
    </MemoryRouter></App></QueryClientProvider>);
    const link = await screen.findByRole('link', { name: '合并请求 !42' });
    expect(link.getAttribute('href')).toBe('https://example.invalid/mr/42');
    expect(screen.getByText('已修复').tagName).toBe('STRONG');
    const value = screen.getByRole('cell', { name: /合并请求 !42/ });
    expect(value.querySelector('br')).not.toBeNull();
    expect(value.textContent).toContain('第二行');
  });

  it('代码示例保留换行标签原文，说明中的危险链接和 HTML 不执行', async () => {
    releaseDoc = '# 安全说明\n\n`<br>`\n\n[普通链接](https://example.invalid) [危险链接](javascript:alert%281%29)\n\n<script>alert(1)</script>';
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<QueryClientProvider client={client}><App><MemoryRouter initialEntries={['/releases/release']}>
      <Routes><Route path="/releases/:id" element={<ReleaseDetail />} /></Routes>
    </MemoryRouter></App></QueryClientProvider>);
    await screen.findByRole('heading', { name: '安全说明' });
    expect(screen.getByText('<br>').tagName).toBe('CODE');
    expect(screen.getByRole('link', { name: '普通链接' }).getAttribute('href')).toBe('https://example.invalid');
    expect(screen.getByText('危险链接').getAttribute('href') || '').not.toMatch(/^javascript:/i);
    expect(container.querySelector('script')).toBeNull();
  });

  it('非标准表格和普通说明保留原始正文', async () => {
    releaseDoc = '部署命令：\n  backup --all\n\n| 额外约束 | A \\| B 管道表达式 |\n最后请检查日志。';
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><App><MemoryRouter initialEntries={['/releases/release']}>
      <Routes><Route path="/releases/:id" element={<ReleaseDetail />} /></Routes>
    </MemoryRouter></App></QueryClientProvider>);
    expect(await screen.findByText(/部署命令：/)).toBeTruthy();
    expect(screen.getByText(/额外约束/).textContent).toContain('A | B 管道表达式');
    expect(screen.getByText(/最后请检查日志/)).toBeTruthy();
  });

  it('多行说明中的命令缩进不被表格转换删去', async () => {
    releaseDoc = '| 字段 | 内容 |\n|------|------|\n| 部署步骤 | 执行以下命令\n    backup_db --all\n完成后重启 |';
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><App><MemoryRouter initialEntries={['/releases/release']}>
      <Routes><Route path="/releases/:id" element={<ReleaseDetail />} /></Routes>
    </MemoryRouter></App></QueryClientProvider>);
    const cell = await screen.findByRole('cell', { name: /执行以下命令/ });
    expect(cell.textContent).toContain('\n    backup_db --all\n');
    expect(cell.textContent).toContain('完成后重启');
  });

  it('行首换行标签渲染为换行，不泄露为说明正文标记', async () => {
    releaseDoc = '<br>\n第二行';
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<QueryClientProvider client={client}><App><MemoryRouter initialEntries={['/releases/release']}>
      <Routes><Route path="/releases/:id" element={<ReleaseDetail />} /></Routes>
    </MemoryRouter></App></QueryClientProvider>);
    expect(await screen.findByText('第二行')).toBeTruthy();
    expect(container.querySelector('.release-markdown br')).not.toBeNull();
    expect(screen.queryByText(/<br>/)).toBeNull();
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
    expect(within(rows[2][1]).getAllByRole('paragraph').map((paragraph) => paragraph.textContent)).toEqual(['第一行', '第三行']);
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

    expect(await screen.findByText('部署前请先备份业务库。')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '升级说明' })).toBeTruthy();
    expect(screen.getAllByRole('table')).toHaveLength(2);
    expect(screen.getByRole('cell', { name: '新索引及完整兼容说明' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '升级步骤' })).toBeTruthy();
    expect(screen.getByText('附录：升级完成后检查版本。')).toBeTruthy();
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
    expect(await screen.findByText(/补充现场验收步骤/)).toBeTruthy();
    expect(screen.getByText('部署前备份。')).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'V2' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '修改文档' }));
    expect((within(await screen.findByRole('dialog')).getByRole('textbox') as HTMLTextAreaElement).value).toBe(updatedDoc);
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
