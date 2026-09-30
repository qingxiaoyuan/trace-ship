import { describe, expect, it } from 'vitest';
import { resolvePackageTriggerScope, type PackageTriggerTarget } from './packageTriggerScope';

describe('resolvePackageTriggerScope', () => {
  it('优先使用配置接口返回的 project_id / repository_id', () => {
    const config: PackageTriggerTarget = {
      id: 'cfg-1',
      name: 'web 打包',
      project_id: 'project-uuid',
      repository_id: 'repo-uuid',
    };

    expect(resolvePackageTriggerScope(config)).toEqual({
      projectId: 'project-uuid',
      repositoryId: 'repo-uuid',
    });
  });

  it('同时存在时优先使用 *_id，忽略映射字段', () => {
    const config: PackageTriggerTarget = {
      id: 'cfg-1b',
      name: 'web 打包',
      project_id: 'project-uuid',
      project: 'project-mapped',
      repository_id: 'repo-uuid',
      repository: 'repo-mapped',
    };

    expect(resolvePackageTriggerScope(config)).toEqual({
      projectId: 'project-uuid',
      repositoryId: 'repo-uuid',
    });
  });

  it('兼容收藏卡片映射的 project / repository 字段', () => {
    const config: PackageTriggerTarget = {
      id: 'cfg-2',
      name: 'web 打包',
      project: 'project-mapped',
      repository: 'repo-mapped',
    };

    expect(resolvePackageTriggerScope(config)).toEqual({
      projectId: 'project-mapped',
      repositoryId: 'repo-mapped',
    });
  });

  it('两套字段都缺失时返回空，查询不会误启用', () => {
    expect(resolvePackageTriggerScope({ id: 'cfg-3', name: 'empty' })).toEqual({
      projectId: undefined,
      repositoryId: undefined,
    });
    expect(resolvePackageTriggerScope(null)).toEqual({
      projectId: undefined,
      repositoryId: undefined,
    });
  });
});
