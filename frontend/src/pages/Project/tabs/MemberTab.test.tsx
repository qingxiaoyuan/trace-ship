import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import request from '@/api/request';
import { useAuthStore } from '@/stores/authStore';
import { MemberTab } from './MemberTab';

const originalAdapter = request.defaults.adapter;
let projectRole = 'maintainer';
let memberRole = 'maintainer';
let savedRole = '';

beforeEach(() => {
  projectRole = 'maintainer';
  memberRole = 'maintainer';
  savedRole = '';
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
  });
  request.defaults.adapter = async (config) => {
    if (config.method === 'patch') savedRole = JSON.parse(config.data).role;
    return ({
    config, status: 200, statusText: 'OK', headers: {},
    data: { code: 0, data: config.url?.endsWith('/members/') ? { total: 1, page: 1, page_size: 100, results: [{
      id: 'member', role: memberRole, created_at: '2026-10-14T00:00:00Z',
      user: { id: 'user', nickname: '维保成员', username: 'maintainer', is_active: true },
    }] } : { id: 'project', name: '维保项目', my_role: projectRole } },
  });
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  request.defaults.adapter = originalAdapter;
  useAuthStore.setState({ user: null });
});

describe('维保项目成员页面', () => {
  it('显示维保角色并隐藏添加成员入口', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><App><MemberTab projectId="project" /></App></QueryClientProvider>);

    expect((await screen.findAllByText('维保人员')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /添加成员/ })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: /移除/ })).toBeNull();
  });

  it.each(['manager', 'software_admin'])('%s 可以选择并保存维保角色', async (role) => {
    projectRole = role;
    memberRole = 'developer';
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><App><MemberTab projectId="project" /></App></QueryClientProvider>);
    await screen.findByRole('button', { name: /添加成员/ });
    const [select] = await screen.findAllByRole('combobox');
    fireEvent.mouseDown(select);
    fireEvent.click(await screen.findByText('维保人员'));
    await waitFor(() => expect(savedRole).toBe('maintainer'));
  });
});
