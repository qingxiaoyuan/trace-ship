import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ApprovalTimeline } from './ApprovalTimeline';
import type { WorkflowInstance } from '@/types';

afterEach(cleanup);
it('尚未到达的节点展示提审时固定的审批人姓名', () => {
  const instance = {
    status: 'revoked', node_status: {}, tasks: [],
    graph_data: { nodes: [{ id: 'next', type: 'approval-node', text: '审核',
      properties: { mode: 'all', _approvers: [{ type: 'user', user_id: '1', user_name: '张三' }] } }], edges: [] },
  } as unknown as WorkflowInstance;
  render(<ApprovalTimeline instance={instance} />);
  expect(screen.getByText(/张三/)).toBeTruthy();
});
it('AI 节点完成表示审查完成，不表示已经人工批准', () => {
  const instance = {
    status: 'running', current_node_id: 'human', node_status: { ai: 'approved' }, tasks: [],
    graph_data: { nodes: [{ id: 'ai', type: 'ai-review-node', text: 'AI 代码审查' }], edges: [] },
  } as unknown as WorkflowInstance;
  render(<ApprovalTimeline instance={instance} />);
  expect(screen.getByText('AI 代码审查')).toBeTruthy();
  expect(screen.getByText('已完成')).toBeTruthy();
  expect(screen.queryByText('已通过')).toBeNull();
});

it('管理员跳过在流程图上保持独立状态', () => {
  const instance = {
    status: 'running', current_node_id: 'human', node_status: { ai: 'skipped' }, tasks: [],
    graph_data: { nodes: [{ id: 'ai', type: 'ai-review-node', text: 'AI 代码审查' }], edges: [] },
  } as unknown as WorkflowInstance;
  render(<ApprovalTimeline instance={instance} />);
  expect(screen.getByText('管理员跳过')).toBeTruthy();
  expect(screen.queryByText('已完成')).toBeNull();
});
