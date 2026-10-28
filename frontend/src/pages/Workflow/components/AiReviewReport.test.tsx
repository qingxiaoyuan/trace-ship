import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { workflowApi } from '@/api/workflow';
import { AiReviewReport } from './AiReviewReport';
import { useAuthStore } from '@/stores/authStore';

function show() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AiReviewReport instanceId="round-one" />
  </QueryClientProvider>);
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); useAuthStore.getState().clearAuth(); });

it('展示完整报告、覆盖和意见并安全呈现模型文本', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [{ node_id: 'ai-1', status: 'completed',
    summary: '已完成审查', dimensions: ['安全'], coverage: { total_files: 2, reviewed_files: 2, warnings: [] },
    findings: [{ severity: 'P1', title: '错误处理', reason: '<script>alert(1)</script>尾部', suggestion: '检查返回值', path: 'src/a.ts', side: 'new', line_start: 2, line_end: 3 }] }] });
  const { container } = show();
  expect(await screen.findByText('已完成审查')).toBeTruthy();
  expect(screen.getByText('覆盖范围：2 / 2 个文件')).toBeTruthy();
  expect(screen.getByText('P1')).toBeTruthy();
  expect(screen.getByText(/尾部/).textContent).toContain('<script>alert(1)</script>尾部');
  expect(container.querySelector('script')).toBeNull();
  expect(screen.getByText('src/a.ts · 新侧 2–3 行')).toBeTruthy();
});

it('摘要权限不显示完整报告，首发跳过与失败分别展示', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [
    { node_id: 'first', node_name: '首次审查', status: 'first_release', summary: '首次发布', coverage: { total_files: 0, reviewed_files: 0, warnings: [] } },
    { node_id: 'failed', status: 'failed', summary: '模型服务不可用', coverage: { total_files: 2, reviewed_files: 0, warnings: ['尚未审查'] } },
  ] });
  show();
  expect(await screen.findByText('首次审查 · 首次发布，跳过 AI 审查')).toBeTruthy();
  expect(screen.getByText('审查失败')).toBeTruthy();
  expect(screen.getByText('尚未审查')).toBeTruthy();
  expect(screen.queryByText('审查意见')).toBeNull();
  expect(screen.queryByText('已审查文件')).toBeNull();
  expect(screen.queryByText('未审查文件')).toBeNull();
});

it('读取失败提供重试，不伪装成无报告', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockRejectedValue({ status: 500, friendlyMessage: '服务不可用' });
  show();
  expect((await screen.findByRole('alert')).textContent).toContain('服务不可用');
  expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
});

it('审查运行时自动刷新并展示新结果', async () => {
  const coverage = { total_files: 1, reviewed_files: 0, warnings: [] };
  vi.spyOn(workflowApi, 'getAiReview')
    .mockResolvedValueOnce({ reviews: [{ node_id: 'ai', status: 'running', summary: '审查中', coverage }] })
    .mockResolvedValueOnce({ reviews: [{ node_id: 'ai', status: 'completed', summary: '审查已更新', coverage: { ...coverage, reviewed_files: 1 }, findings: [] }] });
  show();
  expect(await screen.findByText('正在审查')).toBeTruthy();
  expect(await screen.findByText('审查已更新', {}, { timeout: 5000 })).toBeTruthy();
  expect(screen.getByText('未报告意见，仍需人工判断。')).toBeTruthy();
});

it('排队时尚无覆盖统计也能显示状态', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [{ node_id: 'ai', status: 'queued', summary: '', coverage: {} }] });
  show();
  expect(await screen.findByText('等待审查')).toBeTruthy();
  expect(screen.getByText('覆盖范围：尚未统计')).toBeTruthy();
});

it('第一个 AI 节点完成时即使后续 AI 仍排队也刷新流程', async () => {
  const coverage = { total_files: 1, reviewed_files: 0, warnings: [] };
  vi.spyOn(workflowApi, 'getAiReview')
    .mockResolvedValueOnce({ reviews: [{ node_id: 'ai-1', status: 'running', summary: '', coverage }, { node_id: 'ai-2', status: 'queued', summary: '', coverage }] })
    .mockResolvedValueOnce({ reviews: [{ node_id: 'ai-1', status: 'completed', summary: '首个审查完成', coverage }, { node_id: 'ai-2', status: 'queued', summary: '', coverage }] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(<QueryClientProvider client={client}><AiReviewReport instanceId="round-one" /></QueryClientProvider>);
  expect(await screen.findByText('正在审查')).toBeTruthy();
  expect(await screen.findByText('首个审查完成', {}, { timeout: 5000 })).toBeTruthy();
  expect(screen.getByText('等待审查')).toBeTruthy();
  expect(invalidate).toHaveBeenCalledTimes(2);
  expect(invalidate).toHaveBeenLastCalledWith({ queryKey: ['workflow-instance-for-detail', 'round-one'] });
});

it('完整权限展示已审查和未审查文件，摘要权限不显示文件清单', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [{ node_id: 'ai', status: 'incomplete', summary: '覆盖未完成',
    coverage: { total_files: 2, reviewed_files: 1, warnings: ['存在未覆盖文件'], reviewed_paths: ['src/checked.ts'], unreviewed_paths: ['src/missing.ts'] } }] });
  show();
  expect(await screen.findByText('src/checked.ts')).toBeTruthy();
  expect(screen.getByText('src/missing.ts')).toBeTruthy();
  expect(screen.getByText('已审查文件')).toBeTruthy();
  expect(screen.getByText('未审查文件')).toBeTruthy();
});

it('审查正文保留 Markdown 语义并过滤危险 HTML 和链接', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [{ node_id: 'ai', status: 'completed', summary: '', coverage: {},
    findings: [{ severity: 'P1', title: '问题', reason: '**重要** [文档](https://example.com) [危险](javascript:alert(1)) `<br>` <script>alert(1)</script>', suggestion: '核对配置' }] }] });
  const { container } = show();
  expect((await screen.findByText('重要')).tagName.toLowerCase()).toBe('strong');
  expect(screen.getByRole('link', { name: '文档' }).getAttribute('href')).toBe('https://example.com');
  expect(screen.getByText('危险').getAttribute('href')).not.toMatch(/^javascript:/);
  expect(screen.getByText('<br>').tagName.toLowerCase()).toBe('code');
  expect(container.querySelector('script')).toBeNull();
});

it('会话切换或权限收回后不会复用完整报告', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValueOnce({ reviews: [{ node_id: 'ai', status: 'completed',
    summary: '原账号私有报告', coverage: {}, findings: [] }] }).mockRejectedValue({ status: 404 });
  show();
  expect(await screen.findByText('原账号私有报告')).toBeTruthy();
  act(() => useAuthStore.getState().setTokens('another-account-token'));
  expect(screen.queryByText('原账号私有报告')).toBeNull();
  await waitFor(() => expect(screen.queryByLabelText('AI 代码审查')).toBeNull());
});
