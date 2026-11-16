import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import { AxiosError } from 'axios';
import request from '@/api/request';
import { TaskSvnArtifacts } from './TaskSvnArtifacts';

const originalAdapter = request.defaults.adapter;
const requests: string[] = [];
const file = {
  artifact_id: 'artifact', path: '目录 空格/安装包.zip', name: '安装包.zip', url: 'svn://test/task/installer.zip',
  source: 'artifact_manifest', state: 'available', message: '当前文件存在，内容可能已被覆盖',
  local_available: false, original: { size: 3, sha256: 'original-sha', revision: null },
  current: { kind: 'file', size: 15, revision: '2' },
};

beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
  request.defaults.adapter = async (config) => {
    requests.push(config.url || '');
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: {
      task_id: 'task', root_url: 'svn://test/task', mode: 'manifest', path: '', entries: [file],
    } } };
  };
});

afterEach(() => { cleanup(); request.defaults.adapter = originalAdapter; vi.unstubAllGlobals(); });

function renderFiles() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ConfigProvider theme={{ token: { motion: false } }}>
    <TaskSvnArtifacts taskId="task" taskName="历史任务" />
  </ConfigProvider></QueryClientProvider>);
}

it('成员主动打开后分别查看原构建依据和当前 SVN 文件，不展示下载或发送操作', async () => {
  renderFiles();
  expect(requests).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: '查看 SVN 文件' }));
  const dialog = await screen.findByRole('dialog');
  expect(await within(dialog).findByText('目录 空格/安装包.zip')).toBeTruthy();
  expect(within(dialog).getByText('原构建依据')).toBeTruthy();
  expect(within(dialog).getByText('当前 SVN 文件')).toBeTruthy();
  expect(within(dialog).getByText('3 B')).toBeTruthy();
  expect(within(dialog).getByText('15 B')).toBeTruthy();
  expect(within(dialog).getByText('original-sha')).toBeTruthy();
  expect(within(dialog).getByText('本地文件已清理或不可用')).toBeTruthy();
  expect(within(dialog).queryByRole('button', { name: /下载|发送|归档/ })).toBeNull();
  expect(requests).toEqual(['/packages/tasks/task/svn-artifacts/']);
});

it('缺清单时在任务目录内导航，子目录文件明确标为从 SVN 补录', async () => {
  const paths: string[] = [];
  request.defaults.adapter = async (config) => {
    const path = config.params?.path || '';
    paths.push(path);
    const entries = path ? [{ ...file, source: 'svn_supplement', original: { size: null, sha256: null, revision: null } }] : [{
      ...file, path: '目录 空格', name: '目录 空格', source: 'svn_supplement', state: 'directory', current: { kind: 'dir', size: null, revision: '2' },
    }];
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: {
      task_id: 'task', root_url: 'svn://test/task', mode: 'browse', path, entries,
    } } };
  };
  renderFiles();
  fireEvent.click(screen.getByRole('button', { name: '查看 SVN 文件' }));
  fireEvent.click(await screen.findByRole('button', { name: '打开目录 目录 空格' }));
  expect(await screen.findByText('目录 空格/安装包.zip')).toBeTruthy();
  expect(screen.getByText('从 SVN 补录')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '返回上级目录' }));
  expect(await screen.findByRole('button', { name: '打开目录 目录 空格' })).toBeTruthy();
  expect(paths).toEqual(['', '目录 空格', '']);
});


it('查询失败显示明确原因，重新核验后恢复清单', async () => {
  let unavailable = true;
  const successAdapter = request.defaults.adapter as (config: import('axios').InternalAxiosRequestConfig) => Promise<import('axios').AxiosResponse>;
  request.defaults.adapter = async (config) => {
    if (unavailable) throw new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, undefined, {
      config, status: 502, statusText: 'Bad Gateway', headers: {},
      data: { code: 50200, message: 'SVN 凭证无权访问该路径，无法核验', data: { state: 'forbidden' } },
    });
    return successAdapter(config);
  };
  renderFiles();
  fireEvent.click(screen.getByRole('button', { name: '查看 SVN 文件' }));
  expect(await screen.findByText('SVN 凭证无权访问该路径，无法核验')).toBeTruthy();
  expect(screen.queryByText('目录 空格/安装包.zip')).toBeNull();
  unavailable = false;
  fireEvent.click(screen.getByRole('button', { name: '重新核验' }));
  expect(await screen.findByText('目录 空格/安装包.zip')).toBeTruthy();
});
