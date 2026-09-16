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
  /** 生成的 tag 是否携带 _YYYYMMDD 日期段；新建仓库默认 false */
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
  /** 当前用户在该产品的成员角色（详情接口返回，超管为 manager，非成员为 null） */
  my_role?: 'manager' | 'developer' | 'tester' | 'auditor' | 'viewer' | 'software_admin' | null;
}

/** 产品统计聚合数据（/projects/stats/） */
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
  project: string;
  project_id?: string;
  project_name?: string;
  /** 仓库 ID（列表/详情返回） */
  repository?: string;
  /** 仓名称（列表接口返回） */
  repository_name?: string;
  version: string;
  tag_name: string;
  /** 关联的 Redmine 任务地址 */
  redmine_url?: string;
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
  /** 创建发布时勾选的发布后自动打包配置 id 列表（快照固定；null/undefined 表示未显式选择） */
  package_config_ids?: string[] | null;
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
  /** 待整改（open）整改意见数（列表接口返回，由后端注解聚合） */
  open_review_count?: number;
  /** 待复核（replied）整改意见数（列表接口返回，由后端注解聚合） */
  replied_review_count?: number;
  /** 发布时的基线 tag 快照（详情返回；空表示首个版本区间） */
  base_tag?: string;
  /** 整改意见聚合计数（详情返回） */
  review_issue_counts?: {
    total: number;
    open: number;
    replied: number;
    resolved: number;
  };
  /** 当前用户是否为审查员且发布已发布（可发起/判定整改，详情返回） */
  can_review?: boolean;
  /** 当前用户是否为发布人（可回复整改意见，详情返回） */
  can_reply?: boolean;
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

/** 整改意见回复 */
export interface ReleaseReviewReply {
  id: string;
  author: string;
  author_name?: string;
  content: string;
  created_at: string;
}

/** 整改意见状态：open 待整改 / replied 待复核 / resolved 已通过 */
export type ReleaseReviewStatus = 'open' | 'replied' | 'resolved';

/** 发布文档同步到 SVN 的单任务结果（update-doc 返回） */
export interface SvnSyncResult {
  task_name: string;
  remote_url: string;
  ok: boolean;
  error?: string;
}

/** 发布文档整改意见 */
export interface ReleaseReviewIssue {
  id: string;
  author: string;
  author_name?: string;
  content: string;
  status: ReleaseReviewStatus;
  status_display?: string;
  resolved_by?: string;
  resolved_by_name?: string;
  resolved_at?: string | null;
  replies: ReleaseReviewReply[];
  /** 当前用户是否为意见发起人（可判定通过/驳回） */
  can_judge?: boolean;
  created_at: string;
  updated_at: string;
}

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
  /** 是否已自动解析出更新内容（兼容字段名，包含 A/F 与 fix/feat） */
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
  /** 是否已自动解析出更新内容（兼容字段名，包含 A/F 与 fix/feat） */
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

/** AI 生成打包脚本：逐行解释项 */
export interface AIScriptExplanation {
  line: number;
  reason: string;
}

/** AI 生成打包脚本草稿结果 */
export interface AIScriptDraft {
  script: string;
  explanations: AIScriptExplanation[];
  summary: string;
  model: string;
  /** 是否成功扫描到仓库上下文 */
  repo_scanned: boolean;
  /** 仓库扫描失败时的降级提示 */
  repo_scan_warning?: string;
  /** 是否成功探测本地 Docker 镜像 */
  container_probed: boolean;
  /** 容器探测失败时的降级提示 */
  container_probe_warning?: string;
  /** 是否成功探测远程节点工具链 */
  node_probed: boolean;
  /** 节点工具探测失败时的降级提示 */
  node_probe_warning?: string;
  /** 生成时参考的历史成功脚本来源（不含脚本内容） */
  referenced_scripts?: ReferencedScript[];
}

/** AI 生成时参考的历史成功脚本来源 */
export interface ReferencedScript {
  project_name: string;
  repository_name: string;
  executor_type: string;
  version: string;
  success_count: number;
}

/** AI 生成脚本 SSE 流事件（delta 实时文本 / done 最终结果 / error 失败） */
export type AIScriptStreamEvent =
  | { type: 'progress'; message: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; data: AIScriptDraft }
  | { type: 'error'; code: number; message: string };

/** AI 生成打包脚本请求参数（支持未保存配置，project/repository 必填） */
export interface AIGenerateScriptPayload {
  project: string;
  repository: string;
  executor_type: 'local_docker' | 'remote_node';
  node?: string | null;
  /** 远程节点操作系统（决定生成 sh 还是 bat）；未传时后端按 node 落库信息补齐 */
  node_os_type?: 'windows' | 'kylin';
  image_ref?: string;
  image_info?: PackageImageInfo;
  build_path?: string;
  output_path?: string;
  auto_collect_output?: boolean;
  auto_compress?: boolean;
  env_vars?: Record<string, unknown>;
  custom_script?: string;
  hint?: string;
  /** 是否参考历史成功脚本（默认 true） */
  reference_exemplars?: boolean;
}

