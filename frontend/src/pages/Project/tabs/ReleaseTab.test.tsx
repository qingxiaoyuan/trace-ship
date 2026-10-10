import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import request from '@/api/request';
import { ReleaseTab } from './ReleaseTab';

const releases = [
  { id: 'old', repository: 'a', version: 'VA.1', tag_name: '旧Tag', released_at: '2026-09-01T00:00:00Z', release_type: 'rc' },
  { id: 'new', repository: 'b', version: 'VB.2', tag_name: '新Tag', released_at: '2026-10-09T00:00:00Z', release_type: 'rc' },
];
const components = ['a', 'b'].map((id) => ({
  id: `component-${id}`, repository: id, default_branch: 'main',
  repository_detail: { id, name: id === 'a' ? '旧仓库' : '新仓库', external_identity: `group/${id}` },
}));
const originalAdapter = request.defaults.adapter;

beforeEach(() => {
  request.defaults.adapter = async (config) => ({
    config, status: 200, statusText: 'OK', headers: {},
    data: { code: 0, data: config.url?.endsWith('/components/') ? components : {
      total: releases.length, page: 1, page_size: 100, results: releases,
    } },
  });
});
afterEach(() => {
  cleanup();
  request.defaults.adapter = originalAdapter;
});

function renderTab(repositoryId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><ReleaseTab projectId={repositoryId ? undefined : 'project'} repositoryId={repositoryId} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('发布版本列表', () => {
  it('仓库先加载时等待发布数据，再默认展开最近发布的仓库', async () => {
    let finish: (() => void) | undefined;
    request.defaults.adapter = async (config) => {
      const response = (data: unknown) => ({ config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data } });
      if (config.url?.endsWith('/components/')) return response(components);
      return new Promise((resolve) => {
        finish = () => resolve(response({ total: 2, page: 1, page_size: 100, results: releases }));
      });
    };
    renderTab();
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    await act(async () => finish?.());

    await waitFor(() => expect(screen.getAllByRole('button', { name: /新仓库/ })[0].getAttribute('aria-expanded')).toBe('true'));
    expect(screen.getAllByRole('button', { name: /旧仓库/ })[0].getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryAllByText('VA.1', { selector: 'span' })).toHaveLength(0);
    expect(screen.getAllByText('VB.2').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '全部展开' }));
    expect(screen.getAllByText('VA.1').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '全部折叠' }));
    expect(screen.queryAllByText('VB.2', { selector: 'span' })).toHaveLength(0);
  });

  it.each(['项目', '仓库'])('%s列表能统计并搜索第 101 条发布记录', async (context) => {
    const all = Array.from({ length: 101 }, (_, index) => ({
      ...releases[1], id: `release-${index}`, version: `VB.${index}`, tag_name: `Tag-${index}`,
    }));
    request.defaults.adapter = async (config) => {
      const page = Number(config.params?.page || 1);
      const pageSize = Math.min(Number(config.params?.page_size || 100), 100);
      return {
        config, status: 200, statusText: 'OK', headers: {},
        data: { code: 0, data: config.url?.endsWith('/components/') ? components : {
          total: all.length, page, page_size: pageSize,
          results: all.slice((page - 1) * pageSize, page * pageSize),
        } },
      };
    };
    renderTab(context === '仓库' ? 'b' : undefined);
    expect(await screen.findByText(context === '仓库' ? '共 101 个版本' : '共 2 个仓库 · 101 个版本')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(context === '仓库' ? '搜索版本号 / Tag / Redmine' : '搜索仓库、版本号、Tag 或 Redmine'), {
      target: { value: 'Tag-100' },
    });
    expect(screen.getAllByText('VB.100').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('VB.99')).toHaveLength(0);
  });

  it('后续页加载失败时显示错误，不把部分发布当成完整列表', async () => {
    request.defaults.adapter = async (config) => {
      if (Number(config.params?.page) === 2) return {
        config, status: 200, statusText: 'OK', headers: {},
        data: { code: 50000, message: '第二页发布加载失败', data: null },
      };
      return {
        config, status: 200, statusText: 'OK', headers: {},
        data: { code: 0, data: config.url?.endsWith('/components/') ? components : {
          total: 101, page: 1, page_size: 100, results: releases,
        } },
      };
    };
    renderTab();
    expect(await screen.findByText('第二页发布加载失败')).toBeTruthy();
    expect(screen.queryByText('暂无关联仓库或已发布版本')).toBeNull();
    expect(screen.queryByText('共 2 个仓库 · 2 个版本')).toBeNull();
  });

  it('历史发布时间缺失时优先展开有发布记录的仓库', async () => {
    request.defaults.adapter = async (config) => ({
      config, status: 200, statusText: 'OK', headers: {},
      data: { code: 0, data: config.url?.endsWith('/components/') ? components : {
        total: 1, page: 1, page_size: 100, results: [{ ...releases[1], released_at: null }],
      } },
    });
    renderTab();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /新仓库/ })[0].getAttribute('aria-expanded')).toBe('true'));
    expect(screen.getAllByRole('button', { name: /旧仓库/ })[0].getAttribute('aria-expanded')).toBe('false');
  });
});
