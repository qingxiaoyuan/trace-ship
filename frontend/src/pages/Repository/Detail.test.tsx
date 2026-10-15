import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { App } from 'antd';
import request from '@/api/request';
import { DashboardContextState } from '@/hooks/useDashboardContext';
import RepositoryDetail from './Detail';

const originalAdapter = request.defaults.adapter;

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
  });
  request.defaults.adapter = async (config) => ({
    config, status: 200, statusText: 'OK', headers: {},
    data: { code: 0, data: config.url?.endsWith('/tags/')
      ? [{ name: 'V1.0.0', commit_hash: 'a'.repeat(40) }]
      : { id: 'repo', name: '阅读仓库', repo_type: 'git', vendor: 'gitlab', health_status: 'healthy', used_by_projects: [] } },
  });
});
afterEach(() => { cleanup(); request.defaults.adapter = originalAdapter; });

describe('仓库详情角色入口', () => {
  it.each(['maintainer', 'general'] as const)('%s 保留阅读且按工作台身份收敛配置和删除入口', async (layoutMode) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><App><MemoryRouter initialEntries={['/repositories/repo/tags']}>
      <DashboardContextState.Provider value={{ layout_mode: layoutMode, visible_project_count: 1 }}>
        <Routes><Route path="/repositories/:id/:tab" element={<RepositoryDetail />} /></Routes>
      </DashboardContextState.Provider>
    </MemoryRouter></App></QueryClientProvider>);
    await screen.findByText('V1.0.0');
    for (const name of ['立即同步', '编辑', '删除', '凭证配置', '版本规则', '审批流']) {
      expect(Boolean(screen.queryByRole('button', { name }))).toBe(layoutMode === 'general');
    }
    expect(Boolean(screen.queryByTitle('删除标签 V1.0.0'))).toBe(layoutMode === 'general');
  });
});
