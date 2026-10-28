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
