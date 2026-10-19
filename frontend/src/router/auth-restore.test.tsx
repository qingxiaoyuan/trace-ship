import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import App from '@/App';
import { router } from '@/router';
import request from '@/api/request';
import { useAuthStore } from '@/stores/authStore';

const originalAdapter = request.defaults.adapter;
const originalState = useAuthStore.getState();
let finishRefresh: (data: unknown) => void;
let rejectRefresh: (error: Error) => void;
let finishSso: (data: unknown) => void;
let delaySso = false;
const requests: string[] = [];

beforeEach(async () => {
  requests.length = 0;
  delaySso = false;
  sessionStorage.clear();
  localStorage.clear();
  localStorage.setItem('accessToken', 'saved-access');
  localStorage.setItem('refreshToken', 'saved-refresh');
  useAuthStore.setState({ token: 'saved-access', refreshToken: 'saved-refresh', user: null, menus: [],
    hydrated: true, isAuthenticated: false, isInitializing: false });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  Object.defineProperty(window, 'matchMedia', {
    configurable: true, value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
  });
  request.defaults.adapter = async (config) => {
    requests.push(config.url || '');
    let data: unknown = { total: 0, results: [], page: 1, page_size: 100 };
    if (config.url === '/auth/token/refresh/') data = await new Promise((resolve, reject) => { finishRefresh = resolve; rejectRefresh = reject; });
    else if (config.url === '/auth/sso/login/') data = delaySso
      ? await new Promise((resolve) => { finishSso = resolve; })
      : { access_token: 'sso-access', refresh_token: 'sso-refresh' };
    else if (config.url === '/auth/user-info/') data = { id: 'maintainer', username: 'maintainer', nickname: '维保人员', is_superuser: false, permissions: [] };
    else if (config.url === '/auth/menus/') data = [];
    else if (config.url === '/notifications/remind-summary/') data = { todo_task_count: 0, open_issue_count: 0, todo_tasks: [], open_issues: [], strong_notices: [] };
    else if (config.url === '/releases/dashboard/context/') data = { layout_mode: 'maintainer', visible_project_count: 1 };
    else if (config.url === '/releases/dashboard/maintainer-summary/') data = { projects: [], recent_tasks: [], software_count: 0,
      stats: { days: 30, released_count: 0, failed_task_count: 0, package_total: 0, package_success: 0, package_success_rate: null } };
    else if (config.url === '/packages/tasks/deep-task/') data = {
      id: 'deep-task', name: '刷新定位任务', version: 'V1.0.0', status: 'success', my_role: 'maintainer',
      can_cancel: false, can_delete: false, can_push_svn: false, artifact_info: [], config_snapshot: {},
    };
    else if (config.url === '/packages/tasks/deep-task/logs/') data = { size: 0, offset: 0, content: '' };
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data } };
  };
  await router.navigate('/packages/deep-task?from=notification');
});

afterEach(async () => {
  cleanup();
  request.defaults.adapter = originalAdapter;
  useAuthStore.setState(originalState);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await router.navigate('/login');
});

describe('刷新任务深链时恢复会话', () => {
  it('等待持久化会话恢复，恢复后仍停留原任务路径及查询条件', async () => {
    render(<App />);
    await waitFor(() => expect(finishRefresh).toBeTypeOf('function'));
    expect(router.state.location.pathname).toBe('/packages/deep-task');
    expect(router.state.location.search).toBe('?from=notification');
    await act(async () => { finishRefresh({ access: 'renewed-access', refresh: 'renewed-refresh' }); });
    expect(await screen.findByText('刷新定位任务')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/packages/deep-task');
    expect(router.state.location.search).toBe('?from=notification');
  });

  it('持久化会话恢复失败后仍跳转登录，清除失效令牌', async () => {
    render(<App />);
    await waitFor(() => expect(requests).toContain('/auth/token/refresh/'));
    await act(async () => { rejectRefresh(new Error('恢复凭证已失效')); });
    expect(await screen.findByRole('heading', { name: '欢迎回来' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().refreshToken).toBeNull();
  });

  it('没有持久化会话时直接进入登录，不等待不存在的恢复请求', async () => {
    useAuthStore.getState().clearAuth();
    render(<App />);
    expect(await screen.findByRole('heading', { name: '欢迎回来' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect(requests).not.toContain('/auth/token/refresh/');
  });

  it('SSO入口仍直接建立新会话，不被旧持久化令牌的等待拦住', async () => {
    delaySso = true;
    await router.navigate('/sso?token=oa-ticket');
    render(<App />);
    await screen.findByText('正在通过 OA 单点登录…');
    await waitFor(() => expect(requests).toContain('/auth/sso/login/'));
    expect(requests).not.toContain('/auth/token/refresh/');
    await act(async () => { finishSso({ access_token: 'sso-access', refresh_token: 'sso-refresh' }); });
    expect(await screen.findByRole('heading', { name: '维保工作台' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/dashboard');
    expect(useAuthStore.getState().refreshToken).toBe('sso-refresh');
  });

  it.each(['成功', '失败'])('新SSO会话建立后，旧会话恢复%s不会覆盖新登录', async (outcome) => {
    render(<App />);
    await waitFor(() => expect(requests).toContain('/auth/token/refresh/'));
    await act(async () => { await useAuthStore.getState().ssoLogin('oa-ticket'); });
    await act(async () => {
      if (outcome === '失败') rejectRefresh(new Error('旧恢复请求失败'));
      else finishRefresh({ access: 'old-access', refresh: 'old-refresh' });
    });
    expect(await screen.findByText('刷新定位任务')).toBeTruthy();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().refreshToken).toBe('sso-refresh');
    expect(useAuthStore.getState().token).toBe('sso-access');
    expect(router.state.location.pathname).toBe('/packages/deep-task');
  });
});
