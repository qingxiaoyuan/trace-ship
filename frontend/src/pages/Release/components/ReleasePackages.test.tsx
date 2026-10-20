import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App, ConfigProvider } from 'antd';
import { AxiosError } from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import request from '@/api/request';
import { useAuthStore } from '@/stores/authStore';
import type { PackageConfig, UserInfo } from '@/types';
import ReleaseDetail from '../Detail';

const originalAdapter = request.defaults.adapter;
const originalUser = useAuthStore.getState().user;
const requests: { url?: string; params?: Record<string, unknown>; data?: unknown }[] = [];
let role = 'maintainer';
let mobile = false;
let taskCreated = false;
let triggerFailure = false;
let configFailure = false;
let projectFailure = false;
let configPages: PackageConfig[][];
let releaseStatus = 'released';
let releaseType = 'rc';
let previousTasks: { id: string; name: string; status: string; artifact_count: number }[] = [];
let refreshGate: Promise<void> | null = null;
const desktopListeners = new Set<(event: { matches: boolean }) => void>();
const configs: PackageConfig[] = [{
  id: 'config', name: '标准安装包', project_id: 'project', repository_id: 'repo', is_active: true,
  my_role: 'maintainer', created_at: '', updated_at: '',
}];

beforeEach(() => {
  requests.length = 0;
  role = 'developer';
  mobile = false;
  taskCreated = false;
  triggerFailure = false;
  configFailure = false;
  projectFailure = false;
  configPages = [configs];
  releaseStatus = 'released';
  releaseType = 'rc';
  previousTasks = [];
  refreshGate = null;
  desktopListeners.clear();
  useAuthStore.setState({ user: { id: 'operator', username: 'operator', is_superuser: false, permissions: [] } as unknown as UserInfo });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => {
      const desktopQuery = query.includes('min-width: 768px');
      return { matches: desktopQuery ? !mobile : false,
        addListener(listener: (event: { matches: boolean }) => void) { if (desktopQuery) desktopListeners.add(listener); },
        removeListener(listener: (event: { matches: boolean }) => void) { desktopListeners.delete(listener); },
        addEventListener(_event: string, listener: (event: { matches: boolean }) => void) { if (desktopQuery) desktopListeners.add(listener); },
        removeEventListener(_event: string, listener: (event: { matches: boolean }) => void) { desktopListeners.delete(listener); },
      };
    },
  });
  request.defaults.adapter = async (config) => {
    requests.push({ url: config.url, params: config.params, data: config.data ? JSON.parse(config.data) : undefined });
    let data: unknown;
    if (config.url === '/projects/project/') {
      if (projectFailure) throw new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, undefined, {
        config, status: 503, statusText: 'Service Unavailable', headers: {}, data: { code: 50300, message: '项目权限暂不可用' },
      });
      data = { id: 'project', name: '维保项目', my_role: role };
    } else if (config.url === '/packages/configs/') {
      if (configFailure) throw new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, undefined, {
        config, status: 503, statusText: 'Service Unavailable', headers: {}, data: { code: 50300, message: '配置服务暂不可用' },
      });
      const page = Number(config.params.page);
      data = { total: configPages.flat().length, page, page_size: 100, results: configPages[page - 1] || [] };
    }
    else if (config.url?.endsWith('/source-reference/')) data = { available: true, reference: 'V1.2.3', reason: '' };
    else if (config.url?.endsWith('/review-issues/')) data = [];
    else if (config.url === '/packages/configs/config/trigger/') {
      taskCreated = true;
      if (triggerFailure) throw new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, undefined, {
        config, status: 503, statusText: 'Service Unavailable', headers: {},
        data: { code: 50300, message: '打包任务投递失败，请稍后重试', data: { task_id: 'new-task', status: 'failure' } },
      });
      data = { id: 'new-task', name: 'V1.2.3 标准安装包', status: 'queued' };
    } else {
      if (config.url === '/releases/release/' && taskCreated && refreshGate) await refreshGate;
      data = {
      id: 'release', project: 'project', project_name: '维保项目', repository: 'repo', repository_name: '软件仓库',
      version: 'V1.2.3', tag_name: 'V1.2.3', git_hash: 'a'.repeat(40), branch: 'master',
      release_type: releaseType, status: releaseStatus, release_doc: '发布说明正文', publisher: 'original-publisher', created_at: '',
      package_tasks: taskCreated ? [{ id: 'new-task', name: 'V1.2.3 标准安装包', status: triggerFailure ? 'failure' : 'queued', artifact_count: 0 }, ...previousTasks] : previousTasks,
      };
    }
    return { config, status: config.method === 'post' ? 201 : 200, statusText: 'OK', headers: {}, data: { code: 0, data } };
  };
});

