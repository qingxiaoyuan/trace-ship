import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { workflowApi } from '@/api/workflow';
import { ReviewDiff } from './ReviewDiff';
import { useAuthStore } from '@/stores/authStore';

const reviews = [{ node_id: 'ai', node_name: '安全审查', status: 'completed' as const, summary: '', coverage: {}, findings: [
  { id: 'f1', severity: 'P1', title: '旧侧意见', reason: '**旧问题**', suggestion: '修复', path: 'old.py', side: 'old' as const, line_start: 10, line_end: 10 },
  { id: 'f2', severity: 'P2', title: '新侧意见', reason: '新问题', suggestion: '检查', path: 'new.py', side: 'new' as const, line_start: 20, line_end: 20 },
  { id: 'f3', severity: 'P3', title: '无法定位', reason: '文件问题', suggestion: '检查', path: 'new.py' },
] }];

afterEach(() => { cleanup(); vi.restoreAllMocks(); useAuthStore.getState().clearAuth(); });

it('展示固定重命名差异、旧新行号和相邻意见，保留源码字面值', async () => {
  vi.spyOn(workflowApi, 'getReviewDiff').mockResolvedValue({ status: 'ready', base_git_hash: 'a'.repeat(40), head_git_hash: 'b'.repeat(40), diffs: [{
    old_path: 'old.py', new_path: 'new.py', renamed_file: true, new_file: false, deleted_file: false,
    diff: '@@ -10,2 +20,2 @@\n-<script>alert(1)</script>\n+new value\n same tail',
  }] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(<QueryClientProvider client={client}><ReviewDiff instanceId="round-one" reviews={reviews} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: '查看代码差异' }));
  const file = await screen.findByRole('article', { name: 'old.py → new.py' });
  fireEvent.click(within(file).getByRole('button', { name: '展开代码差异' }));
  expect(within(file).getByText('重命名')).toBeTruthy();
  expect(within(file).getByText('<script>alert(1)</script>')).toBeTruthy();
  expect(container.querySelector('script')).toBeNull();
  expect(within(file).getByLabelText('旧侧第 10 行')).toBeTruthy();
  expect(within(file).getByLabelText('新侧第 20 行')).toBeTruthy();
  expect(within(file).getByText('旧侧意见').closest('[data-line-side="old"]')).toBeTruthy();
  expect(within(file).getByText('新侧意见').closest('[data-line-side="new"]')).toBeTruthy();
  expect(within(file).getByText('无法定位')).toBeTruthy();
  expect(within(file).getByText('旧问题').tagName.toLowerCase()).toBe('strong');
});

it('新增、删除、整体意见和无法可靠定位的行均可见，并过滤危险链接', async () => {
  vi.spyOn(workflowApi, 'getReviewDiff').mockResolvedValue({ status: 'incomplete', base_git_hash: 'a', head_git_hash: 'b', diffs: [
    { old_path: 'added.py', new_path: 'added.py', new_file: true, diff: '@@ -0,0 +1,1 @@\n+新增末尾' },
    { old_path: 'deleted.py', new_path: 'deleted.py', deleted_file: true, diff: '@@ -3,1 +0,0 @@\n-删除内容' },
  ] });
  const cases = [{ node_id: 'ai', status: 'completed' as const, summary: '', coverage: {}, findings: [
    { severity: 'P1', title: '新增问题', reason: '请看 [安全文档](https://example.com) 与 [危险](javascript:alert(1))', suggestion: '<script>alert(9)</script>', path: 'added.py', side: 'new' as const, line_start: 1, line_end: 1 },
    { severity: 'P2', title: '删除问题', reason: '旧内容', suggestion: '修复', path: 'deleted.py', side: 'old' as const, line_start: 3, line_end: 3 },
    { severity: 'P3', title: '行不可定位', reason: '仍保留', suggestion: '核对', path: 'added.py', side: 'new' as const, line_start: 99, line_end: 99 },
    { severity: 'P2', title: '整体问题', reason: '整体原因', suggestion: '检查' },
  ] }];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(<QueryClientProvider client={client}><ReviewDiff instanceId="round" reviews={cases} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: '查看代码差异' }));
  const added = await screen.findByRole('article', { name: 'added.py' });
  const deleted = screen.getByRole('article', { name: 'deleted.py' });
  fireEvent.click(within(added).getByRole('button', { name: '展开代码差异' }));
  fireEvent.click(within(deleted).getByRole('button', { name: '展开代码差异' }));
  expect(within(added).getByText('新增文件')).toBeTruthy();
  expect(within(deleted).getByText('删除文件')).toBeTruthy();
  expect(within(added).getByText('新增末尾')).toBeTruthy();
  expect(within(deleted).getByText('删除内容')).toBeTruthy();
  expect(within(added).getByText('行不可定位')).toBeTruthy();
  expect(screen.getByText('整体问题')).toBeTruthy();
  expect(screen.getByText(/本轮差异未完整取得/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '安全文档' }).getAttribute('href')).toBe('https://example.com');
  expect(screen.getByText('危险').getAttribute('href')).not.toMatch(/^javascript:/);
  expect(container.querySelector('script')).toBeNull();
});

