import { describe, expect, it } from 'vitest';
import type { PackageTask } from '@/types';
import { canPushSvn } from './utils';

const task: PackageTask = {
  id: 'task', release: 'release', project: 'project', repository: 'repository', name: '打包任务',
  version: 'V1.0.0', tag_name: 'V1.0.0', created_at: '',
  status: 'success', release_type: 'formal',
  artifact_info: [{ id: 'artifact', name: 'app.zip', path: 'app.zip', size: 1, sha256: 'a'.repeat(64) }],
  config_snapshot: {
    trigger_source: 'manual_release', svn_push_enabled: true,
    svn_url: 'svn://example.invalid/releases', svn_credential_id: 'credential',
  },
};

describe('任务 SVN 补推入口', () => {
  it.each(['auto_release', 'manual_release', 'manual_branch'])('允许创建时开启 SVN 的 %s 任务补推', (source) => {
    expect(canPushSvn({ ...task, config_snapshot: { ...task.config_snapshot, trigger_source: source } })).toBe(true);
  });

  it.each(['rc', 'beta'] as const)('按快照中的生效开关展示 %s 补推入口', (releaseType) => {
    expect(canPushSvn({ ...task, release_type: releaseType })).toBe(true);
    expect(canPushSvn({ ...task, release_type: releaseType,
      config_snapshot: { ...task.config_snapshot, svn_push_enabled: false } })).toBe(false);
  });

  it.each([undefined, 'unknown'])('历史或未知来源 %s 不展示补推入口', (source) => {
    expect(canPushSvn({ ...task, config_snapshot: { ...task.config_snapshot, trigger_source: source } })).toBe(false);
  });

  it('继续检查成功状态、产物和完整 SVN 配置', () => {
    expect(canPushSvn({ ...task, status: 'failure' })).toBe(false);
    expect(canPushSvn({ ...task, artifact_info: [] })).toBe(false);
    expect(canPushSvn({ ...task, config_snapshot: { ...task.config_snapshot, svn_url: '' } })).toBe(false);
    expect(canPushSvn({ ...task, config_snapshot: { ...task.config_snapshot, svn_credential_id: null } })).toBe(false);
  });

  it('优先遵循服务端按当前项目权限返回的判定', () => {
    expect(canPushSvn({ ...task, can_push_svn: false })).toBe(false);
    expect(canPushSvn({ ...task, can_push_svn: true })).toBe(true);
  });
});
