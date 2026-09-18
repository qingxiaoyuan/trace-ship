import { describe, expect, it } from 'vitest';
import type { MenuItem } from '@/types';
import { applyRepoDeepLinks, getVisibleEntries, matchEntry } from './registry';

const menus: MenuItem[] = [
  { id: 'packages', name: '打包看板', path: '/packages', icon: 'PlayCircleOutlined' },
  { id: 'repositories', name: '仓库', path: '/repositories', icon: 'DatabaseOutlined' },
  { id: 'releases', name: '发布看板', path: '/releases', icon: 'RocketOutlined' },
  { id: 'tags', name: '新建发布', path: '/releases/create', icon: 'TagsOutlined' },
];

describe('getVisibleEntries', () => {
  it('只保留当前菜单可见的功能入口和快捷操作', () => {
    const ids = getVisibleEntries(menus).map((entry) => entry.id);
    expect(ids).toContain('packages');
    expect(ids).toContain('package-configs');
    expect(ids).toContain('action-create-release');
    expect(ids).not.toContain('system-users');
  });
});

describe('matchEntry', () => {
  const entries = getVisibleEntries(menus);
  const pack = entries.find((entry) => entry.id === 'packages')!;

  it('空查询匹配全部', () => {
    expect(matchEntry(pack, '')).toBe(true);
    expect(matchEntry(pack, '   ')).toBe(true);
  });

  it('按名称或关键词包含匹配', () => {
    expect(matchEntry(pack, '打包')).toBe(true);
    expect(matchEntry(pack, 'db')).toBe(true);
    expect(matchEntry(pack, '不存在xyz')).toBe(false);
  });
});

describe('applyRepoDeepLinks', () => {
  it('无最近仓库时保持列表路径', () => {
    const entries = getVisibleEntries(menus);
    const patched = applyRepoDeepLinks(entries);
    expect(patched.find((entry) => entry.id === 'repo-audit-flow')?.path).toBe('/repositories');
  });

  it('有最近仓库时深链到对应 tab', () => {
    const entries = getVisibleEntries(menus);
    const patched = applyRepoDeepLinks(entries, 'repo-1', '后端仓库');
    expect(patched.find((entry) => entry.id === 'repo-audit-flow')?.path).toBe(
      '/repositories/repo-1/workflows',
    );
    expect(patched.find((entry) => entry.id === 'repo-version-rule')?.path).toBe(
      '/repositories/repo-1/version-rule',
    );
  });
});
