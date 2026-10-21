import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { App } from 'antd';
import request from '@/api/request';
import { DashboardContextProvider } from '@/layouts/DashboardContextProvider';
import { MainLayout } from '@/layouts/MainLayout';
import Dashboard from './index';
import ReleaseDetail from '@/pages/Release/Detail';

const originalAdapter = request.defaults.adapter;
const requests: string[] = [];
let layoutMode = 'maintainer';
let releaseResponse: (params: Record<string, unknown>) => unknown;
const releaseQueries: Record<string, unknown>[] = [];
let summaryFailure = false;
const summary = {
  software_count: 4,
  projects: [{ id: 'project', name: '智慧园区', release_count: 8, software: [{ id: 'web', name: 'park-web', release_count: 5 }, { id: 'server', name: 'park-server', release_count: 3 }] },
    { id: 'sdk', name: '对外 SDK', release_count: 4, software: [{ id: 'core', name: 'sdk-core', release_count: 2 }, { id: 'runtime', name: 'sdk-runtime', release_count: 2 }] }],
  stats: { days: 30, released_count: 5, failed_task_count: 1, package_total: 34, package_success: 32, package_success_rate: 94.1 },
  recent_tasks: [{ id: 'task', project: 'project', component_name: 'park-web', project_name: '智慧园区', version: 'VA.5.1.3', status: 'failure', status_display: '失败', created_at: '2026-10-15T09:12:00+08:00', duration: 0, error_message: '产物上传超时', artifact_count: 0, trigger_source: 'auto_release' }],
};

const release = {
  id: 'version', project: 'project', project_name: '示例项目', repository: 'repo', repository_name: '物理仓库', update_summary: '新增访客预约，优化车辆通行记录查询',
  component_name: '项目内软件', version: 'V1.2.3', release_type: 'rc', status: 'released',
  released_at: null, created_at: '2026-10-01T10:00:00+08:00',
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  requests.length = 0;
  releaseQueries.length = 0;
  summaryFailure = false;
  layoutMode = 'maintainer';
  releaseResponse = () => ({ total: 1, page: 1, page_size: 10, results: [release] });
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
  });
  request.defaults.adapter = async (config) => {
    requests.push(config.url || '');
    let data: unknown = { total: 0, page: 1, page_size: 10, results: [] };
    if (config.url === '/releases/dashboard/context/') data = { layout_mode: layoutMode, visible_project_count: layoutMode === 'general' ? 0 : 25 };
    else if (config.url === '/releases/dashboard/maintainer-summary/') {
      if (summaryFailure) throw new Error('总览暂不可用');
      data = summary;
    }
    else if (config.url === '/releases/') { releaseQueries.push(config.params); data = await releaseResponse(config.params); }
    else if (config.url === '/releases/version/') data = { ...release, release_doc: '| 字段 | 内容 |\n| --- | --- |\n| 额外说明 | 返回后保留查询位置 |' };
    else if (config.url === '/projects/project/') data = { id: 'project', name: '示例项目', my_role: 'maintainer' };
    else if (config.url?.endsWith('/source-reference/')) data = { available: true, reference: 'V1.2.3' };
    else if (config.url?.endsWith('/trend/') || config.url?.endsWith('/favorites/')) data = [];
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data } };
  };
});
afterEach(() => { cleanup(); request.defaults.adapter = originalAdapter; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function renderDashboard(entry = '/dashboard', withShell = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{
    element: withShell ? <MainLayout /> : <DashboardContextProvider><Outlet /></DashboardContextProvider>,
    children: [
      { path: '/dashboard', element: <Dashboard />, handle: { title: '工作台' } },
      { path: '/releases/:id', element: <ReleaseDetail />, handle: { title: '发布详情' } },
    ],
  }], { initialEntries: [entry] });
  render(<QueryClientProvider client={client}><App><RouterProvider router={router} /></App></QueryClientProvider>);
  return client;
}

