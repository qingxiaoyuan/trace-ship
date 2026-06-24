import type { Credential } from '@/types';

export const mockCredentials: Credential[] = [
  {
    id: '1',
    name: 'GitLab 管理员',
    cred_type: 'gitlab_token',
    auth_mode: 'token',
    masked_data: 'glpa****abcd',
    expires_at: '2027-06-01T10:00:00+08:00',
    scope: 'project',
    project_id: '1',
    project_name: '核心交易平台',
    is_active: true,
    last_used_at: '2026-06-22T10:00:00+08:00',
    created_at: '2026-01-15T10:00:00+08:00',
  },
  {
    id: '2',
    name: 'Jenkins 构建 Token',
    cred_type: 'jenkins_token',
    auth_mode: 'token',
    masked_data: 'jenkins****xyz',
    expires_at: '2026-07-01T10:00:00+08:00',
    scope: 'global',
    is_active: true,
    last_used_at: '2026-06-21T10:00:00+08:00',
    created_at: '2026-02-01T10:00:00+08:00',
  },
];

export const credentialTypeMap: Record<string, string> = {
  gitlab_token: 'GitLab Token',
  gitea_token: 'Gitea Token',
  svn_password: 'SVN',
  jenkins_token: 'Jenkins',
  ldap_password: 'LDAP',
};

export const credentialScopeMap: Record<string, string> = {
  personal: '个人',
  project: '项目',
  global: '全局',
};

export const credentialTypeOptions = Object.entries(credentialTypeMap).map(([value, label]) => ({
  value,
  label,
}));

export const credentialScopeOptions = Object.entries(credentialScopeMap).map(([value, label]) => ({
  value,
  label,
}));
