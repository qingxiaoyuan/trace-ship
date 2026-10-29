import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import request from '@/api/request';
import { ApprovalListView } from './ApprovalListView';

const adapter = request.defaults.adapter;
afterEach(() => { cleanup(); request.defaults.adapter = adapter; });

function show() {
  request.defaults.adapter = async config => {
    const common = { project_name: '项目', repository_name: '软件', applicant: '发起人', submit_time: '2026-10-29T10:00:00Z' };
    const rows = config.url?.includes('/initiated/') ? [
      { ...common, id: 'completed', title: '完成申请', status: 'completed', current_node: '旧的审批节点' },
      { ...common, id: 'running', title: '进行中的申请', status: 'running', current_node: '技术负责人审批' },
      { ...common, id: 'revoked', title: '终止申请', status: 'revoked', current_node: '旧的审批节点' },
      { ...common, id: 'rejected', title: '驳回申请', status: 'rejected', current_node: '旧的审批节点' },
      { ...common, id: 'returned', title: '退回申请', status: 'returned', current_node: '旧的审批节点' },
    ] : config.url?.includes('/done/') ? [
      { ...common, id: 'approved', instance: 'running', title: '已处理的任务', status: 'approved', current_node: '我的审批节点' },
    ] : [{ ...common, id: 'pending', instance: 'active', title: '等待处理的任务', status: 'pending', current_node: '待办审批节点' }];
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: { results: rows, total: rows.length } } };
  };
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ApprovalListView onOpenDetail={vi.fn()} /></QueryClientProvider>);
}

it('我发起的按实际流程状态显示，终态不继续显示旧节点', async () => {
  show();
  fireEvent.click(screen.getByRole('button', { name: '我发起的' }));
  await screen.findAllByText('完成申请');
  expect(screen.getAllByText('已完成')).toHaveLength(2);
  expect(screen.getAllByText('审批中')).toHaveLength(2);
  expect(screen.getAllByText('已驳回')).toHaveLength(2);
  expect(screen.getAllByText('已终止')).toHaveLength(2);
  expect(screen.getAllByText('已退回修改')).toHaveLength(2);
  expect(screen.queryByText('旧的审批节点')).toBeNull();
  expect(screen.getAllByText('技术负责人审批')).toHaveLength(2);
});

it('我的已办显示本人的处理结果，不将已通过任务说成整个流程完成', async () => {
  show();
  fireEvent.click(screen.getByRole('button', { name: '我的已办' }));
  await screen.findAllByText('已处理的任务');
  expect(screen.getAllByText('已通过')).toHaveLength(2);
  expect(screen.queryByText('已完成')).toBeNull();
  expect(screen.getAllByText('我的审批节点')).toHaveLength(2);
});


it('待我审批明确显示待审批任务状态', async () => {
  show();
  await screen.findAllByText('等待处理的任务');
  expect(screen.getAllByText('待审批')).toHaveLength(2);
  expect(screen.getAllByText('待办审批节点')).toHaveLength(2);
});
