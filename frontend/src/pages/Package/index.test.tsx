import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { App } from 'antd';
import { AxiosError } from 'axios';
import request, { registerErrorNotifier } from '@/api/request';
import type { PackageTask, Release, UserInfo } from '@/types';
import type { TaskLogChunk } from '@/api/package';
import { DashboardContextProvider } from '@/layouts/DashboardContextProvider';
import { MaintainerDashboard } from '@/pages/Dashboard/MaintainerDashboard';
import { ReleasePackages } from '@/pages/Release/components/ReleasePackages';
import { useAuthStore } from '@/stores/authStore';
import PackageTaskPage from './index';

const originalAdapter = request.defaults.adapter;
const originalUser = useAuthStore.getState().user;
let detailFailure = false;
let logFailure = false;
let logResponse: (params: Record<string, number>) => TaskLogChunk;
let taskResponse: PackageTask;
let delayedTask: Promise<PackageTask> | null;
let downloadFailureMessage: string | null;
const logQueries: Record<string, number>[] = [];
const downloadFiles: { blob: Blob; filename: string }[] = [];
let pendingBlob: Blob;
const task = {
  id: 'task', name: '所属项目打包任务', version: 'V1.2.3', status: 'success',
  my_role: 'maintainer', can_cancel: false, can_push_svn: false, can_delete: false,
  artifact_info: [], config_snapshot: {}, project_name: '示例项目', created_at: '2026-10-19T08:00:00Z',
} as unknown as PackageTask;

beforeEach(() => {
  detailFailure = false;
  logFailure = false;
  logQueries.length = 0;
  downloadFiles.length = 0;
  logResponse = () => ({ size: 0, offset: 0, content: '' });
  taskResponse = { ...task };
  delayedTask = null;
  downloadFailureMessage = null;
  useAuthStore.setState({ user: { id: 'maintainer', username: 'maintainer', is_superuser: false,
    permissions: ['package.task.delete', 'package.config.manage', 'package.trigger'] } as UserInfo });
  // jsdom 不计算布局；同时提供元素外框与可滚动视口尺寸，让真实虚拟列表计算可见行。
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(420);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(420);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL(blob: Blob) { pendingBlob = blob; return 'blob:download'; }
    static revokeObjectURL() {}
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloadFiles.push({ blob: pendingBlob, filename: this.download });
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
  });
  request.defaults.adapter = async (config) => {
    if (config.responseType === 'blob' && downloadFailureMessage) throw new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, undefined, {
      config, status: 404, statusText: 'Not Found', headers: {},
      data: new Blob([JSON.stringify({ code: 40400, message: downloadFailureMessage })], { type: 'application/json' }),
    });
    let data: unknown = { total: 0, results: [], page: 1, page_size: 100 };
    if (config.url === '/releases/dashboard/context/') data = { layout_mode: 'maintainer', visible_project_count: 1 };
    else if (config.url === '/releases/dashboard/maintainer-summary/') data = {
      software_count: 1, projects: [], stats: { days: 30, released_count: 1, failed_task_count: 0, package_total: 1, package_success: 1, package_success_rate: 100 },
      recent_tasks: [{ ...task, component_name: '所属项目软件', status_display: '成功', artifact_count: 1, duration: 1000, trigger_source: 'auto_release' }],
    };
    else if (config.url === '/packages/tasks/') data = { total: 1, results: [taskResponse], page: 1, page_size: 50 };
    else if (config.url === '/packages/tasks/task/') {
      if (detailFailure) throw new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, undefined, {
        config, status: 404, statusText: 'Not Found', headers: {}, data: { code: 40400, message: '任务不存在或无权查看' },
      });
      data = delayedTask ? await delayedTask : taskResponse;
    } else if (config.url === '/packages/tasks/new-task/') {
      data = { ...task, id: 'new-task', name: '新选择任务' };
    } else if (config.url === '/packages/tasks/new-task/logs/') {
      data = { size: 0, offset: 0, content: '' };
    } else if (config.url === '/packages/tasks/task/logs/') {
      if (config.responseType === 'blob') return { config, status: 200, statusText: 'OK', headers: {}, data: new Blob(['完整首行\n日志尾行\n'], { type: 'text/plain' }) };
      logQueries.push(config.params);
      if (logFailure) throw new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, undefined, {
        config, status: 404, statusText: 'Not Found', headers: {}, data: { code: 40400, message: '日志未生成或已清理' },
      });
      data = logResponse(config.params);
    } else if (config.url === '/packages/tasks/task/artifacts/installer/download/') {
      return { config, status: 200, statusText: 'OK', headers: {}, data: new Blob(['真实安装包内容'], { type: 'application/octet-stream' }) };
    } else if (config.url === '/packages/tasks/task/download-all/') {
      return { config, status: 200, statusText: 'OK', headers: {}, data: new Blob(['ZIP文件内容'], { type: 'application/zip' }) };
    }
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data } };
  };
});

