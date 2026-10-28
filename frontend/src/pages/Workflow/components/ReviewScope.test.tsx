import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { workflowApi } from '@/api/workflow';
import { ReviewScope } from './ReviewScope';

function show() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ReviewScope instanceId="round-one" />
  </QueryClientProvider>);
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('展示本轮固定范围与文档原文，代码按字面文本显示', async () => {
  vi.spyOn(workflowApi, 'getReviewScope').mockResolvedValue({ status: 'ready', base_tag: 'v1', base_git_hash: 'a'.repeat(40),
    head_git_hash: 'b'.repeat(40), warnings: ['存在未覆盖文件'], context: '已确认需求', documents: { 'docs/spec.md': '<script>alert(1)</script>\n尾部内容' } });
  const { container } = show();
  expect(await screen.findByText('v1')).toBeTruthy();
  expect(screen.getByText('a'.repeat(40))).toBeTruthy();
  expect(screen.getByText('b'.repeat(40))).toBeTruthy();
  expect(screen.getByText('已确认需求')).toBeTruthy();
  expect(screen.getByText('尾部内容', { exact: false }).textContent).toContain('<script>alert(1)</script>\n尾部内容');
  expect(container.querySelector('script')).toBeNull();
});

it('首次发布明确表示跳过，摘要无文档内容也可显示', async () => {
  vi.spyOn(workflowApi, 'getReviewScope').mockResolvedValue({ status: 'first_release', base_tag: '', base_git_hash: '', head_git_hash: 'b'.repeat(40), warnings: [] });
  show();
  expect(await screen.findByText('首次发布，跳过 AI 审查')).toBeTruthy();
  expect(screen.queryByText('补充审查说明')).toBeNull();
});

it('读取失败时给出重试，而不是伪装成没有审查范围', async () => {
  vi.spyOn(workflowApi, 'getReviewScope').mockRejectedValue({ status: 500, friendlyMessage: '服务暂不可用' });
  show();
  expect((await screen.findByRole('alert')).textContent).toContain('服务暂不可用');
  expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
});

it('仅在服务端返回时展示本轮真实需求标记', async () => {
  vi.spyOn(workflowApi, 'getReviewScope').mockResolvedValue({ status: 'ready', base_tag: 'v1', base_git_hash: 'a', head_git_hash: 'b', warnings: [], context_is_requirement: true });
  show();
  expect(await screen.findByText('本轮已标记包含真实需求依据')).toBeTruthy();
});
