import type {
  CommitRecord,
  CommitAlertRecord,
  Release,
  BuildRecord,
  DashboardOverview,
  WorkflowTask,
} from '@/types';

export const mockDashboardOverview: DashboardOverview = {
  total_releases: 120,
  success_rate: 0.95,
  pending_audit_count: 5,
  building_count: 2,
  auditing_count: 3,
  rejected_count: 1,
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

export function getCommitById(id: string): CommitRecord | undefined {
  return mockCommits.find((c) => c.id === id);
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
