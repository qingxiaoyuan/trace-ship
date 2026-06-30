import type { Repository } from '@/types';

export const mockRepositories: Repository[] = [
  {
    id: '1',
    project_id: '1',
    project_name: '核心交易平台',
    repo_type: 'git',
    vendor: 'gitlab',
    name: '后端代码仓库',
    url: 'https://gitlab.example.com/core/backend.git',
    external_identity: 'core/backend',
    default_branch: 'develop',
    credential_mode: 'project',
    health_status: 'healthy',
    last_sync_at: '2026-06-22T10:00:00+08:00',
    created_at: '2026-01-15T10:00:00+08:00',
  },
  {
    id: '2',
    project_id: '1',
    project_name: '核心交易平台',
    repo_type: 'git',
    vendor: 'gitea',
    name: '前端代码仓库',
    url: 'https://gitea.example.com/core/frontend.git',
    external_identity: 'core/frontend',
    default_branch: 'main',
    credential_mode: 'project',
    health_status: 'healthy',
    last_sync_at: '2026-06-21T10:00:00+08:00',
    created_at: '2026-02-01T10:00:00+08:00',
  },
];

export const repoTypeOptions = [
  { label: 'Git', value: 'git' },
  { label: 'SVN', value: 'svn' },
];

export const vendorOptions = [
  { label: 'GitLab', value: 'gitlab' },
  { label: 'Gitea', value: 'gitea' },
  { label: 'SVN', value: 'svn' },
];
