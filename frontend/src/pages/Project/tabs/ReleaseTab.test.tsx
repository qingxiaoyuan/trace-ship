import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import request from '@/api/request';
import { ReleaseTab } from './ReleaseTab';

const releases = [
  { id: 'old', software: 'a', software_name: '旧软件', repository: 'shared', repository_name: '共享主仓库', version: 'VA.1', tag_name: '旧Tag', released_at: '2026-09-01T00:00:00Z', release_type: 'rc' },
  { id: 'new', software: 'b', software_name: '新软件', repository: 'shared', repository_name: '共享主仓库', version: 'VB.2', tag_name: '新Tag', released_at: '2026-10-09T00:00:00Z', release_type: 'rc' },
];
const selections = releases.map(release => ({
  id: `project-software-${release.software}`, is_active: true,
  software: { id: release.software, name: release.software_name, slug: release.software,
    repository: 'shared', repository_name: '共享主仓库' },
}));
const originalAdapter = request.defaults.adapter;

beforeEach(() => {
  request.defaults.adapter = async (config) => ({
    config, status: 200, statusText: 'OK', headers: {},
    data: { code: 0, data: config.url?.endsWith('/software/') ? selections : {
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
  it('软件先加载时等待发布数据，同仓库两个软件独立分组并默认展开最近版本', async () => {
    let finish: (() => void) | undefined;
    request.defaults.adapter = async (config) => {
      const response = (data: unknown) => ({ config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data } });
      if (config.url?.endsWith('/software/')) return response(selections);
      return new Promise((resolve) => {
        finish = () => resolve(response({ total: 2, page: 1, page_size: 100, results: releases }));
      });
    };
    renderTab();
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    await act(async () => finish?.());

    await waitFor(() => expect(screen.getAllByRole('button', { name: /新软件/ })[0].getAttribute('aria-expanded')).toBe('true'));
    expect(screen.getAllByRole('button', { name: /旧软件/ })[0].getAttribute('aria-expanded')).toBe('false');
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
        data: { code: 0, data: config.url?.endsWith('/software/') ? selections : {
          total: all.length, page, page_size: pageSize,
          results: all.slice((page - 1) * pageSize, page * pageSize),
        } },
      };
    };
    renderTab(context === '仓库' ? 'shared' : undefined);
    expect(await screen.findByText('共 101 个版本')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(context === '仓库' ? '搜索软件、版本号或 Tag' : '搜索软件、主仓库、版本号或 Tag'), {
      target: { value: 'Tag-100' },
    });
    expect(screen.getAllByText('VB.100').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('VB.99')).toHaveLength(0);
  });

  it('仓库发布列表按稳定软件身份筛选，并明确显示待归属历史', async () => {
    request.defaults.adapter = async config => ({
      config, status: 200, statusText: 'OK', headers: {},
      data: { code: 0, data: { total: 3, page: 1, page_size: 100, results: [...releases, {
        ...releases[0], id: 'unassigned', software: null, software_name: null, version: '历史发布',
      }] } },
    });
    renderTab('shared');
    const filter = await screen.findByRole('combobox', { name: '按软件筛选版本' });
    await screen.findByText('共 3 个版本');
    fireEvent.change(filter, { target: { value: 'b' } });
    expect(screen.getByText('共 1 个版本')).toBeTruthy();
    expect(screen.queryByText('旧Tag')).toBeNull();
    fireEvent.change(filter, { target: { value: 'unassigned' } });
    expect(screen.getAllByText('历史发布').length).toBeGreaterThan(0);
    expect(screen.queryByText('新Tag')).toBeNull();
  });

  it('后续页加载失败时显示错误，不把部分发布当成完整列表', async () => {
    request.defaults.adapter = async (config) => {
      if (Number(config.params?.page) === 2) return {
        config, status: 200, statusText: 'OK', headers: {},
        data: { code: 50000, message: '第二页发布加载失败', data: null },
      };
      return {
        config, status: 200, statusText: 'OK', headers: {},
        data: { code: 0, data: config.url?.endsWith('/software/') ? selections : {
          total: 101, page: 1, page_size: 100, results: releases,
        } },
      };
    };
    renderTab();
    expect(await screen.findByText('第二页发布加载失败')).toBeTruthy();
    expect(screen.queryByText('暂无选用软件或已发布版本')).toBeNull();
    expect(screen.queryByText('共 2 个版本')).toBeNull();
  });

  it('历史发布时间缺失时优先展开有发布记录的软件', async () => {
    request.defaults.adapter = async (config) => ({
      config, status: 200, statusText: 'OK', headers: {},
      data: { code: 0, data: config.url?.endsWith('/software/') ? selections : {
        total: 1, page: 1, page_size: 100, results: [{ ...releases[1], released_at: null }],
      } },
    });
    renderTab();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /新软件/ })[0].getAttribute('aria-expanded')).toBe('true'));
    expect(screen.getAllByRole('button', { name: /旧软件/ })[0].getAttribute('aria-expanded')).toBe('false');
  });
});
