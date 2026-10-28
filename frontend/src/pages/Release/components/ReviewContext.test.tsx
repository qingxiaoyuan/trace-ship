import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { releaseApi } from '@/api/release';
import type { Release } from '@/types';
import { ReviewContext } from './ReviewContext';

const release = { id: 'r', status: 'draft', review_context: '原始说明', review_document_paths: ['docs/one.md'] } as Release;
function show(canEdit: boolean) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
    <ReviewContext release={release} canEdit={canEdit} />
  </QueryClientProvider>);
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('发布人可修改说明和多个文档路径并保存', async () => {
  const save = vi.spyOn(releaseApi, 'updateReviewContext').mockResolvedValue(release);
  show(true);
  fireEvent.change(screen.getByLabelText('补充审查说明'), { target: { value: '真实需求说明\n第二行' } });
  fireEvent.change(screen.getByLabelText('仓库文档路径'), { target: { value: 'docs/a.md\ndocs/b.md\n' } });
  fireEvent.click(screen.getByRole('button', { name: '保存审查上下文' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith('r', '真实需求说明\n第二行', ['docs/a.md', 'docs/b.md']));
});

it('无编辑权限时不展示编辑入口', () => {
  show(false);
  expect(screen.queryByRole('button', { name: '保存审查上下文' })).toBeNull();
  expect(screen.queryByLabelText('补充审查说明')).toBeNull();
});

it('修改后提示未保存，保存成功后清除未保存状态', async () => {
  vi.spyOn(releaseApi, 'updateReviewContext').mockResolvedValue(release);
  const dirty = vi.fn();
  render(<QueryClientProvider client={new QueryClient()}><ReviewContext release={release} canEdit onDirtyChange={dirty} /></QueryClientProvider>);
  fireEvent.change(screen.getByLabelText('补充审查说明'), { target: { value: '新说明' } });
  expect(dirty).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: '保存审查上下文' }));
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
});
