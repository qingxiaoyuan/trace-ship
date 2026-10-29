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

it('审批仅提供通过、驳回与转交，驳回发送当前意见', async () => {
  const { fireEvent, waitFor } = await import('@testing-library/react');
  const { workflowApi } = await import('@/api/workflow');
  const rejected = vi.spyOn(workflowApi, 'rejectTask').mockResolvedValue({} as never);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener() {}, removeListener() {} });
  const instance = { status: 'running', current_node_id: 'human-2', tasks: [{ id: 'task', can_act: true, can_return_for_revision: true }],
    graph_data: { nodes: [{ id: 'human-1', type: 'approval-node' }, { id: 'human-2', type: 'approval-node' }], edges: [] },
  } as unknown as WorkflowInstance;
  render(<QueryClientProvider client={new QueryClient()}><ConfigProvider><App>
    <ApprovalActions instance={instance} source={{ taskId: 'task', readOnly: false } as DetailSource} onBack={() => {}} />
  </App></ConfigProvider></QueryClientProvider>);
  expect(screen.queryByRole('button', { name: '退回修改' })).toBeNull();
  expect(screen.queryByRole('button', { name: '回退' })).toBeNull();
  fireEvent.change(screen.getByPlaceholderText('请输入审批意见…'), { target: { value: '请修复权限后新建发布' } });
  fireEvent.click(screen.getByRole('button', { name: '驳回' }));
  await waitFor(() => expect(rejected).toHaveBeenCalledWith('task', { comment: '请修复权限后新建发布' }));
  rejected.mockRestore();
});

it('时间线保留多人的处理结果及意见原文，隐藏待办并按处理时间倒序', () => {
  const instance = { status: 'completed', tasks: [
    { id: 'first', status: 'approved', approver_name: '技术负责人', action_time: '2026-10-29T10:00:00Z', comment: '同意发布\n请关注运行结果' },
    { id: 'transfer', status: 'transferred', approver_name: '原审批人', action_time: '2026-10-29T09:00:00Z', comment: '' },
    { id: 'return', status: 'returned', approver_name: '原任务人', action_time: '2026-10-29T08:00:00Z', comment: '补充说明' },
    { id: 'pending', status: 'pending', approver_name: '等待处理人员' },
  ], returned_by_name: '实际退回人' } as unknown as WorkflowInstance;
  render(<QueryClientProvider client={new QueryClient()}><ConfigProvider><App>
    <ApprovalActions instance={instance} source={{ readOnly: true } as DetailSource} onBack={() => {}} />
  </App></ConfigProvider></QueryClientProvider>);
  const items = screen.getAllByRole('listitem');
  expect(items).toHaveLength(3);
  expect(items[0].textContent).toContain('技术负责人');
  expect(items[1].textContent).toContain('已转交');
  expect(items[2].textContent).toContain('实际退回人');
  expect(screen.queryByText('等待处理人员')).toBeNull();
  expect(items[0].querySelector('p')?.textContent).toBe('同意发布\n请关注运行结果');
  expect(items[1].querySelector('p')).toBeNull();
  expect(items[0].querySelector('time')?.dateTime).toBe('2026-10-29T10:00:00Z');
});
