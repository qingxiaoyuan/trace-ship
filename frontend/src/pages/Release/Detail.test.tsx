import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { App } from 'antd';
import request from '@/api/request';
import ReleaseDetail from './Detail';

const originalAdapter = request.defaults.adapter;
let projectRole = 'maintainer';
let releaseStatus = 'released';

beforeEach(() => {
  projectRole = 'maintainer';
  releaseStatus = 'released';
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
  });
  request.defaults.adapter = async (config) => ({
    config, status: 200, statusText: 'OK', headers: {},
    data: { code: 0, data: config.url?.includes('/projects/') ? {
      id: 'project', my_role: projectRole, name: '维保项目',
    } : config.url?.endsWith('/review-issues/') ? [] : {
      id: 'release', project: 'project', version: 'V1.0.0', status: releaseStatus, release_type: 'rc',
      rejected_reason: '推 tag 失败',
      release_doc: '发布说明正文', can_review: false, can_reply: false, package_tasks: [],
    } },
  });
});

afterEach(() => { cleanup(); request.defaults.adapter = originalAdapter; });

describe('维保发布详情', () => {
  it.each(['released', 'draft', 'rejected'])('维保读取 %s 版本而不显示写操作', async (status) => {
    releaseStatus = status;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><App><MemoryRouter initialEntries={['/releases/release']}>
      <Routes><Route path="/releases/:id" element={<ReleaseDetail />} /></Routes>
    </MemoryRouter></App></QueryClientProvider>);

    await screen.findByText('发布说明正文');
    await waitFor(() => expect(client.getQueryState(['project', 'project'])?.status).toBe('success'));
    expect(screen.queryByRole('button', { name: /删除|重试推/ })).toBeNull();
  });

  it('在管理项目中保留已发布版本的删除操作', async () => {
    projectRole = 'manager';
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><App><MemoryRouter initialEntries={['/releases/release']}>
      <Routes><Route path="/releases/:id" element={<ReleaseDetail />} /></Routes>
    </MemoryRouter></App></QueryClientProvider>);
    expect(await screen.findByRole('button', { name: /删除版本/ })).toBeTruthy();
  });
});