/** AI 打包通用知识库条目（系统级，生成脚本时注入 AI 上下文） */
export interface PackageKnowledge {
  id: string;
  title: string;
  content: string;
  is_active: boolean;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
}

/** 远程打包节点（系统级节点池，支持 Windows / 麒麟 Linux，SSH/SFTP 接入） */
export interface PackageNode {
  id: string;
  name: string;
  host: string;
  port: number;
  os_type: 'windows' | 'kylin';
  os_type_display?: string;
  /** 芯片架构 */
  arch: 'x86_64' | 'x86_32' | 'arm64' | 'arm32';
  arch_display?: string;
  credential?: string | null;
  credential_id?: string | null;
  credential_name?: string;
  work_root: string;
  /** 该节点最大并发打包数，超出任务排队等待 */
  max_concurrency?: number;
  /** 构建可用 CPU 核数，0 为不限 */
  cpu_cores?: number;
  /** 构建进程 CPU 优先级 */
  cpu_priority?: 'normal' | 'belownormal' | 'low';
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
  product_component?: string | null;
  product_component_name?: string;
  name: string;
  executor_type?: 'local_docker' | 'remote_node';
  executor_type_display?: string;
  node?: string | null;
  node_id?: string | null;
  /** 节点操作系统（只读）：节点停用不在启用列表时也能据此决定脚本语言 */
  node_os_type?: 'windows' | 'kylin' | '';
  node_name?: string;
  node_host?: string;
  image?: string | null;
  image_id?: string | null;
  image_name?: string;
  image_ref?: string;
  image_source?: PackageImageSource;
  image_info?: PackageImageInfo;
  custom_script?: string;
  /** 构建可用 CPU 核数，0 为跟随节点 */
  cpu_cores?: number;
  /** 构建进程 CPU 优先级，空为跟随节点 */
  cpu_priority?: '' | 'normal' | 'belownormal' | 'low';
  /** 构建内存上限 MB，0 为不限 */
  mem_limit_mb?: number;
  build_path?: string;
  output_path?: string;
  /** 构建完成后自动把产物目录内容归集到 artifacts */
  auto_collect_output?: boolean;
  /** 构建完成后将产物目录内所有内容压缩为单个 zip 压缩包（命名：软件名-版本-日期） */
  auto_compress?: boolean;
  env_vars?: Record<string, unknown>;
  auto_package_on_release?: boolean;
  /** 打包后清理远程工作区 */
  cleanup_workspace?: boolean;
  svn_push_enabled?: boolean;
  svn_url?: string;
  svn_credential?: string | null;
  svn_credential_id?: string | null;
  svn_credential_name?: string;
  svn_path_template?: string;
  /** SVN 提交模式：new_dir 新建版本目录（默认，已存在报错）/ overwrite 覆盖式提交 */
  svn_commit_mode?: 'new_dir' | 'overwrite';
  svn_commit_mode_display?: string;
  /** clone 时递归拉取 .gitmodules 子模块（完整克隆） */
  clone_submodules?: boolean;
  /** 注入 Git 凭证到构建环境，打包脚本可自行 git push（凭证对脚本可见） */
  inject_git_credential?: boolean;
  /** 当前用户在配置所属产品中的角色（超管返回 software_admin），用于控制配置编辑入口 */
  my_role?: string | null;
  /** 当前用户是否已收藏该配置 */
  is_favorite?: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** 收藏的打包配置（常用配置面板条目，含最近一次任务摘要） */
export interface FavoritePackageConfig {
  id: string;
  name: string;
  project_id?: string;
  project_name?: string;
  repository_id?: string;
  repository_name?: string;
  executor_type?: 'local_docker' | 'remote_node';
  executor_type_display?: string;
  image_name?: string;
  node_name?: string;
  favorited_at?: string;
  last_task: {
    id: string;
    status: PackageTaskStatus;
    status_display?: string;
    version?: string;
    finished_at?: string | null;
    duration?: number;
  } | null;
}

/** 打包任务统计（我发起的、近 N 天、仅终态任务） */
export interface PackageTaskStats {
  days: number;
  total: number;
  success: number;
  failure: number;
  canceled: number;
  /** 成功率（百分比数值，如 93.3） */
  success_rate: number;
  /** 平均耗时（秒），无终态任务时为 0 */
  avg_duration_seconds: number;
}

export interface PackageTask {
  id: string;
  config?: string | null;
  config_name?: string;
  /** 关联发布（分支直打包任务为空） */
  release: string | null;
  release_version?: string | null;
  project: string;
  project_name?: string;
  repository: string;
  repository_name?: string;
  triggered_by?: string | null;
  triggered_by_name?: string;
  name: string;
  build_type?: string;
  /** 发布类型：formal 正式 / rc / beta 测试 */
  release_type?: 'formal' | 'rc' | 'beta';
  release_type_display?: string;
  tag_name: string;
  version: string;
  commit_hash?: string;
  config_snapshot?: Record<string, unknown>;
  status: PackageTaskStatus;
  status_display?: string;
  can_push_svn?: boolean;
  progress?: number;
  stage_info?: PackageTaskStageInfo;
  artifact_info?: PackageArtifact[];
  duration?: number;
  error_message?: string;
  started_at?: string | null;
  finished_at?: string | null;
  created_at: string;
  updated_at?: string;
}

/** 打包阶段信息；SVN 推送失败不会改变打包任务的成功状态。 */
export interface PackageTaskStageInfo {
  stage?: string;
  progress?: number;
  svn_push?: PackageSvnPushInfo;
  [key: string]: unknown;
}

export interface PackageSvnPushInfo {
  status?: 'success' | 'failure';
  error_message?: string;
  remote_url?: string;
  file_count?: number;
  files?: string[];
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
  | 'ssh_password'
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

export interface RepositoryCredentialLoan {
  id: string;
  repository: string;
  repository_name?: string;
  credential: string;
  credential_name?: string;
  lender: string;
  lender_name?: string;
  allowed_products: string[];
  allowed_product_names?: string[];
  permission_scope: Array<'read' | 'create_tag' | 'delete_tag'>;
  expires_at?: string | null;
  is_active: boolean;
  valid_now?: boolean;
  revoked_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CredentialUsageLog {
  id: string;
  actor_name?: string;
  lender_name?: string;
  product_name?: string;
  repository_name?: string;
  component_name?: string;
  operation: string;
  result: 'success' | 'failure';
  failure_reason?: string;
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
  /** 被多少个产品引用 */
  product_count?: number;
  used_by_products?: Array<{
    product_id: string;
    product_name: string;
    component_id: string;
    component_code: string;
    component_name: string;
  }>;
  credential_loans?: ProductComponent['credential_loans'];
  created_by?: string | null;
  created_by_name?: string;
  owner_name?: string;
  owner_in_product?: boolean | null;
}

/** 产品与软件仓库的关联，以及该仓库在当前产品下的设置 */
export interface ProductComponent {
  id: string;
  project: string;
  repository: string;
  repository_detail: Repository;
  component_code: string;
  display_name: string;
  default_branch: string;
  source_subdir: string;
  required: boolean;
  version_scope: 'repository' | 'product_component';
  version_scope_display?: string;
  tag_namespace: string;
  product_config: Record<string, unknown>;
  sort_order: number;
  is_active: boolean;
  product_count: number;
  current_version?: string;
  current_tag?: string;
  package_configs?: Array<{ id: string; name: string; is_active: boolean }>;
  credential_status?: 'available' | 'expiring' | 'unavailable';
  owner_name?: string;
  owner_in_product?: boolean;
  credential_loans?: Array<{
    id: string;
    credential_name: string;
    lender_name: string;
    permission_scope: Array<'read' | 'create_tag' | 'delete_tag'>;
    expires_at?: string | null;
    state: 'valid' | 'expiring' | 'expired' | 'revoked';
  }>;
  created_at: string;
  updated_at: string;
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
  type: 'leader' | 'role' | 'user' | 'self' | 'repo_owner';
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
  /** 软件名：发布目标仓库名 */
  repository_name?: string;
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
  released_count: number;
}

export interface WorkflowNodeProperties {
  approver_type?: 'leader' | 'role' | 'user' | 'self' | 'repo_owner';
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
  repository?: string;
  project?: string;
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
  /** 软件名：发布目标仓库名 */
  repository_name?: string;
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
  /** 软件名：发布目标仓库名 */
  repository_name?: string;
  current_node: string;
  submit_time: string;
  version?: string;
  release_type?: ReleaseType;
  branch?: string;

  package_status?: string;
}

export interface Notification {
  id: string;
  notification_type: 'audit' | 'build' | 'release' | 'review' | 'system';
  title: string;
  content: string;
  is_read: boolean;
  read_at?: string;
  related_type: string;
  related_id: string;
  created_at: string;
}

/** 强提醒：待我审批的任务摘要 */
export interface RemindTodoTask {
  id: string;
  title: string;
  version: string;
  project_name: string;
  created_at: string;
}

/** 强提醒：待我整改的意见摘要 */
export interface RemindOpenIssue {
  id: string;
  release_id: string;
  version: string;
  content: string;
  created_at: string;
}

/** 通知强提醒汇总（待审批 + 待整改） */
export interface RemindSummary {
  todo_task_count: number;
  todo_tasks: RemindTodoTask[];
  open_issue_count: number;
  open_issues: RemindOpenIssue[];
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
