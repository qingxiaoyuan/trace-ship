import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import request from '@/api/request';
import type { Release } from '@/types';
import { FormalChangesPreview } from './FormalChangesPreview';

afterEach(cleanup);
const release = { id: 'formal', release_type: 'formal', source_rc: 'rc', source_rc_git_hash: 'b'.repeat(40), version: 'VA.1.0.2' } as Release;
const preview = {
  base_tag: 'VA.1.0.1', base_git_hash: 'a'.repeat(40), head_hash: 'b'.repeat(40), first_release: false, no_changes: false,
  warnings: ['MR !8 缺少可核实的合并提交，未自动纳入'],
  commits: Array.from({ length: 12 }, (_, i) => ({ hash: String(i), message: `feat: 累计功能${i + 1}`, author: '开发' })),
  merge_requests: [{ number: '1', title: '区间内修复' }], parsed_updates: [],
};
function show() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <FormalChangesPreview release={release} />
  </QueryClientProvider>);
}
it('展示固定范围与全部累计条目，不截断第十二条，显示 MR 缺口', async () => {
  request.defaults.adapter = async (config) => ({ config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: preview } });
  show();
  await screen.findByText('VA.1.0.1');
  fireEvent.click(screen.getByText('查看 12 条提交和 1 条 MR'));
  expect(screen.getByText(/feat: 累计功能12/)).toBeTruthy();
  expect(screen.getByText(preview.warnings[0])).toBeTruthy();
  expect(screen.getByText('区间内修复')).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
});
it.each(['first', 'same', 'failure', 'fork'])('明确展示 %s 状态', async (mode) => {
  request.defaults.adapter = async (config) => ({ config, status: 200, statusText: 'OK', headers: {},
    data: ['failure', 'fork'].includes(mode) ? { code: 50200, message: mode === 'fork' ? '上一正式提交不在来源 RC 的祖先链上' : 'GitLab 暂不可用' } : { code: 0, data: { ...preview,
      first_release: mode === 'first', no_changes: mode === 'same', base_tag: mode === 'first' ? '' : preview.base_tag,
    } },
  });
  show();
  expect(await screen.findByText(mode === 'first' ? /首次正式发布：/ : mode === 'same' ? /无新增代码：/ : mode === 'fork' ? /祖先链/ : /GitLab 暂不可用/)).toBeTruthy();
});
