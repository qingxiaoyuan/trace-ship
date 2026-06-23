import type {
  CommitRecord,
  CommitAlertRecord,
  AIReviewResult,
  Release,
  BuildRecord,
  DashboardOverview,
  WorkflowTask,
} from '@/types';

export const mockDashboardOverview: DashboardOverview = {
  total_releases: 120,
  success_rate: 0.95,
  pending_audit_count: 5,
  upcoming_releases: 3,
};

export const mockRecentReleases: Release[] = [
  { id: '1', project_id: '1', project_name: '核心交易平台', version: 'v2.4.1', tag_name: 'v2.4.1', release_type: 'formal', status: 'released', source_branch: 'develop', target_branch: 'main', git_hash: 'abc123', publisher: '张三', created_at: '2026-06-15T10:00:00+08:00' },
  { id: '2', project_id: '1', project_name: '核心交易平台', version: 'v2.4.1-test.3', tag_name: 'v2.4.1-test.3', release_type: 'test', status: 'building', source_branch: 'develop', target_branch: 'main', git_hash: 'def456', publisher: '李四', created_at: '2026-06-14T10:00:00+08:00' },
  { id: '3', project_id: '2', project_name: '数据中台', version: 'v2.3.9', tag_name: 'v2.3.9', release_type: 'formal', status: 'released', source_branch: 'develop', target_branch: 'main', git_hash: 'ghi789', publisher: '王五', created_at: '2026-06-10T10:00:00+08:00' },
];

export const mockCommits: CommitRecord[] = [
  {
    id: '1',
    commit_hash: '271b688781e11ce76090b0ff1d281ec8d1dcd991',
    author: '张三',
    message: '变更类型：A\n更新内容：移除干扰用户绑定数据采集(DA)的逻辑',
    committed_at: '2026-06-20T10:00:00+08:00',
    branch: 'develop',
    change_type: 'A类',
    review_status: 'pass',
    project_name: '核心交易平台',
    repo_name: 'trade-core',
  },
  {
    id: '2',
    commit_hash: '8f3a2b1c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0',
    author: '李四',
    message: '变更类型：F\n更新内容：信号定时开关新增清除指令并优化控制逻辑',
    committed_at: '2026-06-19T10:00:00+08:00',
    branch: 'develop',
    change_type: 'F类',
    review_status: 'warning',
    ai_suggestion: '配置项改动格式不标准，建议统一为 [System] 段落格式。',
    project_name: '核心交易平台',
    repo_name: 'trade-config',
  },
  {
    id: '3',
    commit_hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
    author: '王五',
    message: '修复登录异常',
    committed_at: '2026-06-18T10:00:00+08:00',
    branch: 'develop',
    change_type: '-',
    review_status: 'illegal',
    ai_suggestion: '缺少变更类型标记，请补充变更类型。',
    project_name: '核心交易平台',
    repo_name: 'trade-gateway',
  },
  {
    id: '4',
    commit_hash: 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1',
    author: '赵六',
    message: '变更类型：A\n更新内容：订单查询接口增加本地缓存，降低 DB 压力',
    committed_at: '2026-06-17T14:30:00+08:00',
    branch: 'main',
    change_type: 'A类',
    review_status: 'pass',
    project_name: '数据中台',
    repo_name: 'data-hub',
  },
  {
    id: '5',
    commit_hash: 'c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2',
    author: '李四',
    message: '[System] 更新支付网关配置，调整超时时间为 5s',
    committed_at: '2026-06-16T09:20:00+08:00',
    branch: 'develop',
    change_type: 'F类',
    review_status: 'warning',
    ai_suggestion: '配置项改动格式不标准，建议统一为 [System] 段落格式。',
    project_name: '核心交易平台',
    repo_name: 'trade-pay',
  },
  {
    id: '6',
    commit_hash: 'd4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3',
    author: '张三',
    message: 'fix bug',
    committed_at: '2026-06-15T11:00:00+08:00',
    branch: 'develop',
    change_type: '-',
    review_status: 'illegal',
    ai_suggestion: '缺少变更类型标记，请补充变更类型。',
    project_name: '数据中台',
    repo_name: 'data-etl',
  },
  {
    id: '7',
    commit_hash: 'e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4',
    author: '王五',
    message: '变更类型：A\n更新内容：用户权限校验增加白名单校验',
    committed_at: '2026-06-14T16:45:00+08:00',
    branch: 'feature/auth',
    change_type: 'A类',
    review_status: 'pass',
    project_name: '运维门户',
    repo_name: 'ops-portal',
  },
  {
    id: '8',
    commit_hash: 'f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5',
    author: '李四',
    message: 'config: 调整限流阈值',
    committed_at: '2026-06-13T08:10:00+08:00',
    branch: 'develop',
    change_type: '-',
    review_status: 'illegal',
    ai_suggestion: '配置项改动缺少 [System] 标记，请补充变更类型与影响范围。',
    project_name: '核心交易平台',
    repo_name: 'trade-config',
  },
];

