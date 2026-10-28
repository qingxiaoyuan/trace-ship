import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { workflowApi } from '@/api/workflow';
import { useAuthStore } from '@/stores/authStore';
import { RemediationPanel } from './RemediationPanel';

const finding = { id: 'finding-1', severity: 'P1', title: '缺少校验', reason: '**参数**未校验', suggestion: '添加校验', path: 'app.py', side: 'new' as const, line_start: 2, line_end: 2 };
const reviews = [{ node_id: 'ai', status: 'completed' as const, summary: '', coverage: {}, findings: [finding] }];
function show() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><RemediationPanel instanceId="round-1" reviews={reviews} /></MemoryRouter>
  </QueryClientProvider>);
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); useAuthStore.getState().clearAuth(); });

it('审批人采纳意见后刷新整改状态，不把采纳显示为已处理', async () => {
  vi.spyOn(workflowApi, 'getRemediations').mockResolvedValueOnce({ items: [], can_adopt: true })
    .mockResolvedValue({ items: [{ id: 'item-1', instance_id: 'round-1', node_id: 'ai', finding_id: 'finding-1', finding, status: 'pending_fix', fix_note: '', history: [], can_fix: true, can_review: false }], can_adopt: true });
  const act = vi.spyOn(workflowApi, 'actOnRemediation').mockResolvedValue({ item: {} as never });
  show();
  fireEvent.click(await screen.findByRole('button', { name: '采纳：缺少校验' }));
  await waitFor(() => expect(act).toHaveBeenCalledWith('round-1', { action: 'adopt', node_id: 'ai', finding_id: 'finding-1' }));
  expect(await screen.findByText('已采纳，待修复')).toBeTruthy();
  expect(screen.queryByText('已处理')).toBeNull();
});

it('开发者提交修复说明后可重新读取，审批人复核前保持待处理', async () => {
  const item = { id: 'item-1', instance_id: 'round-old', node_id: 'ai', finding_id: 'finding-1', finding,
    status: 'pending_fix' as const, fix_note: '', history: [], can_fix: true, can_review: false };
  vi.spyOn(workflowApi, 'getRemediations').mockResolvedValueOnce({ items: [item], can_adopt: false })
    .mockResolvedValue({ items: [{ ...item, status: 'pending_review', fix_note: '  保留缩进\n修复尾部  ' }], can_adopt: false });
  const act = vi.spyOn(workflowApi, 'actOnRemediation').mockResolvedValue({ item });
  show();
  const textarea = await screen.findByLabelText('修复说明');
  const button = screen.getByRole('button', { name: '提交修复说明' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.change(textarea, { target: { value: '  保留缩进\n修复尾部  ' } });
  fireEvent.click(button);
  await waitFor(() => expect(act).toHaveBeenCalledWith('round-1', { action: 'fix', id: 'item-1', comment: '  保留缩进\n修复尾部  ' }));
  expect(await screen.findByText('已提交修复说明，待复核')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'round-old' }).getAttribute('href')).toBe('/workflows/round-old');
  expect(screen.getByText(/修复说明：/).textContent).toBe('修复说明：  保留缩进\n修复尾部  ');
  expect(screen.queryByRole('button', { name: '确认已处理' })).toBeNull();
});

it('审批人确认处理或填写理由不采纳，失败时显示真实错误', async () => {
  const item = { id: 'item-1', instance_id: 'round-old', node_id: 'ai', finding_id: 'finding-1', finding,
    status: 'pending_review' as const, fix_note: '已修复', history: [{ action: 'adopt' as const, actor_name: '审批人', at: '2026-10-28', comment: '' }], can_fix: false, can_review: true };
  vi.spyOn(workflowApi, 'getRemediations').mockResolvedValue({ items: [item], can_adopt: false });
  const act = vi.spyOn(workflowApi, 'actOnRemediation').mockRejectedValueOnce({ friendlyMessage: '状态已变更，请刷新' }).mockResolvedValue({ item });
  show();
  fireEvent.click(await screen.findByRole('button', { name: '确认已处理' }));
  expect((await screen.findByRole('alert')).textContent).toContain('状态已变更');
  expect(act).toHaveBeenCalledWith('round-1', { action: 'resolve', id: 'item-1', comment: '' });
  fireEvent.click(screen.getByRole('button', { name: '改为不采纳' }));
  const submit = screen.getByRole('button', { name: '确认不采纳' }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('不采纳理由'), { target: { value: '误报，已有保护' } });
  fireEvent.click(submit);
  await waitFor(() => expect(act).toHaveBeenCalledWith('round-1', { action: 'dismiss', id: 'item-1', comment: '误报，已有保护' }));
  expect(screen.getByText('处置历史')).toBeTruthy();
  expect(screen.getByText(/采纳 · 审批人/)).toBeTruthy();
});

