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
  permissions: string[];
  is_superuser: boolean;
}

export interface MenuItem {
  id: string;
  name: string;
  path: string;
  icon: string;
  children?: MenuItem[];
}

export type ProjectStatus = 'active' | 'inactive' | number;

/** 版本号规则：{prefix}.主.次.修(-后缀)?(_YYYYMMDD)? */
export interface VersionRule {
  prefix?: string;
  major?: number;
  minor?: number;
  patch?: number;
  suffixes?: {
    rc?: string;
    beta?: string;
  };
  /** 生成的 tag 是否携带 _YYYYMMDD 日期段，默认 true */
  with_date?: boolean;
}

export interface Project {
  id: string;
  code?: string;
  name: string;
  leader_id: string;
  leader_name?: string;
  description: string;
  status: ProjectStatus;
  repo_count?: number;
  member_count?: number;
  package_count?: number;
  release_count?: number;
  created_at: string;
  version_rule?: unknown;
  release_rule?: unknown;
  /** 当前用户在该项目的成员角色（详情接口返回，超管为 manager，非成员为 null） */
  my_role?: 'manager' | 'developer' | 'tester' | 'auditor' | 'viewer' | 'software_admin' | null;
}

/** 项目统计聚合数据（/projects/stats/） */
export interface ProjectStats {
  total: number;
  active_count: number;
  repo_total: number;
  member_total: number;
}

export type ReleaseStatus =
  | 'draft'
  | 'pending'
  | 'released'
  | 'rejected';

export type ReleaseType = 'formal' | 'rc' | 'beta';

export interface Release {
  id: string;
  project_id: string;
  project_name?: string;
  /** 仓库 ID（列表/详情返回） */
  repository?: string;
  /** 仓名称（列表接口返回） */
  repository_name?: string;
  version: string;
  tag_name: string;
  release_type: ReleaseType;
  /** 发布类型中文展示（列表接口返回） */
  release_type_display?: string;
  status: ReleaseStatus;
  /** 状态中文展示（列表接口返回） */
  status_display?: string;
  branch: string;

  git_hash: string;
  publisher: string;
  publisher_name?: string;
  /** 发布说明文档（Markdown 字符串） */
  release_doc?: string;
  related_changes?: unknown;
  updates?: unknown;
  /** 是否有配置项改动 */
  has_config_changes?: boolean;
  /** 配置项变更文档 */
  config_change_doc?: string;
  /** 是否影响其他功能 */
  impact_other?: boolean;
  /** 影响范围说明 */
  impact_desc?: string;
  /** 自测试通过 */
  self_test_passed?: boolean;
  /** 研发测试复验通过 */
  retest_passed?: boolean;
  package_tasks?: ReleasePackageTaskSummary[];
  rejected_reason?: string;
  released_at?: string;
  created_at: string;
  /** 提交审查聚合计数（列表接口返回） */
  commit_total?: number;
  pass_count?: number;
  warning_count?: number;
  illegal_count?: number;
  /** 是否已生成发布说明文档（列表接口返回） */
  has_doc?: boolean;
}

/** 发布关联的打包任务概要（release 详情 package_tasks） */
export interface ReleasePackageTaskSummary {
  id: string;
  name: string;
  status: PackageTaskStatus;
  status_display?: string;
  build_type?: string;
  artifact_count: number;
  created_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
}

/** 发布关联提交（ReleaseCommit） */
export interface ReleaseCommit {
  id: string;
  commit_id?: string;
  commit_hash: string;
  author: string;
  message: string;
  review_status: ReviewStatus;
  review_reason?: string;
  parsed_result?: Record<string, unknown>;
  committed_at: string;
  is_included?: boolean;
  edited_content?: string;
}

export type ReviewStatus = 'unreviewed' | 'pass' | 'warning' | 'illegal';

/** 提交解析结果中的单条更新内容 */
export interface ParsedUpdate {
  type?: string;
  content?: string;
  /** 来源：commit 或 mr */
  source?: 'commit' | 'mr';
  /** 来源引用（commit hash 或 MR 编号） */
  source_ref?: string;
}

/** 变更预览中的 commit 项 */
export interface PreviewCommit {
  hash: string;
  author: string;
  message: string;
  committed_at: string | null;
  has_af: boolean;
}