afterEach(() => { cleanup(); request.defaults.adapter = originalAdapter; registerErrorNotifier(() => {}); useAuthStore.setState({ user: originalUser }); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function renderTask(entry = '/packages/task') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><App><MemoryRouter initialEntries={[entry]}>
    <DashboardContextProvider><Routes>
      <Route path="/packages" element={<PackageTaskPage />} />
      <Route path="/packages/:id" element={<><Link to="/packages/new-task">切换到新任务</Link><PackageTaskPage /></>} />
      <Route path="/dashboard" element={<MaintainerDashboard projectCount={1} />} />
      <Route path="/release-packages" element={<ReleasePackages release={{ package_tasks: [{ ...task, artifact_count: 1 }] } as unknown as Release} />} />
    </Routes></DashboardContextProvider>
  </MemoryRouter></App></QueryClientProvider>);
  return client;
}

describe('打包任务读取', () => {
  it('任务详情读取失败显示具体原因并可重试', async () => {
    detailFailure = true;
    renderTask();
    expect(await screen.findByText('任务详情加载失败')).toBeTruthy();
    expect(screen.getByText('任务不存在或无权查看')).toBeTruthy();
    expect(screen.queryByText('暂无日志')).toBeNull();
    detailFailure = false;
    fireEvent.click(screen.getByRole('button', { name: '重试任务' }));
    await waitFor(() => expect(screen.getByText('所属项目打包任务')).toBeTruthy());
    expect(screen.queryByText('任务详情加载失败')).toBeNull();
  });

  it('终态日志缺失显示真实原因，重试后恢复正常空日志', async () => {
    logFailure = true;
    renderTask();
    expect(await screen.findByText('日志加载失败')).toBeTruthy();
    expect(screen.getByText('日志未生成或已清理')).toBeTruthy();
    expect(screen.queryByText('暂无日志')).toBeNull();
    logFailure = false;
    fireEvent.click(screen.getByRole('button', { name: '重试日志' }));
    expect(await screen.findByText('暂无日志')).toBeTruthy();
    expect(screen.queryByText('日志加载失败')).toBeNull();
  });

  it('日志按字节偏移追加，结束时补齐最后一段并停止轮询', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    taskResponse = { ...task, status: 'running' };
    logResponse = () => ({ size: 7, offset: 0, content: '开始\n' });
    renderTask();
    expect(await screen.findByText('开始')).toBeTruthy();
    taskResponse = { ...task, status: 'failure', error_message: '构建命令执行失败' };
    logResponse = (params) => params.offset === 7
      ? { size: 14, offset: 7, content: '失败\n' }
      : { size: 24, offset: 14, content: 'SVN完成\n' };
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByText('开始')).toBeTruthy();
    expect(screen.getByText('失败', { selector: '.absolute' })).toBeTruthy();
    expect(screen.getByText('SVN完成')).toBeTruthy();
    expect(screen.getByText('构建命令执行失败')).toBeTruthy();
    expect(logQueries).toEqual([{ tail: 262144 }, { offset: 7 }, { offset: 14 }]);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(logQueries).toHaveLength(3);
  });

  it('开发人员可按产物名称下载所属任务的单个文件', async () => {
    taskResponse = { ...task, my_role: 'developer', artifact_info: [{ id: 'installer', name: '客户端.zip', path: '客户端.zip', size: 32, sha256: 'sha' }] };
    renderTask();
    fireEvent.click(await screen.findByRole('button', { name: '下载 客户端.zip' }));
    await waitFor(() => expect(downloadFiles).toHaveLength(1));
    expect(downloadFiles[0].filename).toBe('客户端.zip');
    expect(await readBlob(downloadFiles[0].blob)).toBe('真实安装包内容');
  });

  it('下载全部与完整日志使用当前任务，下载日志不受首屏截尾影响', async () => {
    taskResponse = { ...task, my_role: 'developer', artifact_info: [{ id: 'installer', name: '客户端.zip', path: '客户端.zip', size: 32, sha256: 'sha' }] };
    logResponse = (params) => params.tail
      ? { size: 2000000, offset: 1999990, content: '日志尾行\n' }
      : { size: 2000000, offset: 2000000, content: '' };
    renderTask();
    expect(await screen.findByText('日志较大，仅显示末尾部分')).toBeTruthy();
    expect(screen.queryByText('完整首行')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '下载完整日志' }));
    await waitFor(() => expect(downloadFiles).toHaveLength(1));
    expect(downloadFiles[0].filename).toBe('build-task.log');
    expect(await readBlob(downloadFiles[0].blob)).toBe('完整首行\n日志尾行\n');
    fireEvent.click(screen.getByRole('button', { name: '下载全部' }));
    await waitFor(() => expect(downloadFiles).toHaveLength(2));
    expect(downloadFiles[1].filename).toBe('所属项目打包任务-V1.2.3-artifacts.zip');
    expect(downloadFiles[1].blob.type).toBe('application/zip');
  });

  it('日志轮询失败保留已取得的内容，重试后按原偏移继续读取', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    taskResponse = { ...task, status: 'running' };
    logResponse = () => ({ size: 7, offset: 0, content: '开始\n' });
    renderTask();
    await screen.findByText('开始');
    logFailure = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByText('开始')).toBeTruthy();
    expect(screen.getByText('日志加载失败')).toBeTruthy();
    logFailure = false;
    logResponse = () => ({ size: 14, offset: 7, content: '恢复\n' });
    fireEvent.click(screen.getByRole('button', { name: '重试日志' }));
    await screen.findByText('恢复');
    expect(screen.getByText('开始')).toBeTruthy();
    expect(logQueries).toEqual([{ tail: 262144 }, { offset: 7 }, { offset: 7 }]);
    expect(screen.queryByText('日志加载失败')).toBeNull();
  });

  it('运行日志重建后替换旧内容并重置偏移', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    taskResponse = { ...task, status: 'running' };
    logResponse = () => ({ size: 1000000, offset: 999900, content: '旧日志尾部\n' });
    renderTask();
    await screen.findByText('旧日志尾部');
    logResponse = () => ({ size: 13, offset: 0, content: '重建日志\n', truncated: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByText('重建日志')).toBeTruthy();
    expect(screen.queryByText('旧日志尾部')).toBeNull();
    expect(screen.queryByText('日志较大，仅显示末尾部分')).toBeNull();
    logResponse = () => ({ size: 20, offset: 13, content: '继续\n' });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByText('继续')).toBeTruthy();
    expect(logQueries).toEqual([{ tail: 262144 }, { offset: 1000000 }, { offset: 13 }]);
  });

  it('从桌面工作台最近任务进入正确任务详情并读取日志', async () => {
    logResponse = (params) => params.tail
      ? { size: 18, offset: 0, content: '任务验收日志' }
      : { size: 18, offset: 18, content: '' };
    renderTask('/dashboard');
    fireEvent.click(await screen.findByRole('link', { name: /所属项目软件.*成功/ }));
    expect(await screen.findByText('任务验收日志')).toBeTruthy();
    expect(screen.getByText('所属项目打包任务')).toBeTruthy();
  });

  it('从版本关联任务进入该任务详情', async () => {
    renderTask('/release-packages');
    fireEvent.click(await screen.findByRole('button', { name: '查看任务' }));
    expect(await screen.findByText('暂无日志')).toBeTruthy();
    expect(screen.getByText('所属项目打包任务')).toBeTruthy();
    expect(logQueries[0]).toEqual({ tail: 262144 });
  });

  it('历史全局权限不会给维保看板增加配置、删除或任务写操作', async () => {
    taskResponse = { ...task, status: 'success',
      stage_info: { svn_push: { status: 'failure', error_message: 'SVN上传超时' } },
      artifact_info: [{ id: 'installer', name: '客户端.zip', path: '客户端.zip', size: 32, sha256: 'sha' }],
    };
    renderTask('/packages');
    await screen.findByText('打包看板', { selector: 'h1' });
    await screen.findAllByText('所属项目打包任务');
    expect(screen.queryByRole('button', { name: /新建打包配置|打包配置|删除任务/ })).toBeNull();
    expect(screen.queryByTitle('删除任务')).toBeNull();
    fireEvent.click(screen.getAllByText('所属项目打包任务')[0]);
    await screen.findByText('SVN上传超时');
    expect(screen.queryByRole('button', { name: /停止|删除|配置|新建打包|推送.*SVN/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /下载/ })).toBeNull();
    expect(screen.getAllByText('客户端.zip').length).toBeGreaterThan(0);
  });

  it('切换任务后，较晚返回的旧任务不会覆盖当前详情', async () => {
    let resolveOld!: (value: PackageTask) => void;
    delayedTask = new Promise((resolve) => { resolveOld = resolve; });
    renderTask();
    await screen.findByText('任务加载中…');
    fireEvent.click(screen.getByRole('link', { name: '切换到新任务' }));
    await screen.findByText('新选择任务');
    await act(async () => { resolveOld(task); });
    expect(screen.getByText('新选择任务')).toBeTruthy();
    expect(screen.queryByText('所属项目打包任务')).toBeNull();
  });

  it('排队时尚未生成日志和产物显示正常空态', async () => {
    taskResponse = { ...task, status: 'queued' };
    renderTask();
    expect(await screen.findByText('暂无日志')).toBeTruthy();
    expect(screen.getByText('暂无产物')).toBeTruthy();
    expect(screen.queryByText('日志加载失败')).toBeNull();
    expect(screen.queryByRole('button', { name: /停止构建|下载全部/ })).toBeNull();
  });

  it('单个产物、批量产物和完整日志下载失败都反馈原因且不保存伪文件', async () => {
    const notify = vi.fn();
    registerErrorNotifier(notify);
    taskResponse = { ...task, my_role: 'developer', artifact_info: [{ id: 'installer', name: '客户端.zip', path: '客户端.zip', size: 32, sha256: 'sha' }] };
    renderTask();
    await screen.findByRole('button', { name: '下载 客户端.zip' });
    for (const [button, message] of [
      ['下载 客户端.zip', '产物文件不存在或已清理'],
      ['下载全部', '没有可下载的有效产物文件'],
      ['下载完整日志', '日志未生成或已清理'],
    ]) {
      downloadFailureMessage = message;
      fireEvent.click(screen.getByRole('button', { name: button }));
      await waitFor(() => expect(notify).toHaveBeenCalledWith(message));
    }
    expect(downloadFiles).toEqual([]);
  });
});

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
}
