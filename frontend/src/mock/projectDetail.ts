export const mockProjectRepos = [
  { id: '1', name: '后端代码仓库', type: 'gitlab', defaultBranch: 'develop', credential: 'GitLab 管理员', health: 'healthy' },
  { id: '2', name: '前端代码仓库', type: 'gitea', defaultBranch: 'main', credential: 'Gitea 管理员', health: 'healthy' },
];

export const mockProjectMembers = [
  { id: '1', name: '张三', department: '研发部', role: 'manager', joinTime: '2026-01-15' },
  { id: '2', name: '李四', department: '测试部', role: 'tester', joinTime: '2026-02-01' },
  { id: '3', name: '王五', department: '运维部', role: 'developer', joinTime: '2026-03-10' },
];

export const projectRoleMap: Record<string, string> = {
  manager: '项目负责人',
  tester: '测试人员',
  developer: '开发工程师',
};

export const mockProjectWorkflows = [
  { id: '1', name: '正式发布审批流', bizType: 'release', version: 'v1', active: true },
  { id: '2', name: '测试版本审批流', bizType: 'release', version: 'v1', active: false },
];

export const mockProjectReleases = [
  { id: '1', version: 'v2.4.1', type: 'formal', status: 'released', time: '2026-06-15' },
  { id: '2', version: 'v2.4.0', type: 'formal', status: 'released', time: '2026-06-10' },
];

export const projectRuleInitialValues = {
  versionRule: 'VA.{major}.{minor}.{patch}',
  releaseCycle: 3,
  formalBranch: 'main',
  testPrefix: 'test',
  complianceThreshold: 90,
};