it('摘要角色不请求代码差异，切换轮次时不复用旧轮文件', async () => {
  const api = vi.spyOn(workflowApi, 'getReviewDiff').mockImplementation(async (id) => ({ status: 'ready', base_git_hash: 'a', head_git_hash: id,
    diffs: [{ old_path: 'same.py', new_path: 'same.py', diff: `@@ -1 +1 @@\n-old\n+${id}` }] }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ id, full }: { id: string; full: boolean }) => <QueryClientProvider client={client}><ReviewDiff instanceId={id} reviews={full ? reviews : [{ node_id: 'ai', status: 'completed', summary: '', coverage: {} }]} /></QueryClientProvider>;
  const { rerender } = render(wrapper({ id: 'round-one', full: false }));
  expect(screen.queryByRole('button', { name: '查看代码差异' })).toBeNull();
  expect(api).not.toHaveBeenCalled();
  rerender(wrapper({ id: 'round-one', full: true }));
  fireEvent.click(screen.getByRole('button', { name: '查看代码差异' }));
  fireEvent.click(within(await screen.findByRole('article', { name: 'same.py' })).getByRole('button', { name: '展开代码差异' }));
  expect(await screen.findByText('round-one')).toBeTruthy();
  rerender(wrapper({ id: 'round-two', full: true }));
  fireEvent.click(within(await screen.findByRole('article', { name: 'same.py' })).getByRole('button', { name: '展开代码差异' }));
  expect(await screen.findByText('round-two')).toBeTruthy();
  expect(screen.queryByText('round-one')).toBeNull();
});

it('权限收回后重新读取失败时隐藏已缓存的差异', async () => {
  const api = vi.spyOn(workflowApi, 'getReviewDiff').mockResolvedValueOnce({ status: 'ready', base_git_hash: 'a', head_git_hash: 'b',
    diffs: [{ old_path: 'private.py', new_path: 'private.py', diff: '@@ -1 +1 @@\n-old\n+私有代码' }] })
    .mockRejectedValue({ status: 404, friendlyMessage: '无权读取' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ReviewDiff instanceId="round-private" reviews={reviews} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: '查看代码差异' }));
  fireEvent.click(within(await screen.findByRole('article', { name: 'private.py' })).getByRole('button', { name: '展开代码差异' }));
  expect(await screen.findByText('私有代码')).toBeTruthy();
  await client.invalidateQueries({ queryKey: ['review-diff', 'round-private'] });
  expect((await screen.findByRole('alert')).textContent).toContain('无权读取');
  expect(screen.queryByText('私有代码')).toBeNull();
  expect(api).toHaveBeenCalledTimes(2);
});

