import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { App } from 'antd';
import type { AxiosAdapter } from 'axios';
import request from '@/api/request';
import { useAuthStore } from '@/stores/authStore';
import { useCommandPaletteStore } from '@/components/CommandPalette/store';
import { MainLayout } from './MainLayout';
import ProjectDetail from '@/pages/Project/Detail';

const originalAdapter = request.defaults.adapter;
const originalHistoryState = window.history.state;
let contextResponse: () => Promise<unknown>;

beforeEach(() => {
  window.history.replaceState({ idx: 0 }, '');
  useCommandPaletteStore.getState().setOpen(false);
  Element.prototype.scrollIntoView = () => {};
  useAuthStore.setState({ user: {
    id: 'reader', username: 'reader', nickname: '维保人员', email: '', department: '',
    source: 'local', roles: [], permissions: [], is_superuser: false,
  }, menus: [], isAuthenticated: true });
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
  });
  contextResponse = async () => ({ layout_mode: 'maintainer', visible_project_count: 25 });
  request.defaults.adapter = async (config) => ({
    config, status: 200, statusText: 'OK', headers: {},
    data: { code: 0, data: config.url === '/releases/dashboard/context/'
      ? await contextResponse() : { total: 0, results: [], count: 0,
        todo_task_count: 0, todo_tasks: [], open_issue_count: 0, open_issues: [], strong_notices: [] } },
  });
});

afterEach(() => {
  cleanup();
  request.defaults.adapter = originalAdapter;
  useAuthStore.setState({ user: null });
  window.history.replaceState(originalHistoryState, '');
});

function renderShell(path = '/dashboard', content: ReactNode = <h1>业务内容</h1>, title?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ element: <MainLayout />, children: [
    { path: '*', element: content, handle: { title } },
  ] }], { initialEntries: [path] });
  render(<QueryClientProvider client={client}><App><RouterProvider router={router} /></App></QueryClientProvider>);
  return { client, router };
}

function DraftPage() {
  const [draft, setDraft] = useState('');
  return <input aria-label="页面草稿" value={draft} onChange={(event) => setDraft(event.target.value)} />;
}

