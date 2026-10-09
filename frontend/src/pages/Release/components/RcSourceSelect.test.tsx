import { afterEach, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import request from '@/api/request';
import { RcSourceSelect } from './RcSourceSelect';

afterEach(cleanup);
const candidate = (id: string, available = true) => ({
  id, version: id, tag_name: `${id}-rc`, branch: 'develop', git_hash: 'a'.repeat(40),
  available, unavailable_reason: available ? '' : 'RC Tag 已不存在', released_at: null,
});
const response = (config: InternalAxiosRequestConfig, results: unknown[], total = results.length): AxiosResponse => ({
  config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: { results, total } },
});

it('切换项目后迟到的候选响应不会覆盖新项目', async () => {
  let finishOld: (() => void) | undefined;
  request.defaults.adapter = async (config) => {
    if (config.params.project === 'old') return new Promise((resolve) => {
      finishOld = () => resolve(response(config, [candidate('旧项目RC')]));
    });
    return response(config, [candidate('新项目RC')]);
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (project: string) => <QueryClientProvider client={queryClient}><RcSourceSelect project={project} repository="repo" /></QueryClientProvider>;
  const { rerender } = render(ui('old'));
  await waitFor(() => expect(finishOld).toBeTypeOf('function'));
  rerender(ui('new'));
  expect(await screen.findByRole('radio', { name: /新项目RC/ })).toBeTruthy();
  await act(async () => finishOld?.());
  expect(screen.queryByRole('radio', { name: /旧项目RC/ })).toBeNull();
});

it('可搜索分页，失效引用显示原因且不能选中', async () => {
  request.defaults.adapter = async (config) => {
    if (config.params.search) return response(config, [candidate('搜索结果', false)]);
    return response(config, [candidate(config.params.page === 1 ? '第一页RC' : '第二页RC')], 6);
  };
  render(<QueryClientProvider client={new QueryClient()}><RcSourceSelect project="project" repository="repo" /></QueryClientProvider>);
  await screen.findByRole('radio', { name: /第一页RC/ });
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  await screen.findByRole('radio', { name: /第二页RC/ });
  fireEvent.change(screen.getByLabelText('搜索 RC 版本或 Tag'), { target: { value: '搜索' } });
  const unavailable = await screen.findByRole('radio', { name: /搜索结果/ }) as HTMLInputElement;
  expect(unavailable.disabled).toBe(true);
  expect(screen.getByText('RC Tag 已不存在')).toBeTruthy();
  expect(screen.getByText('第 1 页 · 共 1 条')).toBeTruthy();
});
