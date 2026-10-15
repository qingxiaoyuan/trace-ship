import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { App } from 'antd';
import request from '@/api/request';
import ProjectDetail from './Detail';

const originalAdapter = request.defaults.adapter;
let projectRole = 'maintainer';

beforeEach(() => {
  projectRole = 'maintainer';
  request.defaults.adapter = async (config) => ({
    config, status: 200, statusText: 'OK', headers: {},
    data: { code: 0, data: { id: 'project', name: '权限验收项目', status: 'active', my_role: projectRole } },
  });
});
afterEach(() => { cleanup(); request.defaults.adapter = originalAdapter; });

describe('项目详情的发布入口', () => {
  it.each(['maintainer', 'developer', 'manager'])('%s 按目标项目角色显示新建发布', async (role) => {
    projectRole = role;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><App><MemoryRouter initialEntries={['/projects/project']}>
      <Routes><Route path="/projects/:id" element={<ProjectDetail />} /></Routes>
    </MemoryRouter></App></QueryClientProvider>);
    await screen.findByRole('heading', { name: '权限验收项目' });
    expect(Boolean(screen.queryByRole('button', { name: '新建发布' }))).toBe(role !== 'maintainer');
  });
});
