import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { PackageTask } from '@/types';
import { BuildHistory } from './BuildHistory';

afterEach(cleanup);

describe('只读任务历史', () => {
  it('维保保留运行阶段与进度展示，隐藏停止按钮', () => {
    const task = { id: 'task', version: 'V1.0.0', status: 'running', progress: 35, stage_info: { stage: '验收构建阶段' }, can_cancel: false, created_at: '2026-10-14T00:00:00Z' } as PackageTask;
    render(<BuildHistory builds={[task]} activeBuildId="task" onSelect={() => {}} onCancel={() => {}} />);
    expect(screen.getAllByText('验收构建阶段').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull();
  });
});
