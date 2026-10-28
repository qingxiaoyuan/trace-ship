import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import request from '@/api/request';
import { WorkflowHistory } from './WorkflowHistory';

const adapter = request.defaults.adapter;
afterEach(() => { cleanup(); request.defaults.adapter = adapter; vi.unstubAllGlobals(); });

it('显示当前及历史审批，并提供各轮详情链接', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  request.defaults.adapter = async (config) => ({
    config, status: 200, statusText: 'OK', headers: {},
    data: { code: 0, data: { total: 2, results: [
      { id: 'new', is_current: true, status: 'running', created_at: '2026-10-28T10:00:00Z' },
      { id: 'old', is_current: false, status: 'revoked', created_at: '2026-10-27T10:00:00Z' },
    ] } },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><WorkflowHistory releaseId="release" /></MemoryRouter></QueryClientProvider>);
  expect((await screen.findByRole('link', { name: /当前审批/ })).getAttribute('href')).toBe('/workflows/new');
  expect(screen.getByRole('link', { name: /历史审批/ }).getAttribute('href')).toBe('/workflows/old');
  expect(screen.getByText('已终止')).toBeTruthy();
});


it('切换发布申请后从第一页加载审批记录', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addListener() {}, removeListener() {} }));
  const requests: Array<{ biz_id: string; page: number }> = [];
  request.defaults.adapter = async (config) => {
    requests.push(config.params);
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: {
      total: config.params.biz_id === 'first' ? 20 : 1,
      results: [{ id: config.params.biz_id, is_current: true, status: 'running', created_at: '2026-10-28T10:00:00Z' }],
    } } };
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (id: string) => <QueryClientProvider client={client}><MemoryRouter><WorkflowHistory releaseId={id} /></MemoryRouter></QueryClientProvider>;
  const view = render(wrap('first'));
  fireEvent.click(await screen.findByTitle('2'));
  await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({ biz_id: 'first', page: 2 })));
  view.rerender(wrap('second'));
  await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({ biz_id: 'second', page: 1 })));
  expect(requests).not.toContainEqual(expect.objectContaining({ biz_id: 'second', page: 2 }));
});