describe('统一工作台上下文与外壳', () => {
  it.each(['/', '/dashboard'])('首页 %s 保留品牌且不显示手机返回键', async (path) => {
    renderShell(path);
    await screen.findByRole('heading', { name: '业务内容' });
    expect(within(screen.getByRole('banner')).queryByRole('button', { name: '返回上一页' })).toBeNull();
  });

  it('手机顶栏返回站内上一页并保留维保工作台筛选', async () => {
    const { router } = renderShell('/dashboard?type=rc&page=2');
    await screen.findByRole('heading', { name: '业务内容' });
    await act(() => router.navigate('/releases/version'));
    window.history.replaceState({ idx: 1 }, '');

    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: '返回上一页' }));

    await waitFor(() => expect(router.state.location.pathname + router.state.location.search).toBe('/dashboard?type=rc&page=2'));
  });

  it.each([
    ['maintainer', '/releases/version', '/dashboard'],
    ['general', '/releases/version', '/releases'],
    ['maintainer', '/packages/task', '/packages'],
    ['maintainer', '/projects/project/overview', '/projects'],
    ['maintainer', '/repositories/repo/commits', '/repositories'],
    ['maintainer', '/notifications', '/dashboard'],
  ])('%s 直接打开 %s 时手机返回键回到 %s', async (mode, path, target) => {
    contextResponse = async () => ({ layout_mode: mode, visible_project_count: 1 });
    const { router } = renderShell(path);
    await screen.findByRole('heading', { name: '业务内容' });

    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: '返回上一页' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(target));
  });

  it('没有站内历史时仍恢复发布详情记录的维保来源', async () => {
    const { router } = renderShell('/dashboard');
    await screen.findByRole('heading', { name: '业务内容' });
    await act(() => router.navigate('/releases/version', {
      replace: true, state: { maintainerFrom: '/dashboard?project=project&type=formal&page=2' },
    }));

    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: '返回上一页' }));

    await waitFor(() => expect(router.state.location.pathname + router.state.location.search).toBe('/dashboard?project=project&type=formal&page=2'));
  });

  it('上下文加载中不提前呈现写入口或业务页面', () => {
    contextResponse = () => new Promise(() => {});
    renderShell();
    expect(screen.queryAllByRole('button', { name: '新建发布' })).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: '业务内容' })).toBeNull();
    expect(screen.getByText('正在加载工作台权限…')).toBeTruthy();
  });

  it('纯维保的桌面、移动快捷入口和菜单均隐藏新建发布及审批', async () => {
    renderShell();
    await screen.findByRole('heading', { name: '业务内容' });
    expect(screen.queryAllByRole('button', { name: '新建发布' })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: /审批中心/ })).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '打开导航菜单' }));
    expect(screen.queryAllByRole('button', { name: '新建发布' })).toHaveLength(0);
  });

  it.each(['/releases/create', '/tags', '/releases/cleanup', '/workflows', '/workflows/task',
    '/packages?tab=configs', '/projects/project/members', '/projects/project/packages',
    '/repositories/repo/workflows', '/repositories/repo/versionRule', '/system/configs', '/RELEASES/CREATE/', '/projects/%/members'])(
    '纯维保直连 %s 不能进入对应业务页面', async (path) => {
    renderShell(path);
    expect(await screen.findByText('此页面不向纯维保账号开放')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '业务内容' })).toBeNull();
  });

  it('上下文失败呈现重试，恢复后显示业务内容', async () => {
    contextResponse = async () => { throw new Error('网络错误'); };
    renderShell();
    await screen.findByText('无法加载工作台权限');
    expect(screen.queryByRole('heading', { name: '业务内容' })).toBeNull();
    contextResponse = async () => ({ layout_mode: 'maintainer', visible_project_count: 1 });
    fireEvent.click(screen.getByRole('button', { name: /重.*试/ }));
    expect(await screen.findByRole('heading', { name: '业务内容' })).toBeTruthy();
  });

  it('兼任和无项目的通用版保留原有写入口及路由', async () => {
    contextResponse = async () => ({ layout_mode: 'general', visible_project_count: 0 });
    renderShell('/releases/create');
    await screen.findByRole('heading', { name: '业务内容' });
    expect(screen.getAllByRole('button', { name: '新建发布' }).length).toBeGreaterThan(0);
  });

  it('返回首页重新核验成员关系，移除兼任后同时收起全部写入口', async () => {
    contextResponse = async () => ({ layout_mode: 'general', visible_project_count: 2 });
    const { router } = renderShell('/projects');
    await screen.findByRole('heading', { name: '业务内容' });
    expect(screen.getAllByRole('button', { name: '新建发布' }).length).toBeGreaterThan(0);
    contextResponse = async () => ({ layout_mode: 'maintainer', visible_project_count: 1 });
    await act(() => router.navigate('/dashboard'));
    await screen.findByRole('heading', { name: '业务内容' });
    await waitFor(() => expect(screen.queryAllByRole('button', { name: '新建发布' })).toHaveLength(0));
  });

  it('快捷搜索也隐藏审批、配置与创建入口', async () => {
    renderShell();
    await screen.findByRole('heading', { name: '业务内容' });
    fireEvent.click(screen.getByRole('button', { name: /搜索功能、项目、仓库、发布/ }));
    const panel = within(await screen.findByRole('dialog'));
    expect(panel.queryByText('新建发布')).toBeNull();
    expect(panel.queryByText('打包配置')).toBeNull();
    expect(panel.queryByText('仓库审批流配置')).toBeNull();
    expect(panel.queryByText('触发打包')).toBeNull();
  });

  it.each([
    ['maintainer', '/releases', '发布看板', '发布版本'],
    ['maintainer', '/releases/', '发布看板', '发布版本'],
    ['maintainer', '/Releases', '发布看板', '发布版本'],
    ['maintainer', '/packages', '打包看板', '打包任务'],
    ['maintainer', '/packages/task', '打包看板', '打包任务'],
    ['maintainer', '/Packages/task/', '打包看板', '打包任务'],
    ['maintainer', '/releases/version', '发布详情', '发布详情', '版本详情'],
    ['general', '/releases', '发布看板', '发布看板'],
    ['general', '/packages', '打包看板', '打包看板'],
  ])('%s 模式的 %s 使用对应的桌面与手机标题', async (mode, path, title, expected, mobileTitle = expected) => {
    contextResponse = async () => ({ layout_mode: mode, visible_project_count: 1 });
    renderShell(path, undefined, title);
    await screen.findByRole('heading', { name: '业务内容' });
    const header = within(screen.getByRole('banner'));
    expect(header.getAllByText(expected)).toHaveLength(mobileTitle === expected ? 2 : 1);
    if (mobileTitle !== expected) expect(header.getByText(mobileTitle)).toBeTruthy();
    expect(screen.getByRole('button', { name: '打开导航菜单' }).parentElement?.textContent).toContain(mobileTitle);
  });

  it.each(['overview', 'repos'])('在 %s 切为纯维保时立即收起写入口，恢复兼任后读取最新项目权限', async (tab) => {
    let mode = 'general';
    let projectReads = 0;
    let finishRefresh: ((role: string) => void) | undefined;
    const project = { id: 'project', name: '项目权限刷新', status: 1, my_role: 'manager' };
    contextResponse = async () => ({ layout_mode: mode, visible_project_count: 1 });
    const shellAdapter = request.defaults.adapter as AxiosAdapter;
    request.defaults.adapter = async (config) => {
      if (config.url === '/projects/project/components/') {
        return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: [] } };
      }
      if (config.url !== '/projects/project/') {
        return shellAdapter(config);
      }
      projectReads++;
      const data = projectReads === 1 ? project : await new Promise<typeof project>((resolve) => {
        finishRefresh = (role) => resolve({ ...project, my_role: role });
      });
      return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data } };
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
    const router = createMemoryRouter([{ element: <MainLayout />, children: [
      { path: '/projects/:id/:tab', element: <ProjectDetail /> },
    ] }], { initialEntries: [`/projects/project/${tab}`] });
    render(<QueryClientProvider client={client}><App><RouterProvider router={router} /></App></QueryClientProvider>);
    await screen.findByRole('heading', { name: '项目权限刷新' });
    expect(screen.getAllByRole('button', { name: '新建发布' }).length).toBeGreaterThan(1);
    if (tab === 'repos') expect(await screen.findByRole('button', { name: '关联已有仓库' })).toBeTruthy();

    mode = 'maintainer';
    await act(() => client.invalidateQueries({ queryKey: ['dashboard-context'] }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '成员' })).toBeNull());
    expect(screen.queryAllByRole('button', { name: '新建发布' })).toHaveLength(0);
    expect(screen.queryByRole('button', { name: '关联已有仓库' })).toBeNull();
    await waitFor(() => expect(projectReads).toBe(2));
    expect(client.getQueryData(['project', 'project'])).toMatchObject({ my_role: 'manager' });
    await act(async () => finishRefresh?.('maintainer'));
    await waitFor(() => expect(client.getQueryData(['project', 'project'])).toMatchObject({ my_role: 'maintainer' }));

    mode = 'general';
    await act(() => client.invalidateQueries({ queryKey: ['dashboard-context'] }));
    await waitFor(() => expect(projectReads).toBe(3));
    await act(async () => finishRefresh?.('developer'));
    await waitFor(() => expect(client.getQueryData(['project', 'project'])).toMatchObject({ my_role: 'developer' }));
    expect(screen.getAllByRole('button', { name: '新建发布' }).length).toBeGreaterThan(1);
  });

  it('普通账号切换页面内 Tab 时保留已挂载表单草稿', async () => {
    contextResponse = async () => ({ layout_mode: 'general', visible_project_count: 2 });
    const { router } = renderShell('/projects/project/overview', <DraftPage />);
    fireEvent.change(await screen.findByRole('textbox', { name: '页面草稿' }), { target: { value: '尚未保存' } });
    await act(() => router.navigate('/projects/project/members'));
    expect((await screen.findByRole('textbox', { name: '页面草稿' }) as HTMLInputElement).value).toBe('尚未保存');
  });

  it('后台权限刷新失败可重试且保留已填写的表单', async () => {
    contextResponse = async () => ({ layout_mode: 'general', visible_project_count: 2 });
    const { client } = renderShell('/projects/project/overview', <DraftPage />);
    fireEvent.change(await screen.findByRole('textbox', { name: '页面草稿' }), { target: { value: '尚未保存' } });
    contextResponse = async () => { throw new Error('暂时离线'); };
    await act(() => client.invalidateQueries({ queryKey: ['dashboard-context'] }));
    await screen.findByText('工作台权限刷新失败');
    expect((screen.getByRole('textbox', { name: '页面草稿' }) as HTMLInputElement).value).toBe('尚未保存');
    contextResponse = async () => ({ layout_mode: 'general', visible_project_count: 2 });
    fireEvent.click(screen.getByRole('button', { name: /重.*试/ }));
    await waitFor(() => expect(screen.queryByText('工作台权限刷新失败')).toBeNull());
    expect((screen.getByRole('textbox', { name: '页面草稿' }) as HTMLInputElement).value).toBe('尚未保存');
  });
});
