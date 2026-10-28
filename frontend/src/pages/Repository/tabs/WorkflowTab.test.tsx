import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { workflowApi } from '@/api/workflow';
import { accountApi } from '@/api/account';
import type { Repository, WorkflowDefinition } from '@/types';
import { WorkflowTab } from './WorkflowTab';

const errorMessage = vi.fn();
vi.mock('@/hooks/useAppMessage', () => ({ useAppMessage: () => ({ message: { error: errorMessage, info: vi.fn(), success: vi.fn() } }) }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (selector: (state: unknown) => unknown) => selector({ user: { id: 'owner', is_superuser: false } }) }));
vi.mock('@/components/TsModal', () => ({ TsModal: ({ open, children, footer }: { open: boolean; children: ReactNode; footer: ReactNode }) => open ? <div role="dialog">{children}{footer}</div> : null }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); errorMessage.mockClear(); });

it('AI 节点后必须有人工作为审批，合法时保存两个不同节点', async () => {
  const definition = { id: 'flow', name: 'RC 审批', release_type: 'rc', node_config: [], graph_data: { nodes: [], edges: [] } } as unknown as WorkflowDefinition;
  vi.spyOn(workflowApi, 'getDefinitions').mockResolvedValue({ results: [definition], total: 1, page: 1, page_size: 1000 });
  vi.spyOn(accountApi, 'getUsers').mockResolvedValue({ results: [], total: 0, page: 1, page_size: 1000 });
  const save = vi.spyOn(workflowApi, 'updateDefinition').mockImplementation(async (_, data) => ({ ...definition, ...data }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <WorkflowTab repository={{ id: 'repo', created_by: 'owner' } as Repository} />
  </QueryClientProvider>);
  fireEvent.click(await screen.findByText('编辑节点'));
  fireEvent.click(screen.getByRole('button', { name: '添加 AI 审查节点' }));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(errorMessage).toHaveBeenCalledWith('AI 审查节点后必须有人工审批节点');
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '添加节点' }));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  const nodes = save.mock.calls[0][1].node_config!;
  expect(nodes[0].node_type).toBe('ai_review');
  expect(nodes[0].approvers).toEqual([]);
  expect(nodes[1].node_type || 'approval').toBe('approval');
});
