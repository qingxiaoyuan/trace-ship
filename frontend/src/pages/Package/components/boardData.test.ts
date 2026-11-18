import { describe, expect, it, vi } from 'vitest';
import type { PackageConfig, PackageTask } from '@/types';
import {
  fetchAllPages,
  groupConfigsBySoftware,
  groupTasksByRepository,
  mergePackageTasks,
} from './boardData';

const task = (overrides: Partial<PackageTask>): PackageTask => ({
  id: 'task-1',
  release: null,
  project: 'project-1',
  repository: 'repo-1',
  name: '任务',
  tag_name: 'main',
  version: 'main',
  status: 'running',
  created_at: '2026-09-11T10:00:00Z',
  ...overrides,
});

const config = (overrides: Partial<PackageConfig>): PackageConfig => ({
  id: 'config-1',
  project_id: 'project-1',
  repository_id: 'repo-1',
  name: '配置',
  is_active: true,
  created_at: '2026-09-11T10:00:00Z',
  updated_at: '2026-09-11T10:00:00Z',
  ...overrides,
});

describe('fetchAllPages', () => {
  it('按服务端分页上限拉取全部记录', async () => {
    const all = Array.from({ length: 230 }, (_, index) => index + 1);
    const fetchPage = vi.fn(async (page: number, pageSize: number) => ({
      total: all.length,
      page,
      page_size: Math.min(pageSize, 100),
      results: all.slice((page - 1) * 100, page * 100),
    }));

    const result = await fetchAllPages(fetchPage, 100);

    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(result.results).toEqual(all);
  });
});

describe('mergePackageTasks', () => {
  it('任务跨活动与历史列表时去重，并采用历史终态', () => {
    const active = task({ id: 'same', status: 'running' });
    const finished = task({ id: 'same', status: 'success', finished_at: '2026-09-11T10:01:00Z' });

    expect(mergePackageTasks([active], [finished])).toEqual([finished]);
  });
});

describe('仓库分组', () => {
  it('同名但 ID 不同的物理仓库保持为两个任务组', () => {
    const groups = groupTasksByRepository(
      [
        task({ id: 'task-a', repository: 'repo-a', repository_name: 'same-name' }),
        task({ id: 'task-b', repository: 'repo-b', repository_name: 'same-name' }),
      ],
      [],
    );

    expect(groups.map((group) => group.repositoryId)).toEqual(['repo-a', 'repo-b']);
  });

  it('同一仓库的两个软件分别展示，且收藏优先', () => {
    const groups = groupConfigsBySoftware([
      config({ id: 'plain-a', software: 'software-a', software_name: 'A' }),
      config({ id: 'plain-b', software: 'software-b', software_name: 'B' }),
      config({ id: 'favorite-b', software: 'software-b', software_name: 'B', is_favorite: true }),
    ]);

    expect(groups.map((group) => group.id)).toEqual(['software-b', 'software-a']);
    expect(groups[0].configs.map((item) => item.id)).toEqual(['favorite-b', 'plain-b']);
  });

  it('不同仓库的旧组件配置统一归到未分组', () => {
    const groups = groupConfigsBySoftware([
      config({ id: 'legacy-a', repository_id: 'repo-a' }),
      config({ id: 'legacy-b', repository_id: 'repo-b' }),
    ]);

    expect(groups.map((group) => group.name)).toEqual(['未分组']);
    expect(groups[0].configs.map((item) => item.id)).toEqual(['legacy-a', 'legacy-b']);
  });
});