/** 变更预览中的 MR 项 */
export interface PreviewMergeRequest {
  number: string;
  title: string;
  description: string;
  author: string;
  source_branch: string;
  target_branch: string;
  web_url: string;
  merged_at: string | null;
  has_af: boolean;
}

/** changes-preview 接口返回结构 */
export interface ChangesPreview {
  last_tag: string | null;
  head_hash: string;
  commits: PreviewCommit[];
  merge_requests: PreviewMergeRequest[];
  parsed_updates: ParsedUpdate[];
}

/** 提交信息解析结果（CommitParser 输出） */
export interface ParsedCommit {
  change_type?: string | null;
  updates?: ParsedUpdate[];
  config_changes?: Record<string, Record<string, string>>;
  related_changes?: Record<string, string>;
  is_valid?: boolean;
  errors?: string[];
}

/** Tag 区间审查结果项（commit 或 MR） */
export interface ReviewRangeItem {
  hash?: string;
  number?: string;
  author: string;
  message: string;
  title?: string;
  description?: string;
  source_branch?: string;
  target_branch?: string;
  web_url?: string;
  committed_at?: string;
  merged_at?: string;
  review_status: ReviewStatus;
  review_reason: string;
  parsed_result?: ParsedCommit;
}

/** Tag 区间审查结果 */
export interface ReviewRangeResult {
  base: string;
  head: string;
  tags: { name: string; created_at: string | null }[];
  commits: ReviewRangeItem[];
  merge_requests: ReviewRangeItem[];
  stats: {
    total: number;
    pass: number;
    warning: number;
    mr_total: number;
  };
}

/** 主动拉取审查的单条结果（commit 或 MR） */
export interface ReviewRangeItem {
  hash?: string;
  number?: string;
  author: string;
  message: string;
  review_status: ReviewStatus;
  review_reason: string;
  parsed_result?: ParsedCommit;
  committed_at?: string;
  merged_at?: string;
  title?: string;
  description?: string;
  source_branch?: string;
  target_branch?: string;
  web_url?: string;
}

/** 主动拉取审查结果 */
export interface ReviewRangeResult {
  base: string;
  head: string;
  tags: { name: string; created_at: string | null }[];
  commits: ReviewRangeItem[];
  merge_requests: ReviewRangeItem[];
  stats: {
    total: number;
    pass: number;
    warning: number;
    mr_total: number;
  };
}

export interface CommitRecord {
  id: string;
  commit_hash: string;
  author: string;
  message: string;
  committed_at: string;
  branch: string;

  change_type: string;
  review_status: ReviewStatus;
  review_reason?: string;
  parsed_result?: ParsedCommit;
  project_name?: string;
  repo_name?: string;
}

export type PackageTaskStatus = 'queued' | 'running' | 'success' | 'failure' | 'canceled';
export type PackageImageSource = 'nexus' | 'local';

