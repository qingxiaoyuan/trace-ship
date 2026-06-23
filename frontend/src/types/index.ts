export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

export interface PaginatedData<T> {
  total: number;
  page: number;
  page_size: number;
  results: T[];
}

export interface LoginParams {
  username: string;
  password: string;
}

export interface LoginData {
  user_id: string;
  username: string;
  nickname: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface UserInfo {
  id: string;
  username: string;
  nickname: string;
  email: string;
  department: string;
  source: string;
  roles: string[];
  is_superuser: boolean;
}

export interface MenuItem {
  id: string;
  name: string;
  path: string;
  icon: string;
  children?: MenuItem[];
}

export type ProjectStatus = 'active' | 'inactive';

export interface Project {
  id: string;
  code: string;
  name: string;
  leader_id: string;
  leader_name?: string;
  description: string;
  status: ProjectStatus;
  repo_count?: number;
  member_count?: number;
  created_at: string;
  version_rule?: string;
  release_cycle?: string;
  formal_branch?: string;
  test_prefix?: string;
  compliance_threshold?: number;
}

export type ReleaseStatus =
  | 'draft'
  | 'pending'
  | 'building'
  | 'auditing'
  | 'released'
  | 'rejected';

export type ReleaseType = 'formal' | 'test';

export interface Release {
  id: string;
  project_id: string;
  project_name?: string;
  version: string;
  tag_name: string;
  release_type: ReleaseType;
  status: ReleaseStatus;
  source_branch: string;
  target_branch: string;
  git_hash: string;
  publisher: string;
  created_at: string;
}

export type ReviewStatus = 'pass' | 'warning' | 'illegal';

export interface CommitRecord {
  id: string;
  commit_hash: string;
  author: string;
  message: string;
  committed_at: string;
  branch: string;
  change_type: string;
  review_status: ReviewStatus;
  ai_suggestion?: string;
}

export type BuildStatus = 'queue' | 'building' | 'success' | 'failure' | 'aborted';

export interface BuildRecord {
  id: string;
  job_id: string;
  job_name: string;
  build_number: number;
  version: string;
  status: BuildStatus;
  started_at: string;
  finished_at?: string;
  duration?: string;
}

export type CredentialType =
  | 'gitlab_token'
  | 'gitea_token'
  | 'svn_password'
  | 'jenkins_token'
  | 'ldap_password'
  | 'ai_api_key';

export type CredentialScope = 'personal' | 'project' | 'global';

export interface Credential {
  id: string;
  name: string;
  cred_type: CredentialType;
  auth_mode: string;
  username?: string;
  masked_data: string;
  expires_at?: string;
  scope: CredentialScope;
  project_id?: string;
  project_name?: string;
  is_active: boolean;
  last_used_at?: string;
  created_at: string;
}

export interface Repository {
  id: string;
  project_id: string;
  project_name?: string;
  integration_id?: string;
  repo_type: 'git' | 'svn';
  vendor: string;
  name: string;
  url: string;
  external_identity: string;
  default_branch: string;
  credential_id?: string;
  credential_mode?: string;
  health_status: 'healthy' | 'unhealthy' | 'unknown';
  last_sync_at?: string;
  created_at: string;
}

export type WorkflowTaskStatus = 'pending' | 'approved' | 'rejected' | 'transferred';

export interface WorkflowTask {
  id: string;
  title: string;
  applicant: string;
  project_name: string;
  current_node: string;
  submit_time: string;
  remaining_time?: string;
  status: WorkflowTaskStatus;
}

export interface DashboardOverview {
  total_releases: number;
  success_rate: number;
  pending_audit_count: number;
  upcoming_releases: number;
}