export const mockCommitAlerts: CommitAlertRecord[] = [
  {
    ...mockCommits[2],
    illegal_reason: '缺少变更类型标记',
    alert_status: 'pending',
  },
  {
    ...mockCommits[5],
    illegal_reason: 'Commit message 过短，缺少变更类型',
    alert_status: 'pending',
  },
  {
    ...mockCommits[7],
    illegal_reason: '配置项改动缺少 [System] 标记',
    alert_status: 'pending',
  },
  {
    ...mockCommits[1],
    illegal_reason: '配置项改动格式不标准',
    alert_status: 'resolved',
  },
  {
    ...mockCommits[4],
    illegal_reason: '配置项改动未说明影响范围',
    alert_status: 'ignored',
  },
];

export const mockAIReviews: Record<string, AIReviewResult> = {
  '1': {
    conclusion: '该提交符合规范要求。变更类型、描述清晰度、影响范围均完整，可直接纳入发布流程。',
    suggestions: [
      { text: '变更类型标记完整，符合 [A] 类规范', type: 'success' },
      { text: '描述清晰，影响模块明确', type: 'success' },
    ],
    impacts: [
      { module: 'trade-core', level: 'direct' },
      { module: 'trade-gateway', level: 'none' },
      { module: 'data-hub', level: 'none' },
    ],
    risk_level: 'low',
    scores: { completeness: 95, clarity: 92, risk_control: 96 },
    tip: '该提交规范完整，风险可控，建议正常发布。',
  },
  '2': {
    conclusion: '配置项改动格式不标准，建议统一为 [System] 段落格式，并补充影响范围说明。',
    suggestions: [
      { text: '缺少 [System] 段落标记，建议标题使用 [System] 开头', type: 'warning' },
      { text: '配置影响范围描述不够清晰，需说明涉及哪些环境', type: 'warning' },
    ],
    impacts: [
      { module: 'trade-config', level: 'direct' },
      { module: 'trade-pay', level: 'direct' },
      { module: 'trade-core', level: 'none' },
    ],
    risk_level: 'medium',
    scores: { completeness: 72, clarity: 65, risk_control: 78 },
    tip: '涉及配置项改动，请在发布前由测试负责人复核，避免影响线上环境。',
  },
  '3': {
    conclusion: '缺少变更类型标记，请补充变更类型后再提交；Commit message 过短，无法判断影响范围。',
    suggestions: [
      { text: '未识别到 [A]/[F] 等变更类型前缀，不符合提交规范', type: 'danger' },
      { text: 'Commit message 过短，缺少更新内容说明', type: 'danger' },
    ],
    impacts: [
      { module: 'trade-gateway', level: 'direct' },
      { module: 'trade-core', level: 'direct' },
      { module: 'data-hub', level: 'none' },
    ],
    risk_level: 'high',
    scores: { completeness: 35, clarity: 40, risk_control: 30 },
    tip: '该提交不符合规范，不可纳入发布，请整改后重新提交。',
  },
  '4': {
    conclusion: '该提交符合规范要求。变更类型明确，描述完整。',
    suggestions: [
      { text: '变更类型 [A] 已正确标记', type: 'success' },
      { text: '更新内容与影响范围描述清晰', type: 'success' },
    ],
    impacts: [
      { module: 'data-hub', level: 'direct' },
      { module: 'trade-core', level: 'none' },
    ],
    risk_level: 'low',
    scores: { completeness: 94, clarity: 90, risk_control: 93 },
    tip: '该提交规范完整，风险可控，建议正常发布。',
  },
  '5': {
    conclusion: '配置项改动已使用 [System] 标记，但缺少影响环境说明，建议补充后再发布。',
    suggestions: [
      { text: '已使用 [System] 标记，格式正确', type: 'success' },
      { text: '建议补充影响环境（线上/预发/测试）说明', type: 'warning' },
    ],
    impacts: [
      { module: 'trade-pay', level: 'direct' },
      { module: 'trade-core', level: 'none' },
    ],
    risk_level: 'medium',
    scores: { completeness: 78, clarity: 70, risk_control: 82 },
    tip: '配置改动建议由发布负责人二次确认后纳入发布。',
  },
  '6': {
    conclusion: 'Commit message 过短且缺少变更类型，无法完成规范审查。',
    suggestions: [
      { text: '缺少变更类型前缀', type: 'danger' },
      { text: '缺少更新内容描述', type: 'danger' },
    ],
    impacts: [
      { module: 'data-etl', level: 'direct' },
      { module: 'data-hub', level: 'none' },
    ],
    risk_level: 'high',
    scores: { completeness: 30, clarity: 35, risk_control: 28 },
    tip: '该提交不符合规范，不可纳入发布，请整改后重新提交。',
  },
  '7': {
    conclusion: '该提交符合规范要求，影响模块明确。',
    suggestions: [
      { text: '变更类型 [A] 完整', type: 'success' },
      { text: '权限校验改动需关注回归范围', type: 'warning' },
    ],
    impacts: [
      { module: 'ops-portal', level: 'direct' },
      { module: 'trade-core', level: 'none' },
    ],
    risk_level: 'low',
    scores: { completeness: 91, clarity: 88, risk_control: 90 },
    tip: '建议补充一条测试用例覆盖白名单校验逻辑。',
  },
  '8': {
    conclusion: '配置项改动缺少 [System] 标记，且未说明影响范围，不符合规范。',
    suggestions: [
      { text: '缺少 [System] 标记', type: 'danger' },
      { text: '配置项改动未说明影响范围与环境', type: 'danger' },
    ],
    impacts: [
      { module: 'trade-config', level: 'direct' },
      { module: 'trade-pay', level: 'direct' },
    ],
    risk_level: 'high',
    scores: { completeness: 42, clarity: 45, risk_control: 38 },
    tip: '配置项改动需严格遵循 [System] 格式并说明影响范围。',
  },
};

