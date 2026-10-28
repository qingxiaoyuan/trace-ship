import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App, ConfigProvider } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import request from '@/api/request';
import { ApprovalDetailView } from './ApprovalDetailView';
import type { DetailSource } from '../types';

const originalAdapter = request.defaults.adapter;
let canRevoke = true;
let status = 'running';
const posts: string[] = [];
let historyRequests = 0;
const source: DetailSource = {
  instanceId: 'instance', title: '发布审批', applicant: '发起人', projectName: '项目', softwareName: '软件',
  submitTime: '', currentNode: '第二轮审批', readOnly: true,
};

beforeEach(() => {
  canRevoke = true;
  status = 'running';
  posts.length = 0;
  historyRequests = 0;
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener() {}, removeListener() {} });
  request.defaults.adapter = async (config) => {
    if (config.url === '/workflow/instances/' && config.method === 'get') {
      historyRequests += 1;
      return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: { total: 0, results: [] } } };
    }
    if (config.method === 'post') {
      posts.push(config.url!);
      status = 'revoked';
      canRevoke = false;
    }
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: {
      id: 'instance', biz_type: 'release', biz_id: 'release', status, can_revoke: canRevoke,
      title: '发布审批', current_node_id: 'second', graph_data: { nodes: [], edges: [] },
      tasks: [{ id: 'first-task', status: 'approved', comment: '首轮确认', can_act: false }],
    } } };
  };
});
afterEach(() => { cleanup(); request.defaults.adapter = originalAdapter; vi.unstubAllGlobals(); });

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ConfigProvider theme={{ token: { motion: false } }}><App>
    <MemoryRouter><ApprovalDetailView source={source} onBack={() => {}} /></MemoryRouter>
  </App></ConfigProvider></QueryClientProvider>);
  return client;
}

it('我发起的详情没有审批待办时仍能终止后续节点流程，保留审批历史并刷新状态', async () => {
  const client = renderDetail();
  await screen.findByText('首轮确认');
  expect(screen.queryByRole('button', { name: '通过' })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: '终止流程' }));
  expect(await screen.findByText(/发布申请恢复为草稿/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '确认终止' }));
  await waitFor(() => expect(posts).toEqual(['/workflow/instances/instance/revoke/']));
  await screen.findByText('已终止');
  expect(screen.getByText('首轮确认')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '终止流程' })).toBeNull();
  expect(client.getQueryData(['workflow-instance-for-detail', 'instance'])).toMatchObject({ status: 'revoked', can_revoke: false });
  await waitFor(() => expect(historyRequests).toBeGreaterThanOrEqual(2));
});

it('非发起人或维保等服务端未授权的运行实例不展示终止入口', async () => {
  canRevoke = false;
  renderDetail();
  await screen.findByText('首轮确认');
  expect(screen.queryByRole('button', { name: '终止流程' })).toBeNull();
  expect(posts).toEqual([]);
});

it('已经结束的流程不展示终止入口', async () => {
  status = 'completed';
  renderDetail();
  await screen.findByText('首轮确认');
  expect(screen.queryByRole('button', { name: '终止流程' })).toBeNull();
});