export interface PackageImage {
  id: string;
  name: string;
  source: PackageImageSource;
  source_display?: string;
  registry_host?: string;
  repository?: string;
  image_name?: string;
  image_tag?: string;
  image: string;
  script_entry: string;
  default_build_path: string;
  default_output_path: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface NexusRepository {
  name: string;
  format: string;
  type: string;
}

export interface NexusImageItem {
  name: string;
  version: string;
  repository: string;
  image: string;
}

export interface NexusImageSearchResult {
  items: NexusImageItem[];
  continuation_token: string;
}

/** 可选打包镜像条目（本地 Docker / Nexus 聚合列表） */
export interface AvailableImageItem {
  source: PackageImageSource;
  image: string;
  name: string;
  version: string;
  repository: string;
  registry_host: string;
  image_id?: string;
  size?: string;
}

export interface AvailableImageResult {
  items: AvailableImageItem[];
  errors: Partial<Record<PackageImageSource, string>>;
}

/** 打包配置提交时携带的镜像坐标 */
export interface PackageImageInfo {
  source: PackageImageSource;
  registry_host?: string;
  repository?: string;
  image_name: string;
  image_tag: string;
}

/** 远程打包节点（系统级节点池，当前支持 Windows，SSH/SFTP 接入） */
export interface PackageNode {
  id: string;
  name: string;
  host: string;
  port: number;
  os_type: 'windows';
  os_type_display?: string;
  credential?: string | null;
  credential_id?: string | null;
  credential_name?: string;
  work_root: string;
  description?: string;
  is_active: boolean;
  created_by?: string | null;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
}

/** 打包节点连通性测试结果 */
export interface PackageNodeTestResult {
  ok: boolean;
  os?: string;
  git?: string;
  work_root_ready?: boolean;
}

export interface PackageConfig {
  id: string;
  project: string;
  project_id?: string;
  project_name?: string;
  repository: string;
  repository_id?: string;
  repository_name?: string;
  name: string;
  executor_type?: 'local_docker' | 'remote_windows';
  executor_type_display?: string;
  node?: string | null;
  node_id?: string | null;
  node_name?: string;
  node_host?: string;
  image?: string | null;
  image_id?: string | null;
  image_name?: string;
  image_ref?: string;
  image_source?: PackageImageSource;
  image_info?: PackageImageInfo;
  custom_script?: string;
  build_path?: string;
  output_path?: string;
  env_vars?: Record<string, unknown>;
  auto_package_on_release?: boolean;
  svn_push_enabled?: boolean;
  svn_url?: string;
  svn_credential?: string | null;
  svn_credential_id?: string | null;
  svn_credential_name?: string;
  svn_path_template?: string;
  /** 当前用户在配置所属项目中的角色（超管返回 software_admin），用于控制配置编辑入口 */
  my_role?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PackageTask {
  id: string;
  config?: string | null;
  config_name?: string;
  release: string;
  release_version?: string;
  project: string;
  project_name?: string;
  repository: string;
  repository_name?: string;
  triggered_by?: string | null;
  triggered_by_name?: string;
  name: string;
  build_type?: string;
  tag_name: string;
  version: string;
  commit_hash?: string;
  config_snapshot?: Record<string, unknown>;
  status: PackageTaskStatus;
  status_display?: string;
  can_push_svn?: boolean;
  progress?: number;
  stage_info?: { stage?: string; progress?: number } | Record<string, unknown>;
  artifact_info?: PackageArtifact[];
  duration?: number;
  error_message?: string;
  started_at?: string | null;
  finished_at?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface PackageArtifact {
  id: string;
  name: string;
  path: string;
  size: number;
  sha256: string;
}

/** SVN 目录条目（svn list 实时查询结果） */
export interface SvnEntry {
  name: string;
  kind: 'dir' | 'file';
  size: number;
  revision: string;
  author: string;
  date?: string | null;
}

/** SVN 目录浏览接口返回数据 */
export interface SvnEntriesData {
  base_url: string;
  path: string;
  entries: SvnEntry[];
}

export type CredentialType =
  | 'gitlab_token'
  | 'svn_password'
  | 'ldap_password'
  | 'windows_password'
  | 'ai_api_key';

export interface Credential {
  id: string;
  name: string;
  cred_type: CredentialType;
  auth_mode: string;
  username?: string;
  masked_data: string;
  expires_at?: string;
  owner?: string;
  owner_name?: string;
  /** SVN 凭证为 true：全系统共享，所有用户可用；其余为个人凭证 */
  is_system_shared: boolean;
  is_active: boolean;
  last_used_at?: string;
  created_at: string;
}

export interface Repository {
  id: string;
  project?: string;
  project_id?: string;
  project_name?: string;
  repo_type: 'git' | 'svn';
  vendor: string;
  name: string;
  url: string;
  clone_url?: string;
  external_identity: string;
  default_branch: string;
  version_rule?: VersionRule;
  credential_id?: string;
  credential_mode?: string;
  credential_mode_display?: string;
  credential_name?: string;
  credential_owner_name?: string;
  health_status: 'healthy' | 'unhealthy' | 'unknown';
  last_sync_at?: string;
  created_at: string;
}

/** 仓库统计聚合数据（/repositories/stats/） */
export interface RepositoryStats {
  total: number;
  healthy_count: number;
  git_count: number;
  svn_count: number;
}

/** 仓库合规扫描统计（/repositories/compliance-stats/）单行 */
export interface RepoComplianceStat {
  id: string;
  name: string;
  project_id: string;
  project_name: string;
  repo_type: 'git' | 'svn';
  vendor: string;
  default_branch: string;
  health_status: 'healthy' | 'unhealthy' | 'unknown';
  last_sync_at?: string | null;
  commit_total: number;
  pass_count: number;
  warning_count: number;
  illegal_count: number;
  unreviewed_count: number;
}


/** 仓库分支信息 */
export interface RepositoryBranch {
  name: string;
  is_default: boolean;
  last_commit_hash?: string;
  last_commit_author?: string;
  last_commit_message?: string;
  last_commit_at?: string | null;
}

/** 仓库标签信息 */
export interface RepositoryTag {
  name: string;
  commit_hash?: string | null;
  created_at?: string | null;
}

export type WorkflowTaskStatus = 'pending' | 'approved' | 'rejected' | 'transferred' | 'rollbacked';

export interface WorkflowApproverConfig {
  type: 'leader' | 'role' | 'user' | 'self';
  user_id?: string;
  role?: string;
}

export interface WorkflowNodeConfig {
  node_id: string;
  node_name: string;
  approvers: WorkflowApproverConfig[];
  mode: 'any' | 'all';
}

export interface WorkflowTask {
  id: string;
  instance?: string;
  node_id?: string;
  node_name?: string;
  title: string;
  applicant: string;
  project_name: string;
  current_node: string;
  submit_time: string;
  remaining_time?: string;
  status: WorkflowTaskStatus;
  version?: string;
  release_type?: ReleaseType;
  branch?: string;

  package_status?: string;
  mode?: 'any' | 'all';
  is_rollback?: boolean;
  rollback_target_node_id?: string;
  comment?: string;
  action_time?: string;
  approver?: string;
  approver_name?: string;
  approver_username?: string;
  transferred_from?: string;
  transferred_from_name?: string;
  created_at?: string;
  updated_at?: string;
}

export interface DashboardOverview {
  total_releases: number;
  success_rate: number;
  pending_audit_count: number;
  rejected_count: number;
}

export interface WorkflowNodeProperties {
  approver_type?: 'leader' | 'role' | 'user' | 'self';
  role?: string;
  user_id?: string;
}

export interface WorkflowNode {
  id: string;
  type: 'start-node' | 'approval-node' | 'end-node' | string;
  x: number;
  y: number;
  text?: string | { value: string };
  properties?: WorkflowNodeProperties;
}

export interface WorkflowEdge {
  id?: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  source?: string;
  target?: string;
}

export interface WorkflowDefinition {
  id: string;
  project: string;
  name: string;
  biz_type: string;
  release_type: 'formal' | 'rc' | 'beta';
  node_config: WorkflowNodeConfig[];
  graph_data: {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
  };
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkflowInstance {
  id: string;
  definition: string;
  definition_name?: string;
  biz_type: string;
  biz_id: string;
  status: 'running' | 'completed' | 'rejected' | 'revoked';
  current_node_id: string;
  node_status: Record<string, string>;
  graph_data: WorkflowDefinition['graph_data'];
  tasks: WorkflowTask[];
  created_by: string;
  created_at: string;
  completed_at?: string;
  title?: string;
  applicant?: string;
  project_name?: string;
  current_node?: string;
  submit_time?: string;
  version?: string;
  release_type?: ReleaseType;
  branch?: string;
  package_status?: string;
  git_hash?: string;
  tag_name?: string;
  release_doc?: string;
}

/**
 * 工作流实例列表项（轻量）
 *
 * 「我发起的」接口返回，字段与审批任务列表兼容，便于在列表中统一渲染。
 */
export interface WorkflowInstanceListItem {
  id: string;
  definition: string;
  biz_type: string;
  biz_id: string;
  status: 'running' | 'completed' | 'rejected' | 'revoked';
  current_node_id: string;
  created_by: string;
  created_at: string;
  completed_at?: string;
  title: string;
  applicant: string;
  project_name: string;
  current_node: string;
  submit_time: string;
  version?: string;
  release_type?: ReleaseType;
  branch?: string;

  package_status?: string;
}

export interface Notification {
  id: string;
  notification_type: 'audit' | 'build' | 'release' | 'system';
  title: string;
  content: string;
  is_read: boolean;
  read_at?: string;
  related_type: string;
  related_id: string;
  created_at: string;
}

export type FeedbackCategory = 'suggestion' | 'bug' | 'experience' | 'other';

export type FeedbackStatus = 'open' | 'processed';

export interface Feedback {
  id: string;
  title: string;
  content: string;
  category: FeedbackCategory;
  created_by: string;
  created_by_name: string;
  like_count: number;
  liked: boolean;
  status: FeedbackStatus;
  processed_by: string | null;
  processed_by_name: string;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}
