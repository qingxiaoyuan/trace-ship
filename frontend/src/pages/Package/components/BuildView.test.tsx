import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { App } from 'antd';
import type { PackageTask } from '@/types';
import { BuildView } from './BuildView';

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
  });
});
afterEach(cleanup);

describe('维保打包详情', () => {
  it.each([false, true])('运行任务按取消能力 %s 显示操作，日志仍可读', (canCancel) => {
    const task = {
      id: 'task', name: '只读任务', status: 'running', my_role: 'maintainer', progress: 20,
      can_cancel: canCancel, can_push_svn: false, artifact_info: [], config_snapshot: {},
    } as unknown as PackageTask;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><App><MemoryRouter>
      <BuildView task={task} logText="打包日志" onBack={() => {}} onCancel={() => {}} />
    </MemoryRouter></App></QueryClientProvider>);

    expect(screen.getByText('只读任务')).toBeTruthy();
    expect(Boolean(screen.queryByRole('button', { name: '停止构建' }))).toBe(canCancel);
  });
});
