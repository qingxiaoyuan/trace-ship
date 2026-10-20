import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PackageConfig } from '@/types';
import { ConfigList } from './ConfigList';

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('配置收藏的项目角色边界', () => {
  it('兼任账号只在开发项目提供收藏，维保项目保留配置阅读', () => {
    const onToggleFavorite = vi.fn();
    const configs = [
      { id: 'read', name: '维保项目配置', my_role: 'maintainer', repository_id: 'repo-a', repository_name: '维保软件' },
      { id: 'write', name: '开发项目配置', my_role: 'developer', repository_id: 'repo-b', repository_name: '开发软件' },
    ] as PackageConfig[];
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ConfigList configs={configs} tasks={[]} loading={false}
      onEdit={() => {}} onDelete={() => {}} onTrigger={() => {}} onNew={() => {}}
      onToggleFavorite={onToggleFavorite} canCreate={false} /></MemoryRouter></QueryClientProvider>);
    expect(screen.getAllByText('维保项目配置').length).toBeGreaterThan(0);
    const favorites = screen.getAllByTitle('收藏为常用配置');
    // 桌面和手机各一套布局，均只给开发项目展示收藏。
    expect(favorites).toHaveLength(2);
    fireEvent.click(favorites[0]);
    expect(onToggleFavorite).toHaveBeenCalledExactlyOnceWith(configs[1]);
  });
});