it('账号令牌切换后不会展示上个会话缓存的代码', async () => {
  vi.spyOn(workflowApi, 'getReviewDiff').mockResolvedValueOnce({ status: 'ready', base_git_hash: 'a', head_git_hash: 'b',
    diffs: [{ old_path: 'private.py', new_path: 'private.py', diff: '@@ -1 +1 @@\n-old\n+私有代码' }] })
    .mockRejectedValue({ status: 404, friendlyMessage: '无权读取' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ReviewDiff instanceId="same-round" reviews={reviews} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: '查看代码差异' }));
  fireEvent.click(within(await screen.findByRole('article', { name: 'private.py' })).getByRole('button', { name: '展开代码差异' }));
  expect(await screen.findByText('私有代码')).toBeTruthy();
  act(() => useAuthStore.getState().setTokens('new-account-token'));
  expect(screen.queryByText('私有代码')).toBeNull();
  expect((await screen.findByRole('alert')).textContent).toContain('无权读取');
  expect(screen.queryByText('私有代码')).toBeNull();
  expect(JSON.stringify(client.getQueryCache().getAll().map((query) => query.queryKey))).not.toContain('new-account-token');
});

it('差异块计数不匹配时保留原文并把行意见降级', async () => {
  vi.spyOn(workflowApi, 'getReviewDiff').mockResolvedValue({ status: 'ready', base_git_hash: 'a', head_git_hash: 'b', diffs: [
    { old_path: 'broken.py', new_path: 'broken.py', diff: '@@ -1,1 +1,1 @@\n-old\n+new\n+extra\n@@ -1 +1 @@\n-x\n+y' },
  ] });
  const cases = [{ node_id: 'ai', status: 'completed' as const, summary: '', coverage: {}, findings: [
    { severity: 'P1', title: '不能定位', reason: '原因', suggestion: '检查', path: 'broken.py', side: 'new' as const, line_start: 1, line_end: 1 },
  ] }];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ReviewDiff instanceId="bad-hunk" reviews={cases} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: '查看代码差异' }));
  const file = await screen.findByRole('article', { name: 'broken.py' });
  fireEvent.click(within(file).getByRole('button', { name: '展开代码差异' }));
  expect(within(file).getByText('不能定位')).toBeTruthy();
  expect(within(file).getByText('文件级意见（未能可靠定位到行）')).toBeTruthy();
  expect(within(file).getByText('extra')).toBeTruthy();
  expect(within(file).queryByLabelText('新侧第 2 行')).toBeNull();
  expect(within(file).queryByLabelText('新侧第 1 行')).toBeNull();
  expect(within(file).getByText(/差异块不完整/)).toBeTruthy();
});

it('长差异分页后可读到末尾，未打开文件不会构建所有代码行', async () => {
  const lines = Array.from({ length: 401 }, (_, index) => `+line-${index + 1}`);
  vi.spyOn(workflowApi, 'getReviewDiff').mockResolvedValue({ status: 'ready', base_git_hash: 'a', head_git_hash: 'b', diffs: [
    { old_path: 'long.py', new_path: 'long.py', new_file: true, diff: `@@ -0,0 +1,401 @@\n${lines.join('\n')}` },
  ] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const cases = [{ node_id: 'ai', status: 'completed' as const, summary: '', coverage: {}, findings: [
    { severity: 'P1', title: '末尾问题', reason: '原因', suggestion: '检查', path: 'long.py', side: 'new' as const, line_start: 401, line_end: 401 },
  ] }];
  render(<QueryClientProvider client={client}><ReviewDiff instanceId="long" reviews={cases} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: '查看代码差异' }));
  const file = await screen.findByRole('article', { name: 'long.py' });
  expect(within(file).queryByText('line-1')).toBeNull();
  fireEvent.click(within(file).getByRole('button', { name: '查看意见：末尾问题' }));
  expect(within(file).getByText('line-401')).toBeTruthy();
  expect(within(file).getByText('末尾问题').closest('[data-line-side="new"]')).toBeTruthy();
});