it('安全展示原意见，保留 Markdown 语义并过滤危险链接', async () => {
  const risky = { ...finding, reason: '**重要** [安全](https://example.com) [危险](javascript:alert(1)) `<br>` <script>alert(1)</script>' };
  vi.spyOn(workflowApi, 'getRemediations').mockResolvedValue({ items: [{ id: 'x', instance_id: 'old', node_id: 'ai', finding_id: 'finding-1', finding: risky,
    status: 'pending_fix', fix_note: '', history: [], can_fix: false, can_review: false }], can_adopt: false });
  const { container } = show();
  expect((await screen.findByText('重要')).tagName.toLowerCase()).toBe('strong');
  expect(screen.getByRole('link', { name: '安全' }).getAttribute('href')).toBe('https://example.com');
  expect(screen.getByText('危险').getAttribute('href')).not.toMatch(/^javascript:/);
  expect(screen.getByText('<br>').tagName.toLowerCase()).toBe('code');
  expect(container.querySelector('script')).toBeNull();
});

it('权限收回或切换账号后不保留整改内容及未提交表单', async () => {
  const item = { id: 'item-1', instance_id: 'old', node_id: 'ai', finding_id: 'finding-1', finding,
    status: 'pending_fix' as const, fix_note: '', history: [], can_fix: true, can_review: false };
  vi.spyOn(workflowApi, 'getRemediations').mockResolvedValueOnce({ items: [item], can_adopt: false }).mockRejectedValue({ status: 403 });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><RemediationPanel instanceId="round-1" reviews={reviews} /></MemoryRouter></QueryClientProvider>);
  fireEvent.change(await screen.findByLabelText('修复说明'), { target: { value: '私有未提交内容' } });
  await client.invalidateQueries({ queryKey: ['review-remediations', 'round-1'] });
  await waitFor(() => expect(screen.queryByLabelText('代码审查整改')).toBeNull());
  useAuthStore.getState().clearAuth();
  expect(screen.queryByDisplayValue('私有未提交内容')).toBeNull();
});

it('当前轮可采纳历史执行独有意见，已采纳的稳定 ID 不重复显示', async () => {
  const old = { ...finding, id: 'old-finding', title: '旧执行意见' };
  const already = { id: 'item-1', instance_id: 'round-1', node_id: 'ai', finding_id: 'finding-1', finding,
    status: 'pending_fix' as const, fix_note: '', history: [], can_fix: false, can_review: false };
  vi.spyOn(workflowApi, 'getRemediations').mockResolvedValue({ items: [already], can_adopt: true });
  const act = vi.spyOn(workflowApi, 'actOnRemediation').mockResolvedValue({ item: already });
  const olderReviews = [{ node_id: 'ai', status: 'completed' as const, summary: '', coverage: {}, findings: [finding],
    history: [{ token: 'attempt', status: 'incomplete', summary: '', updated_at: '2026-10-28', findings: [old, finding] }] }];
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><RemediationPanel instanceId="round-1" reviews={olderReviews} /></MemoryRouter>
  </QueryClientProvider>);
  expect(await screen.findByText('已采纳，待修复')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '采纳：缺少校验' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '采纳：旧执行意见' }));
  await waitFor(() => expect(act).toHaveBeenCalledWith('round-1', { action: 'adopt', node_id: 'ai', finding_id: 'old-finding' }));
});
