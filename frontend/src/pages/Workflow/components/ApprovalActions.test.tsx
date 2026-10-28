import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { App, ConfigProvider } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApprovalActions } from './ApprovalActions';
import type { WorkflowInstance } from '@/types';
import type { DetailSource } from '../types';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('上一个节点是 AI 时不展示回退，以免重复进入已完成的审查', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener() {}, removeListener() {} });
  const instance = { status: 'running', current_node_id: 'human-2', tasks: [{ id: 'task', can_act: true }],
    graph_data: { nodes: [
      { id: 'human-1', type: 'approval-node' }, { id: 'ai', type: 'ai-review-node' }, { id: 'human-2', type: 'approval-node' },
    ], edges: [] },
  } as unknown as WorkflowInstance;
  const source = { instanceId: 'instance', taskId: 'task', readOnly: false } as DetailSource;
  render(<QueryClientProvider client={new QueryClient()}><ConfigProvider><App>
    <ApprovalActions instance={instance} source={source} onBack={() => {}} />
  </App></ConfigProvider></QueryClientProvider>);
  expect(screen.getByRole('button', { name: '通过' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '回退' })).toBeNull();
});

it('首个人工节点可以退回修改，并发送当前审批意见', async () => {
  const { fireEvent, waitFor } = await import('@testing-library/react');
  const { workflowApi } = await import('@/api/workflow');
  const returned = vi.spyOn(workflowApi, 'returnForRevision').mockResolvedValue({} as never);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener() {}, removeListener() {} });
  const instance = { status: 'running', biz_type: 'release', current_node_id: 'human-1', tasks: [{ id: 'task', can_act: true, can_return_for_revision: true }],
    graph_data: { nodes: [{ id: 'human-1', type: 'approval-node' }], edges: [] },
  } as unknown as WorkflowInstance;
  const source = { instanceId: 'instance', taskId: 'task', readOnly: false } as DetailSource;
  render(<QueryClientProvider client={new QueryClient()}><ConfigProvider><App>
    <ApprovalActions instance={instance} source={source} onBack={() => {}} />
  </App></ConfigProvider></QueryClientProvider>);
  fireEvent.change(screen.getByPlaceholderText('请输入审批意见…'), { target: { value: '请修复权限' } });
  fireEvent.click(screen.getByRole('button', { name: '退回修改' }));
  fireEvent.click(screen.getByRole('button', { name: '确认退回修改' }));
  await waitFor(() => expect(returned).toHaveBeenCalledWith('task', { comment: '请修复权限' }));
  returned.mockRestore();
});