describe('维保工作台', () => {
  it('读取所属项目的已发布版本，以项目内软件名称和真实发布时间展示', async () => {
    renderDashboard();
    expect(await screen.findByRole('heading', { name: /发布版本/ })).toBeTruthy();
    expect(await screen.findByText('项目内软件')).toBeTruthy();
    expect(screen.getByText('发布时间未记录')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'V1.2.3' }).getAttribute('href')).toBe('/releases/version');
    expect(screen.getByRole('link', { name: '查看 V1.2.3 的发布说明' }).getAttribute('href')).toBe('/releases/version');
    expect(screen.getByRole('link', { name: /发布记录/ }).getAttribute('href')).toBe('/releases');
    expect(await screen.findByText('你所属的 25 个项目 · 4 个软件')).toBeTruthy();
    expect(screen.getByText('新增访客预约，优化车辆通行记录查询')).toBeTruthy();
    expect(screen.getByRole('link', { name: /park-web.*失败/ }).getAttribute('href')).toBe('/packages/task');
    expect(screen.getByText('第三方问题反馈尚未接入')).toBeTruthy();
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByText('物理仓库')).toBeNull();
    expect(requests.some((url) => url.includes('/workflow/') || url.includes('/packages/') || url.includes('/overview/'))).toBe(false);
  });

  it('按已发布与发布时间查询下一页，显示真实总量和该页版本', async () => {
    releaseResponse = (params) => {
      expect(params).toMatchObject({ status: 'released', ordering: '-released_at', page_size: 6 });
      return { total: 7, page: params.page, page_size: 6, results: params.page === 2
        ? [{ ...release, id: 'last', version: 'V2.0.0', released_at: '2026-10-15T09:30:00+08:00' }]
        : Array.from({ length: 6 }, (_, index) => ({ ...release, id: String(index), version: `V1.0.${index}` })) };
    };
    renderDashboard();
    await screen.findByText('共 7 个版本');
    fireEvent.click(screen.getByTitle('2'));
    expect(await screen.findByRole('link', { name: 'V2.0.0' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /V1.0.0/ })).toBeNull();
    expect(document.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-15T09:30:00+08:00');
  });

  it('无发布与接口失败分开显示，失败后可重试', async () => {
    releaseResponse = () => { throw new Error('发布查询失败'); };
    renderDashboard();
    await screen.findByText('已发布版本加载失败');
    expect(screen.queryByText('所属项目暂无已发布版本')).toBeNull();
    releaseResponse = () => ({ total: 0, results: [], page: 1, page_size: 10 });
    fireEvent.click(screen.getByRole('button', { name: /重.*试/ }));
    expect(await screen.findByText('所属项目暂无已发布版本')).toBeTruthy();
  });

  it('快速切换关键词后只显示当前结果，较晚返回的旧响应不会覆盖页面', async () => {
    let resolveOld!: (value: unknown) => void;
    let resolveNew!: (value: unknown) => void;
    releaseResponse = (params) => params.search === '旧条件'
      ? new Promise((resolve) => { resolveOld = resolve; })
      : params.search === '新条件'
        ? new Promise((resolve) => { resolveNew = resolve; })
        : { total: 1, page: 1, page_size: 6, results: [release] };
    const client = renderDashboard();
    await waitFor(() => expect(client.isFetching()).toBe(0));
    await screen.findByRole('link', { name: 'V1.2.3' });
    const search = screen.getByRole('textbox', { name: '搜索版本、软件或发布说明' });
    fireEvent.change(search, { target: { value: '旧条件' } });
    await waitFor(() => expect(resolveOld).toBeTypeOf('function'));
    fireEvent.change(search, { target: { value: '新条件' } });
    await waitFor(() => expect(resolveNew).toBeTypeOf('function'));
    resolveNew({ total: 1, page: 1, page_size: 6, results: [{ ...release, id: 'new', version: 'V2.0.0' }] });
    await screen.findByRole('link', { name: 'V2.0.0' });
    resolveOld({ total: 19, page: 1, page_size: 6, results: [{ ...release, id: 'old', version: 'V0.0.1' }] });
    // 等旧查询完成后再核对页面，避免依赖机器速度的固定等待。
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.getByRole('link', { name: 'V2.0.0' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'V0.0.1' })).toBeNull();
    expect(screen.getByText('共 1 个版本')).toBeTruthy();
    expect((search as HTMLInputElement).value).toBe('新条件');
  });

  it('从筛选后的第二页阅读说明再返回，保留范围、关键词、类型、页码和位置', async () => {
    releaseResponse = (params) => ({ total: 7, page: params.page, page_size: 6, results: params.page === 2 ? [release] : [{ ...release, version: 'V1.0.0' }] });
    window.matchMedia = (query) => ({
      matches: query === '(max-width: 767.98px)', media: query, onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
    });
    renderDashboard('/dashboard?project=project&repository=web&type=rc&search=访客&page=2', true);
    const link = await screen.findByRole('link', { name: '查看 V1.2.3 的发布说明' });
    const content = screen.getByRole('main');
    content.scrollTop = 380;
    fireEvent.click(link);
    await screen.findByText('返回后保留查询位置');
    expect(screen.queryByRole('button', { name: /修改文档|删除版本/ })).toBeNull();
    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: '返回上一页' }));
    await screen.findByRole('link', { name: '查看 V1.2.3 的发布说明' });
    expect((screen.getByRole('textbox', { name: '搜索版本、软件或发布说明' }) as HTMLInputElement).value).toBe('访客');
    expect(screen.getByRole('button', { name: 'RC' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /选择项目与软件/ }).textContent).toContain('park-web');
    expect(screen.queryByRole('link', { name: 'V1.0.0' })).toBeNull();
    await waitFor(() => expect(screen.getByRole('main').scrollTop).toBe(380));
    expect(releaseQueries.at(-1)).toMatchObject({ project: 'project', repository: 'web', release_type: 'rc', search: '访客', page: 2 });
  });

  it('第二页变更条件回到第一页，无匹配时保留范围并可恢复全部', async () => {
    releaseResponse = (params) => ({ total: params.search ? 0 : 7, page: params.page, page_size: 6, results: params.search ? [] : [release] });
    renderDashboard('/dashboard?project=project&repository=web&type=rc&page=2');
    await screen.findByRole('link', { name: 'V1.2.3' });
    const search = screen.getByRole('textbox', { name: '搜索版本、软件或发布说明' });
    fireEvent.change(search, { target: { value: '无匹配说明' } });
    await screen.findByText('没有匹配的已发布版本');
    expect(releaseQueries.at(-1)).toMatchObject({ project: 'project', repository: 'web', release_type: 'rc', search: '无匹配说明', page: 1 });
    expect((search as HTMLInputElement).value).toBe('无匹配说明');
    expect(screen.getByRole('button', { name: /选择项目与软件/ }).textContent).toContain('park-web');
    expect(screen.getByRole('button', { name: 'RC' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getAllByRole('button', { name: '恢复全部' })[0]);
    await screen.findByRole('link', { name: 'V1.2.3' });
    expect(releaseQueries.at(-1)).toMatchObject({ project: undefined, repository: undefined, release_type: undefined, search: undefined, page: 1 });
    expect((search as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: '全部类型' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('无项目的通用模式继续加载原工作台内容', async () => {
    layoutMode = 'general';
    releaseResponse = () => ({ total: 0, results: [], page: 1, page_size: 10 });
    renderDashboard();
    expect(await screen.findByText('我的待办')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '维保工作台' })).toBeNull();
    expect(requests).toContain('/releases/dashboard/overview/');
  });

  it('手机范围在应用后生效，关闭丢弃临时选择，清空保留关键词和类型', async () => {
    renderDashboard();
    await screen.findByText('你所属的 25 个项目 · 4 个软件');
    fireEvent.change(screen.getByRole('textbox', { name: '搜索版本、软件或发布说明' }), { target: { value: '访客' } });
    fireEvent.click(screen.getByRole('button', { name: '正式' }));
    const chooseWeb = async () => {
      fireEvent.click(screen.getByRole('button', { name: /选择项目与软件/ }));
      const dialog = await screen.findByRole('dialog');
      const projectToggle = within(dialog).getByRole('button', { name: /智慧园区/ });
      if (projectToggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(projectToggle);
      fireEvent.click(within(dialog).getByRole('radio', { name: '智慧园区 / park-web' }));
      return dialog;
    };
    let dialog = await chooseWeb();
    expect(releaseQueries.at(-1)?.project).toBeUndefined();
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭范围筛选' }));
    dialog = await chooseWeb();
    fireEvent.click(within(dialog).getByRole('button', { name: '应用筛选' }));
    await waitFor(() => expect(releaseQueries.at(-1)).toMatchObject({ project: 'project', repository: 'web', search: '访客', release_type: 'formal', page: 1 }));
    expect(screen.getByText('94.1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /选择项目与软件/ }));
    dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '清空' }));
    expect(releaseQueries.at(-1)?.project).toBe('project');
    fireEvent.click(within(dialog).getByRole('button', { name: '应用筛选' }));
    await waitFor(() => expect(releaseQueries.at(-1)).toMatchObject({ project: undefined, repository: undefined, search: '访客', release_type: 'formal' }));
    fireEvent.click(screen.getByRole('button', { name: '恢复全部' }));
    expect((screen.getByRole('textbox', { name: '搜索版本、软件或发布说明' }) as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: '全部类型' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('总览失败不会显示虚假零值，发布列表仍可使用并能重试总览', async () => {
    summaryFailure = true;
    renderDashboard();
    await screen.findByText('项目总览加载失败');
    expect(await screen.findByRole('link', { name: 'V1.2.3' })).toBeTruthy();
    expect(screen.queryByText('94.1')).toBeNull();
    summaryFailure = false;
    fireEvent.click(screen.getByRole('button', { name: '重试总览' }));
    expect(await screen.findByText('94.1')).toBeTruthy();
  });

  it('桌面范围弹层有名称，打开后聚焦搜索，Escape 关闭并还原焦点', async () => {
    window.matchMedia = () => ({ matches: true, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
    renderDashboard();
    await screen.findByText('你所属的 25 个项目 · 4 个软件');
    const trigger = screen.getByRole('button', { name: /选择项目与软件/ });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: '选择项目与软件' });
    const input = within(dialog).getByRole('textbox', { name: '搜索项目或软件' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'));
    expect(document.activeElement).toBe(trigger);
  });
});