afterEach(() => {
  cleanup();
  request.defaults.adapter = originalAdapter;
  useAuthStore.setState({ user: originalUser });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderRelease() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><ConfigProvider theme={{ token: { motion: false } }}><App>
    <MemoryRouter initialEntries={['/releases/release']}><Routes>
      <Route path="/releases/:id" element={<ReleaseDetail />} />
      <Route path="/packages/:id" element={<div>新任务详情</div>} />
    </Routes></MemoryRouter>
  </App></ConfigProvider></QueryClientProvider>);
}

async function openPackages() {
  fireEvent.click(await screen.findByRole('button', { name: '打包任务' }));
}

describe('已发布版本补打', () => {
  it('开发人员在详情固定当前版本选择既有配置补打，刷新任务并可进入新任务', async () => {
    renderRelease();
    await openPackages();
    const selector = await screen.findByRole('combobox', { name: '打包配置' });
    expect(screen.getByText('当前版本：V1.2.3 / V1.2.3')).toBeTruthy();
    fireEvent.mouseDown(selector);
    fireEvent.click(await screen.findByRole('option', { name: '标准安装包' }));
    fireEvent.click(screen.getByRole('button', { name: '补打当前版本' }));
    await screen.findByText('V1.2.3 标准安装包');
    expect(requests.filter((entry) => entry.url?.endsWith('/trigger/'))).toEqual([
      { url: '/packages/configs/config/trigger/', params: undefined, data: { release_id: 'release' } },
    ]);
    expect(requests.find((entry) => entry.url === '/packages/configs/')?.params)
      .toMatchObject({ project: 'project', repository: 'repo', is_active: true });
    expect(screen.queryByRole('textbox', { name: /分支|脚本|环境|镜像|节点/ })).toBeNull();
    const success = await screen.findByRole('alert');
    fireEvent.click(within(success).getByRole('button', { name: '查看新任务' }));
    await waitFor(() => expect(screen.getByText('新任务详情')).toBeTruthy());
  });

  it('正式版已有任务时，延迟刷新的任务列表提交后仍保留配置和新任务入口', async () => {
    releaseType = 'formal';
    previousTasks = Array.from({ length: 4 }, (_, index) => ({
      id: `previous-${index}`, name: `已有任务 ${index + 1}`, status: 'success', artifact_count: 1,
    }));
    let releaseRefresh: () => void = () => {};
    refreshGate = new Promise((resolve) => { releaseRefresh = resolve; });
    renderRelease();
    await openPackages();
    const section = await screen.findByRole('region', { name: '补打已发布版本' });
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: '打包配置' }));
    fireEvent.click(await screen.findByRole('option', { name: '标准安装包' }));
    fireEvent.click(screen.getByRole('button', { name: '补打当前版本' }));
    await screen.findByText('已创建补打任务');
    await act(async () => releaseRefresh());
    await screen.findByText('V1.2.3 标准安装包');
    expect(screen.getByRole('region', { name: '补打已发布版本' })).toBe(section);
    expect(within(section).getByTitle('标准安装包')).toBeTruthy();
    expect(within(section).getByText('已创建补打任务')).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: '查看新任务' }));
    await screen.findByText('新任务详情');
  });

  it('桌面断点短暂切换后保留补打结果和配置，新任务入口仍可点击', async () => {
    renderRelease();
    await openPackages();
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: '打包配置' }));
    fireEvent.click(await screen.findByRole('option', { name: '标准安装包' }));
    fireEvent.click(screen.getByRole('button', { name: '补打当前版本' }));
    await screen.findByText('V1.2.3 标准安装包');
    await screen.findByText('已创建补打任务');
    await act(async () => { mobile = true; desktopListeners.forEach((listener) => listener({ matches: false })); });
    expect(screen.queryByRole('region', { name: '补打已发布版本' })).toBeNull();
    await act(async () => { mobile = false; desktopListeners.forEach((listener) => listener({ matches: true })); });
    const section = await screen.findByRole('region', { name: '补打已发布版本' });
    expect(within(section).getByTitle('标准安装包')).toBeTruthy();
    expect(within(section).getByText('已创建补打任务')).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: '查看新任务' }));
    await screen.findByText('新任务详情');
  });

  it('投递失败保留真实原因和失败任务，刷新任务列表并允许沿用配置重试', async () => {
    triggerFailure = true;
    renderRelease();
    await openPackages();
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: '打包配置' }));
    fireEvent.click(await screen.findByRole('option', { name: '标准安装包' }));
    fireEvent.click(screen.getByRole('button', { name: '补打当前版本' }));
    expect(await screen.findByText('打包任务投递失败，请稍后重试')).toBeTruthy();
    expect(screen.getByRole('button', { name: '查看失败任务' })).toBeTruthy();
    expect(await screen.findByText('V1.2.3 标准安装包')).toBeTruthy();
    expect(screen.queryByText('已创建补打任务')).toBeNull();
    triggerFailure = false;
    fireEvent.click(screen.getByRole('button', { name: '补打当前版本' }));
    await screen.findByText('已创建补打任务');
    expect(requests.filter((entry) => entry.url?.endsWith('/trigger/'))).toHaveLength(2);
    expect(screen.queryByText('打包任务投递失败，请稍后重试')).toBeNull();
  });

  it('配置加载失败显示真实错误并可重试，不伪装成没有配置', async () => {
    configFailure = true;
    renderRelease();
    await openPackages();
    await screen.findByText('配置服务暂不可用');
    expect(screen.queryByText('当前项目的软件暂无启用的打包配置，请联系项目管理员。')).toBeNull();
    configFailure = false;
    fireEvent.click(screen.getByRole('button', { name: '重试加载配置' }));
    const selector = await screen.findByRole('combobox', { name: '打包配置' });
    fireEvent.mouseDown(selector);
    expect(await screen.findByRole('option', { name: '标准安装包' })).toBeTruthy();
  });

  it('完整读取配置分页，只提供当前项目同软件的启用配置', async () => {
    configPages = [[
      { ...configs[0], id: 'disabled', name: '停用配置', is_active: false },
      { ...configs[0], id: 'other-project', name: '共享仓库其他项目配置', project_id: 'other' },
      { ...configs[0], id: 'other-repo', name: '同项目其他软件配置', repository_id: 'other' },
    ], configs];
    renderRelease();
    await openPackages();
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: '打包配置' }));
    await screen.findByRole('option', { name: '标准安装包' });
    expect(screen.queryByRole('option', { name: /停用配置|共享仓库其他项目配置|同项目其他软件配置/ })).toBeNull();
    expect(requests.filter((entry) => entry.url === '/packages/configs/').map((entry) => entry.params?.page)).toEqual([1, 2]);
  });

  it.each(['developer', 'tester', 'manager', 'software_admin'])('保留目标项目 %s 的发布补打入口', async (projectRole) => {
    role = projectRole;
    renderRelease();
    await openPackages();
    expect(await screen.findByRole('combobox', { name: '打包配置' })).toBeTruthy();
  });

  it.each(['maintainer', 'viewer', 'auditor', null])('目标项目角色 %s 没有补打入口，不借用其他项目或全局权限', async (projectRole) => {
    role = projectRole as string;
    useAuthStore.setState({ user: { ...useAuthStore.getState().user!, permissions: ['package.trigger', 'package.config.manage'] } });
    renderRelease();
    await openPackages();
    await screen.findByText('该发布暂无打包任务');
    await waitFor(() => expect(screen.queryByText('正在核验补打权限…')).toBeNull());
    expect(screen.queryByRole('combobox', { name: '打包配置' })).toBeNull();
    expect(requests.some((entry) => entry.url === '/packages/configs/')).toBe(false);
  });

  it.each(['draft', 'pending', 'rejected'])('%s 发布不提供补打入口', async (status) => {
    releaseStatus = status;
    renderRelease();
    await openPackages();
    expect(screen.queryByRole('button', { name: '补打当前版本' })).toBeNull();
    expect(requests.some((entry) => entry.url === '/packages/configs/')).toBe(false);
  });

  it('手机不显示新增补打入口，也不加载配置', async () => {
    mobile = true;
    renderRelease();
    await openPackages();
    expect(screen.queryByRole('region', { name: '补打已发布版本' })).toBeNull();
    expect(screen.queryByRole('button', { name: '补打当前版本' })).toBeNull();
    expect(requests.some((entry) => entry.url === '/packages/configs/')).toBe(false);
  });

  it('目标项目权限核验失败可见且可重试', async () => {
    projectFailure = true;
    renderRelease();
    await openPackages();
    expect(await screen.findByText('项目权限暂不可用')).toBeTruthy();
    expect(requests.some((entry) => entry.url === '/packages/configs/')).toBe(false);
    projectFailure = false;
    fireEvent.click(screen.getByRole('button', { name: '重试权限核验' }));
    expect(await screen.findByRole('combobox', { name: '打包配置' })).toBeTruthy();
  });
});
