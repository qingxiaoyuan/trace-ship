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