export function getCommitById(id: string): CommitRecord | undefined {
  return mockCommits.find((c) => c.id === id);
}

export function getAIReviewByCommitId(id: string): AIReviewResult | undefined {
  return mockAIReviews[id];
}

export const mockBuildRecords: BuildRecord[] = [
  { id: '1', job_id: 'j1', job_name: '后端打包任务', build_number: 128, version: 'v2.4.1', status: 'success', started_at: '2026-06-15T10:00:00+08:00', finished_at: '2026-06-15T10:05:00+08:00', duration: '5分12秒' },
  { id: '2', job_id: 'j2', job_name: '前端打包任务', build_number: 89, version: 'v2.4.1-test.3', status: 'building', started_at: '2026-06-14T10:00:00+08:00', duration: '进行中' },
  { id: '3', job_id: 'j1', job_name: '后端打包任务', build_number: 127, version: 'v2.4.0', status: 'failure', started_at: '2026-06-10T10:00:00+08:00', finished_at: '2026-06-10T10:03:00+08:00', duration: '3分45秒' },
];

export const mockBuildLog = `Started by user 张三
Building in workspace /var/jenkins/workspace/backend-build
> git rev-parse --is-inside-work-tree # timeout=10
> git fetch --tags --progress origin
> git checkout -f abc123
Running build script...
[Pipeline] stage
[Pipeline] { (Build)
> npm run build
Build completed successfully.
[Pipeline] // stage
[Pipeline] End of Pipeline
Finished: SUCCESS`;

export const mockWorkflowTasks: WorkflowTask[] = [
  { id: '1', title: '审批发布 v2.5.0', applicant: '李四', project_name: '核心交易平台', current_node: '项目负责人审批', submit_time: '2026-06-22T09:50:00+08:00', remaining_time: '2小时', status: 'pending', version: 'v2.5.0', release_type: 'formal', source_branch: 'master' },
  { id: '2', title: '审批发布 v2.4.2-test.1', applicant: '王五', project_name: '核心交易平台', current_node: '测试负责人审批', submit_time: '2026-06-22T09:00:00+08:00', remaining_time: '5小时', status: 'pending', version: 'v2.4.2-test.1', release_type: 'test', source_branch: 'develop' },
];

export const mockDoneTasks: WorkflowTask[] = [
  { id: '3', title: '审批发布 v2.4.1', applicant: '李四', project_name: '核心交易平台', current_node: '-', submit_time: '2026-06-15T10:00:00+08:00', status: 'approved', version: 'v2.4.1', release_type: 'formal', source_branch: 'master' },
];

export const mockTodoList = [
  { title: '审批发布 v2.5.0', applicant: '李四', time: '10 分钟前' },
  { title: '审批发布 v2.4.2-test.1', applicant: '王五', time: '1 小时前' },
];

export const reviewStatusOptions = [
  { label: '合规', value: 'pass' },
  { label: '警告', value: 'warning' },
  { label: '不合规', value: 'illegal' },
];

export const releaseStatusOptions = [
  { label: '已发布', value: 'released' },
  { label: '构建中', value: 'building' },
  { label: '审批中', value: 'auditing' },
  { label: '草稿', value: 'draft' },
  { label: '已驳回', value: 'rejected' },
];

export const releaseTypeOptions = [
  { label: '正式', value: 'formal' },
  { label: '测试', value: 'test' },
];

export const buildStatusOptions = [
  { label: '排队中', value: 'queue' },
  { label: '构建中', value: 'building' },
  { label: '成功', value: 'success' },
  { label: '失败', value: 'failure' },
  { label: '中止', value: 'aborted' },
];

export const changeTypeOptions = [
  { label: 'A类', value: 'A类' },
  { label: 'F类', value: 'F类' },
];
