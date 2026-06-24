import type { AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

type MockBody = Record<string, unknown>;

interface MockRoute {
  method: string;
  path: string | RegExp;
  handler: (config: AxiosRequestConfig) => { data: unknown; status?: number } | undefined;
}

function getBody(config: AxiosRequestConfig): MockBody {
  return (typeof config.data === 'object' && config.data !== null ? config.data : {}) as MockBody;
}

function createResponse<T>(data: T) {
  return { code: 0, message: 'success', data };
}

function createPaginatedResponse<T>(
  items: T[],
  page = 1,
  pageSize = 20,
  ordering?: string
) {
  const results = [...items];
  if (ordering) {
    const isDesc = ordering.startsWith('-');
    const field = ordering.replace(/^-/, '');
    results.sort((a, b) => {
      const va = (a as Record<string, unknown>)[field];
      const vb = (b as Record<string, unknown>)[field];
      if ((va as string | number) < (vb as string | number)) return isDesc ? 1 : -1;
      if ((va as string | number) > (vb as string | number)) return isDesc ? -1 : 1;
      return 0;
    });
  }
  const total = results.length;
  const start = (page - 1) * pageSize;
  return createResponse({
    total,
    page,
    page_size: pageSize,
    results: results.slice(start, start + pageSize),
  });
}

function getParams(config: AxiosRequestConfig) {
  const url = new URL(config.url || '', 'http://localhost');
  return {
    page: parseInt(url.searchParams.get('page') || '1', 10),
    page_size: parseInt(url.searchParams.get('page_size') || '20', 10),
    ordering: url.searchParams.get('ordering') || undefined,
    keyword: url.searchParams.get('keyword') || undefined,
    status: url.searchParams.get('status') || undefined,
    project_id: url.searchParams.get('project_id') || undefined,
    repo_type: url.searchParams.get('repo_type') || undefined,
    vendor: url.searchParams.get('vendor') || undefined,
    cred_type: url.searchParams.get('cred_type') || undefined,
    scope: url.searchParams.get('scope') || undefined,
    review_status: url.searchParams.get('review_status') || undefined,
    repository_id: url.searchParams.get('repository_id') || undefined,
    branch: url.searchParams.get('branch') || undefined,
    author: url.searchParams.get('author') || undefined,
    release_type: url.searchParams.get('release_type') || undefined,
    version: url.searchParams.get('version') || undefined,
    publisher_id: url.searchParams.get('publisher_id') || undefined,
    since: url.searchParams.get('since') || undefined,
    until: url.searchParams.get('until') || undefined,
    days: url.searchParams.get('days') || undefined,
  };
}

function matchPath(pattern: string | RegExp, url: string) {
  const cleanUrl = url.split('?')[0];
  if (typeof pattern === 'string') {
    if (pattern.includes(':')) {
      const regex = new RegExp('^' + pattern.replace(/:[^/]+/g, '([^/]+)') + '$');
      return regex.test(cleanUrl);
    }
    return cleanUrl === pattern;
  }
  // 对正则模式做锚定，避免子路径被提前匹配（如 /instances/:id/progress 被 /instances/:id/ 匹配）
  const source = pattern.source;
  const anchoredSource = (source.startsWith('^') ? '' : '^') + source + (source.endsWith('$') ? '' : '$');
  return new RegExp(anchoredSource).test(cleanUrl);
}

function extractParams(pattern: string, url: string) {
  const cleanUrl = url.split('?')[0];
  const keys = (pattern.match(/:[^/]+/g) || []).map((k) => k.slice(1));
  const regex = new RegExp('^' + pattern.replace(/:[^/]+/g, '([^/]+)') + '$');
  const values = cleanUrl.match(regex)?.slice(1) || [];
  const params: Record<string, string> = {};
  keys.forEach((key, i) => (params[key] = values[i]));
  return params;
}

// Mock data stores
const projects = [
  {
    id: '1',
    code: 'CORE_TRADE',
    name: '核心交易平台',
    leader_id: 'u1',
    leader_name: '张三',
    description: '核心交易业务系统',
    status: 1,
    repo_count: 5,
    member_count: 12,
    created_at: '2026-01-15T10:00:00+08:00',
    version_rule: { format: 'VA.{major}.{minor}.{patch}', initial: 'VA.1.0.0' },
    release_rule: { formal_branch: 'main', test_prefix: 'test', release_cycle_days: 3 },
  },
  {
    id: '2',
    code: 'DATA_MIDDLE',
    name: '数据中台',
    leader_id: 'u2',
    leader_name: '李四',
    description: '数据中台服务',
    status: 1,
    repo_count: 3,
    member_count: 8,
    created_at: '2026-02-20T10:00:00+08:00',
    version_rule: { format: 'VA.{major}.{minor}.{patch}', initial: 'VA.1.0.0' },
    release_rule: { formal_branch: 'main', test_prefix: 'test', release_cycle_days: 7 },
  },
  {
    id: '3',
    code: 'PAY_GATE',
    name: '支付网关',
    leader_id: 'u3',
    leader_name: '王五',
    description: '支付网关系统',
    status: 0,
    repo_count: 2,
    member_count: 6,
    created_at: '2026-03-10T10:00:00+08:00',
    version_rule: { format: 'VA.{major}.{minor}.{patch}', initial: 'VA.1.0.0' },
    release_rule: { formal_branch: 'main', test_prefix: 'test', release_cycle_days: 14 },
  },
];

const projectMembers = [
  { id: 'm1', user: { id: 'u1', username: 'zhangsan', nickname: '张三' }, role: 'manager', created_at: '2026-01-15T10:00:00+08:00' },
  { id: 'm2', user: { id: 'u2', username: 'lisi', nickname: '李四' }, role: 'tester', created_at: '2026-02-01T10:00:00+08:00' },
  { id: 'm3', user: { id: 'u3', username: 'wangwu', nickname: '王五' }, role: 'developer', created_at: '2026-03-10T10:00:00+08:00' },
];

const integrations = [
  {
    id: 'i1',
    integration_type: 'git_repo',
    vendor: 'gitlab',
    name: '后端代码仓库',
    external_identity: 'core/backend',
    config: { server_url: 'https://gitlab.example.com', default_branch: 'develop' },
    credential_mode: 'fixed',
    is_active: true,
    created_at: '2026-01-15T10:00:00+08:00',
  },
  {
    id: 'i2',
    integration_type: 'jenkins_job',
    vendor: 'jenkins',
    name: '后端打包任务',
    external_identity: 'backend-build',
    config: { server_url: 'https://jenkins.example.com' },
    credential_mode: 'fixed',
    is_active: true,
    created_at: '2026-02-01T10:00:00+08:00',
  },
];

const repositories = [
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
    credential_id: '1',
    credential_mode: 'fixed',
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
    credential_id: '2',
    credential_mode: 'fixed',
    health_status: 'healthy',
    last_sync_at: '2026-06-21T10:00:00+08:00',
    created_at: '2026-02-01T10:00:00+08:00',
  },
];

const credentials = [
  {
    id: '1',
    name: 'GitLab 管理员',
    cred_type: 'gitlab_token',
    auth_mode: 'token',
    username: 'gitlab-admin',
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
    username: 'jenkins-admin',
    masked_data: 'jenkins****xyz',
    expires_at: '2026-07-01T10:00:00+08:00',
    scope: 'global',
    is_active: true,
    last_used_at: '2026-06-21T10:00:00+08:00',
    created_at: '2026-02-01T10:00:00+08:00',
  },
];

const commits = [
  {
    id: '1',
    project_id: '1',
    repository_id: '1',
    commit_hash: '271b688781e11ce76090b0ff1d281ec8d1dcd991',
    author: '张三',
    message: '变更类型：A\n更新内容：移除干扰用户绑定数据采集(DA)的逻辑',
    committed_at: '2026-06-20T10:00:00+08:00',
    branch: 'develop',
    change_type: 'A类',
    review_status: 'pass',
    ai_suggestion: '',
    parsed_result: {
      change_type: '有配置项改动',
      updates: [
        { type: 'A', content: '移除干扰用户绑定数据采集(DA)的逻辑' },
        { type: 'F', content: '信号定时开关新增清除指令并优化控制逻辑' },
      ],
      config_changes: { System: { DeviceType: '0' } },
      related_changes: {},
    },
  },
  {
    id: '2',
    project_id: '1',
    repository_id: '1',
    commit_hash: '8f3a2b1c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0',
    author: '李四',
    message: '变更类型：F\n更新内容：信号定时开关新增清除指令并优化控制逻辑',
    committed_at: '2026-06-19T10:00:00+08:00',
    branch: 'develop',
    change_type: 'F类',
    review_status: 'warning',
    ai_suggestion: '配置项改动格式不标准，建议统一为 [System] 段落格式。',
    parsed_result: {
      change_type: '有配置项改动',
      updates: [{ type: 'F', content: '信号定时开关新增清除指令并优化控制逻辑' }],
      config_changes: { System: { DeviceType: '0' } },
      related_changes: {},
    },
  },
  {
    id: '3',
    project_id: '1',
    repository_id: '2',
    commit_hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
    author: '王五',
    message: '修复登录异常',
    committed_at: '2026-06-18T10:00:00+08:00',
    branch: 'develop',
    change_type: '-',
    review_status: 'illegal',
    ai_suggestion: '缺少变更类型标记，请补充变更类型。',
    parsed_result: {},
  },
];

const releases = [
  {
    id: '1',
    project_id: '1',
    project_name: '核心交易平台',
    version: 'v2.4.1',
    tag_name: 'v2.4.1',
    source_branch: 'develop',
    target_branch: 'main',
    git_hash: '271b688781e11ce76090b0ff1d281ec8d1dcd991',
    release_type: 'formal',
    status: 'released',
    publisher: '张三',
    publisher_id: 'u1',
    created_at: '2026-06-15T10:00:00+08:00',
    release_doc: {
      change_type: '有配置项改动',
      updates: [
        { type: 'A', content: '移除干扰用户绑定数据采集(DA)的逻辑' },
        { type: 'F', content: '信号定时开关新增清除指令并优化控制逻辑' },
      ],
      config_changes: { System: { DeviceType: '0' } },
      related_changes: {},
      impact_other: false,
      test_status: '自测试通过',
      publisher: '张三',
    },
  },
  {
    id: '2',
    project_id: '1',
    project_name: '核心交易平台',
    version: 'v2.4.1-test.3',
    tag_name: 'v2.4.1-test.3',
    source_branch: 'develop',
    target_branch: 'main',
    git_hash: 'def456',
    release_type: 'test',
    status: 'building',
    publisher: '李四',
    publisher_id: 'u2',
    created_at: '2026-06-14T10:00:00+08:00',
    release_doc: {},
  },
  {
    id: '3',
    project_id: '2',
    project_name: '数据中台',
    version: 'v2.3.9',
    tag_name: 'v2.3.9',
    source_branch: 'develop',
    target_branch: 'main',
    git_hash: 'ghi789',
    release_type: 'formal',
    status: 'released',
    publisher: '王五',
    publisher_id: 'u3',
    created_at: '2026-06-10T10:00:00+08:00',
    release_doc: {},
  },
];

const jenkinsJobs = [
  {
    id: 'j1',
    project_id: '1',
    integration_id: 'i2',
    name: '后端打包任务',
    server_url: 'https://jenkins.example.com',
    job_name: 'trace-ship-backend-build',
    credential_id: '2',
    credential_mode: 'fixed',
    params_template: { VERSION: '{{version}}', BRANCH: '{{branch}}', GIT_HASH: '{{git_hash}}' },
  },
];

const jenkinsBuilds = [
  {
    id: 'b1',
    job_id: 'j1',
    job_name: '后端打包任务',
    build_number: 128,
    version: 'v2.4.1',
    status: 'success',
    params: { VERSION: 'v2.4.1', BRANCH: 'main' },
    log_url: 'https://jenkins.example.com/job/backend-build/128/console',
    artifact_info: [{ file_name: 'app.tar.gz', url: 'https://jenkins.example.com/job/backend-build/128/artifact/app.tar.gz' }],
    started_at: '2026-06-15T10:00:00+08:00',
    finished_at: '2026-06-15T10:05:00+08:00',
    duration: '5分12秒',
  },
  {
    id: 'b2',
    job_id: 'j2',
    job_name: '前端打包任务',
    build_number: 89,
    version: 'v2.4.1-test.3',
    status: 'building',
    params: { VERSION: 'v2.4.1-test.3', BRANCH: 'develop' },
    started_at: '2026-06-14T10:00:00+08:00',
    duration: '进行中',
  },
  {
    id: 'b3',
    job_id: 'j1',
    job_name: '后端打包任务',
    build_number: 127,
    version: 'v2.4.0',
    status: 'failure',
    params: { VERSION: 'v2.4.0', BRANCH: 'main' },
    started_at: '2026-06-10T10:00:00+08:00',
    finished_at: '2026-06-10T10:03:00+08:00',
    duration: '3分45秒',
  },
];

const workflowDefinitions = [
  {
    id: 'w1',
    project_id: '1',
    name: '正式发布审批流',
    biz_type: 'release',
    graph_data: {
      nodes: [
        { id: 'start', type: 'start-node' },
        { id: 'approve', type: 'approval-node', properties: { approverType: 'leader', mode: 'or' } },
        { id: 'end', type: 'end-node' },
      ],
      edges: [
        { sourceNodeId: 'start', targetNodeId: 'approve', condition: 'default' },
        { sourceNodeId: 'approve', targetNodeId: 'end', condition: 'approved' },
      ],
    },
    is_active: true,
  },
];

const workflowTasks = [
  {
    id: 't1',
    title: '审批发布 v2.5.0',
    applicant: '李四',
    project_name: '核心交易平台',
    current_node: '项目负责人审批',
    submit_time: '2026-06-22T09:50:00+08:00',
    remaining_time: '2小时',
    status: 'pending',
  },
  {
    id: 't2',
    title: '审批发布 v2.4.2-test.1',
    applicant: '王五',
    project_name: '核心交易平台',
    current_node: '测试负责人审批',
    submit_time: '2026-06-22T09:00:00+08:00',
    remaining_time: '5小时',
    status: 'pending',
  },
];

const doneTasks = [
  {
    id: 't3',
    title: '审批发布 v2.4.1',
    applicant: '李四',
    project_name: '核心交易平台',
    current_node: '-',
    submit_time: '2026-06-15T10:00:00+08:00',
    status: 'approved',
    action: 'approved',
    comment: '同意发布',
    action_time: '2026-06-15T10:30:00+08:00',
  },
];

const workflowInstances = [
  {
    id: 'wi1',
    definition_id: 'w1',
    biz_type: 'release',
    biz_id: '1',
    status: 'running',
    current_node_ids: ['approve'],
    node_status: {
      start: 'completed',
      approve: 'pending',
      end: 'not_started',
    },
    graph_data: {
      nodes: [
        { id: 'start', type: 'start-node' },
        { id: 'approve', type: 'approval-node', properties: { approverType: 'leader', mode: 'or' } },
        { id: 'end', type: 'end-node' },
      ],
      edges: [
        { sourceNodeId: 'start', targetNodeId: 'approve', condition: 'default' },
        { sourceNodeId: 'approve', targetNodeId: 'end', condition: 'approved' },
      ],
    },
    created_at: '2026-06-22T10:00:00+08:00',
  },
];

const users = [
  {
    id: 'u1',
    username: 'zhangsan',
    nickname: '张三',
    email: 'zhangsan@example.com',
    phone: '13800138000',
    department: '研发部',
    source: 'ldap',
    is_active: true,
    is_superuser: false,
    last_login: '2026-06-22T10:00:00+08:00',
    created_at: '2026-06-01T10:00:00+08:00',
  },
  {
    id: 'u2',
    username: 'lisi',
    nickname: '李四',
    email: 'lisi@example.com',
    phone: '13800138001',
    department: '测试部',
    source: 'ldap',
    is_active: true,
    is_superuser: false,
    last_login: '2026-06-21T10:00:00+08:00',
    created_at: '2026-06-02T10:00:00+08:00',
  },
];

const roles = [
  { id: 'r1', name: '系统管理员', code: 'admin', permissions: ['*'] },
  { id: 'r2', name: '项目管理员', code: 'project_manager', permissions: ['project.view', 'project.edit'] },
  { id: 'r3', name: '发布工程师', code: 'release_engineer', permissions: ['release.view', 'release.edit'] },
];

const permissions = [
  { id: 'p1', name: '查看项目', code: 'project.view', module: 'project' },
  { id: 'p2', name: '编辑项目', code: 'project.edit', module: 'project' },
  { id: 'p3', name: '删除项目', code: 'project.delete', module: 'project' },
  { id: 'p4', name: '查看发布', code: 'release.view', module: 'release' },
  { id: 'p5', name: '编辑发布', code: 'release.edit', module: 'release' },
];

const operationLogs = [
  {
    id: '1',
    time: '2026-06-22T10:00:00+08:00',
    user: '张三',
    module: '项目管理',
    action: 'create',
    resource_type: 'project',
    resource_id: '1',
    ip: '192.168.1.1',
    result: 'success',
  },
  {
    id: '2',
    time: '2026-06-22T09:30:00+08:00',
    user: '李四',
    module: '工作流审批',
    action: 'audit',
    resource_type: 'workflow_task',
    resource_id: '1',
    ip: '192.168.1.2',
    result: 'success',
  },
];

const systemConfigs = [
  { key: 'ldap_server', value: 'ldap://ldap.example.com', description: 'LDAP 服务器地址' },
  { key: 'jenkins_default_url', value: 'https://jenkins.example.com', description: 'Jenkins 默认地址' },
  { key: 'ai_provider', value: 'anthropic', description: 'AI Provider' },
  { key: 'token_expire_seconds', value: '3600', description: 'Token 过期时间' },
];

const routes: MockRoute[] = [
  // Auth
  {
    method: 'post',
    path: '/api/auth/login/',
    handler: (config) => {
      const body = getBody(config);
      return {
        data: createResponse({
          user_id: 'u1',
          username: body?.username || 'zhangsan',
          nickname: '张三',
          access_token: 'mock_access_token_' + Date.now(),
          refresh_token: 'mock_refresh_token_' + Date.now(),
          expires_in: 3600,
        }),
      };
    },
  },
  {
    method: 'post',
    path: '/api/auth/token/refresh/',
    handler: () => ({
      data: createResponse({ access: 'mock_access_token_' + Date.now(), expires_in: 3600 }),
    }),
  },
  {
    method: 'post',
    path: '/api/auth/logout/',
    handler: () => ({ data: createResponse(null) }),
  },
  {
    method: 'get',
    path: '/api/auth/user-info/',
    handler: () => ({
      data: createResponse({
        id: 'u1',
        username: 'zhangsan',
        nickname: '张三',
        email: 'zhangsan@example.com',
        department: '研发部',
        source: 'ldap',
        roles: ['release_engineer'],
        is_superuser: false,
      }),
    }),
  },
  {
    method: 'get',
    path: '/api/auth/menus/',
    handler: () => ({
      data: createResponse([
        { id: 'dashboard', name: '工作台', path: '/', icon: 'AppstoreOutlined' },
        { id: 'projects', name: '项目管理', path: '/projects', icon: 'FolderOutlined' },
        { id: 'repositories', name: '仓库管理', path: '/repositories', icon: 'DatabaseOutlined' },
        { id: 'credentials', name: '凭证管理', path: '/credentials', icon: 'KeyOutlined' },
        { id: 'commits', name: '提交规范审查', path: '/commits', icon: 'FileTextOutlined' },
        { id: 'tags', name: 'Tag 生成与发布', path: '/tags', icon: 'TagsOutlined' },
        { id: 'jenkins', name: 'Jenkins 构建', path: '/jenkins', icon: 'PlayCircleOutlined' },
        { id: 'workflows', name: '工作流审批', path: '/workflows', icon: 'ProfileOutlined' },
        { id: 'releases', name: '发布看板', path: '/releases', icon: 'RocketOutlined' },
        {
          id: 'system',
          name: '系统管理',
          path: '/system',
          icon: 'SettingOutlined',
          children: [
            { id: 'system_users', name: '用户管理', path: '/system/users', icon: 'TeamOutlined' },
            { id: 'system_roles', name: '角色管理', path: '/system/roles', icon: 'SafetyCertificateOutlined' },
            { id: 'system_configs', name: '系统配置', path: '/system/configs', icon: 'SettingOutlined' },
            { id: 'system_logs', name: '操作日志', path: '/system/logs', icon: 'FileTextOutlined' },
          ],
        },
      ]),
    }),
  },

  // Users / Roles
  {
    method: 'get',
    path: '/api/account/users/',
    handler: (config) => {
      const { page, page_size } = getParams(config);
      return { data: createPaginatedResponse(users, page, page_size) };
    },
  },
  {
    method: 'post',
    path: '/api/account/users/',
    handler: (config) => ({ data: createResponse({ id: 'u' + Date.now(), ...(getBody(config)) }) }),
  },
  {
    method: 'get',
    path: '/api/account/roles/',
    handler: (config) => {
      const { page, page_size } = getParams(config);
      return { data: createPaginatedResponse(roles, page, page_size) };
    },
  },
  {
    method: 'get',
    path: '/api/account/permissions/',
    handler: (config) => {
      const { page, page_size } = getParams(config);
      return { data: createPaginatedResponse(permissions, page, page_size) };
    },
  },

  // Projects
  {
    method: 'get',
    path: '/api/projects/',
    handler: (config) => {
      const { page, page_size, ordering, keyword, status } = getParams(config);
      let items: (typeof projects)[0][] = [...projects];
      if (keyword) {
        items = items.filter(
          (p) =>
            p.name.toLowerCase().includes(keyword.toLowerCase()) ||
            p.code.toLowerCase().includes(keyword.toLowerCase())
        );
      }
      if (status) {
        items = items.filter((p) => String(p.status) === status);
      }
      return { data: createPaginatedResponse(items, page, page_size, ordering) };
    },
  },
  {
    method: 'post',
    path: '/api/projects/',
    handler: (config) => {
      const newProject = {
        id: 'p' + Date.now(),
        ...(getBody(config)),
        repo_count: 0,
        member_count: 0,
        created_at: new Date().toISOString(),
      };
      projects.unshift(newProject as (typeof projects)[0]);
      return { data: createResponse(newProject) };
    },
  },
  {
    method: 'get',
    path: '/api/projects/:id/',
    handler: (config) => {
      const params = extractParams('/api/projects/:id/', config.url || '');
      const project = projects.find((p) => p.id === params.id);
      return project
        ? { data: createResponse(project) }
        : { data: { code: 40400, message: '项目不存在', data: null }, status: 404 };
    },
  },
  {
    method: 'put',
    path: '/api/projects/:id/',
    handler: (config) => {
      const params = extractParams('/api/projects/:id/', config.url || '');
      const idx = projects.findIndex((p) => p.id === params.id);
      if (idx === -1) return { data: { code: 40400, message: '项目不存在', data: null }, status: 404 };
      projects[idx] = { ...projects[idx], ...(getBody(config)) };
      return { data: createResponse(projects[idx]) };
    },
  },
  {
    method: 'delete',
    path: '/api/projects/:id/',
    handler: (config) => {
      const params = extractParams('/api/projects/:id/', config.url || '');
      const idx = projects.findIndex((p) => p.id === params.id);
      if (idx === -1) return { data: { code: 40400, message: '项目不存在', data: null }, status: 404 };
      projects.splice(idx, 1);
      return { data: createResponse(null) };
    },
  },
  {
    method: 'get',
    path: '/api/projects/:id/members/',
    handler: (config) => {
      const { page, page_size } = getParams(config);
      return { data: createPaginatedResponse(projectMembers, page, page_size) };
    },
  },
  {
    method: 'post',
    path: '/api/projects/:id/members/',
    handler: (config) => ({
      data: createResponse({
        id: 'm' + Date.now(),
        user: { id: (getBody(config))?.user_id || 'u9', username: 'newuser', nickname: '新成员' },
        role: (getBody(config))?.role || 'developer',
        created_at: new Date().toISOString(),
      }),
    }),
  },
  {
    method: 'get',
    path: '/api/projects/:id/integrations/',
    handler: (config) => {
      const { page, page_size } = getParams(config);
      return { data: createPaginatedResponse(integrations, page, page_size) };
    },
  },
  {
    method: 'post',
    path: '/api/projects/:id/integrations/',
    handler: (config) => ({
      data: createResponse({
        id: 'i' + Date.now(),
        ...(getBody(config)),
        is_active: true,
        created_at: new Date().toISOString(),
      }),
    }),
  },
  {
    method: 'post',
    path: /\/api\/projects\/[^/]+\/integrations\/[^/]+\/test\//,
    handler: () => ({ data: createResponse({ connected: true, detail: '连接成功' }) }),
  },

  // Repositories
  {
    method: 'get',
    path: '/api/repositories/',
    handler: (config) => {
      const { page, page_size, project_id, repo_type } = getParams(config);
      let items = [...repositories];
      if (project_id) items = items.filter((r) => r.project_id === project_id);
      if (repo_type) items = items.filter((r) => r.repo_type === repo_type);
      return { data: createPaginatedResponse(items, page, page_size) };
    },
  },
  {
    method: 'post',
    path: '/api/repositories/',
    handler: (config) => ({
      data: createResponse({
        id: 'r' + Date.now(),
        ...(getBody(config)),
        health_status: 'healthy',
        created_at: new Date().toISOString(),
      }),
    }),
  },
  {
    method: 'post',
    path: /\/api\/repositories\/[^/]+\/test\//,
    handler: () => ({ data: createResponse({ connected: true, detail: '连接成功' }) }),
  },
  {
    method: 'get',
    path: /\/api\/repositories\/[^/]+\/branches\//,
    handler: () => ({
      data: createResponse([
        { name: 'main', is_default: true, last_commit_hash: 'abc123' },
        { name: 'develop', is_default: false, last_commit_hash: 'def456' },
      ]),
    }),
  },
  {
    method: 'get',
    path: /\/api\/repositories\/[^/]+\/commits\//,
    handler: (config) => {
      const { page, page_size, review_status } = getParams(config);
      let items = [...commits];
      if (review_status) items = items.filter((c) => c.review_status === review_status);
      return { data: createPaginatedResponse(items, page, page_size) };
    },
  },
  {
    method: 'post',
    path: /\/api\/repositories\/[^/]+\/sync-commits\//,
    handler: () => ({ data: createResponse({ synced_count: 25, illegal_count: 2 }) }),
  },
  {
    method: 'get',
    path: '/api/repositories/vendors/',
    handler: () => ({
      data: createResponse([
        { value: 'gitlab', label: 'GitLab' },
        { value: 'gitea', label: 'Gitea' },
        { value: 'github', label: 'GitHub' },
        { value: 'gitee', label: 'Gitee' },
        { value: 'svn', label: 'SVN' },
      ]),
    }),
  },

  // Credentials
  {
    method: 'get',
    path: '/api/credentials/',
    handler: (config) => {
      const { page, page_size, keyword, cred_type, scope } = getParams(config);
      let items = [...credentials];
      if (keyword) items = items.filter((c) => c.name.toLowerCase().includes(keyword.toLowerCase()));
      if (cred_type) items = items.filter((c) => c.cred_type === cred_type);
      if (scope) items = items.filter((c) => c.scope === scope);
      return { data: createPaginatedResponse(items, page, page_size) };
    },
  },
  {
    method: 'post',
    path: '/api/credentials/',
    handler: (config) => ({
      data: createResponse({
        id: 'c' + Date.now(),
        ...(getBody(config)),
        masked_data: '****',
        created_at: new Date().toISOString(),
      }),
    }),
  },
  {
    method: 'post',
    path: /\/api\/credentials\/[^/]+\/test\//,
    handler: () => ({ data: createResponse({ valid: true, detail: '凭证有效' }) }),
  },
  {
    method: 'get',
    path: /\/api\/credentials\/[^/]+\/usage\//,
    handler: (config) => {
      const { page, page_size } = getParams(config);
      return {
        data: createPaginatedResponse(
          [
            { id: '1', module: 'repository', action: 'sync_commits', used_at: '2026-06-22T10:00:00+08:00' },
            { id: '2', module: 'jenkins', action: 'trigger_build', used_at: '2026-06-21T15:30:00+08:00' },
          ],
          page,
          page_size
        ),
      };
    },
  },
  {
    method: 'get',
    path: '/api/credentials/types/',
    handler: () => ({
      data: createResponse([
        { value: 'gitlab_token', label: 'GitLab Token' },
        { value: 'gitea_token', label: 'Gitea Token' },
        { value: 'svn_password', label: 'SVN' },
        { value: 'jenkins_token', label: 'Jenkins' },
        { value: 'ldap_password', label: 'LDAP' },
        { value: 'ai_api_key', label: 'AI Key' },
      ]),
    }),
  },

  // Commits
  {
    method: 'get',
    path: '/api/commits/',
    handler: (config) => {
      const { page, page_size, project_id, repository_id, branch, review_status, author } = getParams(config);
      let items = [...commits];
      if (project_id) items = items.filter((c: (typeof commits)[0]) => c.project_id === project_id);
      if (repository_id) items = items.filter((c: (typeof commits)[0]) => c.repository_id === repository_id);
      if (branch) items = items.filter((c) => c.branch === branch);
      if (review_status) items = items.filter((c) => c.review_status === review_status);
      if (author) items = items.filter((c) => c.author.includes(author));
      return { data: createPaginatedResponse(items, page, page_size) };
    },
  },
  {
    method: 'post',
    path: /\/api\/commits\/[^/]+\/review\//,
    handler: (config) => ({
      data: createResponse({
        id: '1',
        review_status: (getBody(config))?.review_status || 'pass',
        reason: (getBody(config))?.reason || '',
      }),
    }),
  },
  {
    method: 'get',
    path: /\/api\/commits\/[^/]+\/ai-review\//,
    handler: () => ({
      data: createResponse({
        review_status: 'warning',
        suggestion: '配置项改动格式不标准，建议统一为 [System] 段落格式。',
        risks: ['配置项改动可能影响启动参数'],
      }),
    }),
  },

  // Releases
  {
    method: 'get',
    path: '/api/releases/',
    handler: (config) => {
      const { page, page_size, project_id, release_type, status, version } = getParams(config);
      let items = [...releases];
      if (project_id) items = items.filter((r) => r.project_id === project_id);
      if (release_type) items = items.filter((r) => r.release_type === release_type);
      if (status) items = items.filter((r) => r.status === status);
      if (version) items = items.filter((r) => r.version.includes(version));
      return { data: createPaginatedResponse(items, page, page_size) };
    },
  },
  {
    method: 'post',
    path: '/api/releases/',
    handler: (config) => ({
      data: createResponse({
        id: 'rel' + Date.now(),
        ...(getBody(config)),
        status: 'draft',
        created_at: new Date().toISOString(),
      }),
    }),
  },
  {
    method: 'get',
    path: /\/api\/releases\/[^/]+\//,
    handler: (config) => {
      const id = (config.url || '').split('/').slice(-2, -1)[0];
      const release = releases.find((r) => r.id === id);
      return release
        ? { data: createResponse(release) }
        : { data: { code: 40400, message: '发布不存在', data: null }, status: 404 };
    },
  },
  {
    method: 'get',
    path: /\/api\/releases\/[^/]+\/commits\//,
    handler: (config) => {
      const { page, page_size } = getParams(config);
      const items = commits.map((c) => ({
        commit_id: c.id,
        commit_hash: c.commit_hash,
        message: c.message,
        is_included: true,
        edited_content: null,
      }));
      return { data: createPaginatedResponse(items, page, page_size) };
    },
  },
  {
    method: 'post',
    path: /\/api\/releases\/[^/]+\/generate-doc\//,
    handler: () => ({
      data: createResponse({
        version: 'VA.4.1.155',
        git_hash: '271b688781e11ce76090b0ff1d281ec8d1dcd991',
        change_type: '有配置项改动',
        updates: [
          { type: 'A', content: '移除干扰用户绑定数据采集(DA)的逻辑' },
          { type: 'F', content: '信号定时开关新增清除指令并优化控制逻辑' },
        ],
        config_changes: { System: { DeviceType: '0' } },
        related_changes: {},
        impact_other: false,
        test_status: '自测试通过',
        publisher: '张三',
      }),
    }),
  },
  {
    method: 'post',
    path: /\/api\/releases\/[^/]+\/submit-audit\//,
    handler: () => ({
      data: createResponse({
        release_id: '1',
        status: 'pending',
        workflow_instance_id: 'wi' + Date.now(),
      }),
    }),
  },
  {
    method: 'post',
    path: /\/api\/releases\/[^/]+\/push-tag\//,
    handler: () => ({
      data: createResponse({
        tag_name: 'VA.4.1.155',
        git_hash: '271b688781e11ce76090b0ff1d281ec8d1dcd991',
        pushed_at: new Date().toISOString(),
      }),
    }),
  },

  // Jenkins
  {
    method: 'get',
    path: '/api/jenkins/jobs/',
    handler: (config) => {
      const { page, page_size, project_id } = getParams(config);
      let items = [...jenkinsJobs];
      if (project_id) items = items.filter((j) => j.project_id === project_id);
      return { data: createPaginatedResponse(items, page, page_size) };
    },
  },
  {
    method: 'post',
    path: '/api/jenkins/jobs/',
    handler: (config) => ({
      data: createResponse({ id: 'j' + Date.now(), ...(getBody(config)) }),
    }),
  },
  {
    method: 'post',
    path: /\/api\/jenkins\/jobs\/[^/]+\/trigger\//,
    handler: () => ({
      data: createResponse({ build_id: 'b' + Date.now(), build_number: 999, status: 'queue' }),
    }),
  },
  {
    method: 'get',
    path: '/api/jenkins/builds/',
    handler: (config) => {
      const { page, page_size } = getParams(config);
      return { data: createPaginatedResponse(jenkinsBuilds, page, page_size) };
    },
  },
  {
    method: 'get',
    path: /\/api\/jenkins\/builds\/[^/]+\//,
    handler: (config) => {
      const id = (config.url || '').split('/').slice(-2, -1)[0];
      const build = jenkinsBuilds.find((b) => b.id === id);
      return build
        ? { data: createResponse(build) }
        : { data: { code: 40400, message: '构建不存在', data: null }, status: 404 };
    },
  },
  {
    method: 'get',
    path: /\/api\/jenkins\/builds\/[^/]+\/log\//,
    handler: () => ({
      data: createResponse({
        content:
          'Started by user 张三\nBuilding in workspace /var/jenkins/workspace/backend-build\n> git rev-parse --is-inside-work-tree # timeout=10\n> git fetch --tags --progress origin\n> git checkout -f abc123\nRunning build script...\n[Pipeline] stage\n[Pipeline] { (Build)\n> npm run build\nBuild completed successfully.\n[Pipeline] // stage\n[Pipeline] End of Pipeline\nFinished: SUCCESS',
      }),
    }),
  },

  // Workflow
  {
    method: 'get',
    path: '/api/workflow/definitions/',
    handler: (config) => {
      const { page, page_size, project_id } = getParams(config);
      let items = [...workflowDefinitions];
      if (project_id) items = items.filter((w) => w.project_id === project_id);
      return { data: createPaginatedResponse(items, page, page_size) };
    },
  },
  {
    method: 'post',
    path: '/api/workflow/definitions/',
    handler: (config) => ({
      data: createResponse({ id: 'w' + Date.now(), ...(getBody(config)) }),
    }),
  },
  {
    method: 'post',
    path: '/api/workflow/instances/',
    handler: (config) => {
      const body = (config.data || {}) as Record<string, unknown>;
      return {
        data: createResponse({
          id: 'wi' + Date.now(),
          ...body,
          status: 'running',
          current_node_ids: ['approve'],
          node_status: { start: 'completed', approve: 'pending', end: 'not_started' },
          created_at: new Date().toISOString(),
        }),
      };
    },
  },
  {
    method: 'get',
    path: /\/api\/workflow\/instances\/[^/]+\//,
    handler: (config) => {
      const id = (config.url || '').split('/').slice(-2, -1)[0];
      const instance = workflowInstances.find((w) => w.id === id);
      return instance
        ? { data: createResponse(instance) }
        : { data: { code: 40400, message: '流程实例不存在', data: null }, status: 404 };
    },
  },
  {
    method: 'get',
    path: /\/api\/workflow\/instances\/[^/]+\/progress\//,
    handler: (config) => {
      const id = (config.url || '').split('/').slice(-3, -2)[0];
      const instance = workflowInstances.find((w) => w.id === id);
      return instance
        ? {
            data: createResponse({
              instance_id: instance.id,
              status: instance.status,
              current_node_ids: instance.current_node_ids,
              node_status: instance.node_status,
              graph_data: instance.graph_data,
            }),
          }
        : { data: { code: 40400, message: '流程实例不存在', data: null }, status: 404 };
    },
  },
  {
    method: 'get',
    path: '/api/workflow/tasks/todo/',
    handler: (config) => {
      const { page, page_size } = getParams(config);
      return { data: createPaginatedResponse(workflowTasks, page, page_size) };
    },
  },
  {
    method: 'get',
    path: '/api/workflow/tasks/done/',
    handler: (config) => {
      const { page, page_size } = getParams(config);
      return { data: createPaginatedResponse(doneTasks, page, page_size) };
    },
  },
  {
    method: 'post',
    path: /\/api\/workflow\/tasks\/[^/]+\/approve\//,
    handler: (config) => ({
      data: createResponse({
        task_id: (config.url || '').split('/').slice(-3, -2)[0],
        status: 'approved',
        comment: (getBody(config))?.comment || '',
        action_time: new Date().toISOString(),
      }),
    }),
  },
  {
    method: 'post',
    path: /\/api\/workflow\/tasks\/[^/]+\/reject\//,
    handler: (config) => ({
      data: createResponse({
        task_id: (config.url || '').split('/').slice(-3, -2)[0],
        status: 'rejected',
        comment: (getBody(config))?.comment || '',
        action_time: new Date().toISOString(),
      }),
    }),
  },
  {
    method: 'post',
    path: /\/api\/workflow\/tasks\/[^/]+\/transfer\//,
    handler: (config) => ({
      data: createResponse({
        task_id: (config.url || '').split('/').slice(-3, -2)[0],
        status: 'transferred',
        to_user_id: (getBody(config))?.to_user_id,
        comment: (getBody(config))?.comment || '',
        action_time: new Date().toISOString(),
      }),
    }),
  },
  {
    method: 'post',
    path: /\/api\/workflow\/tasks\/[^/]+\/revoke\//,
    handler: (config) => ({
      data: createResponse({
        task_id: (config.url || '').split('/').slice(-3, -2)[0],
        status: 'revoked',
        comment: ((config.data as Record<string, unknown>)?.comment as string) || '',
        action_time: new Date().toISOString(),
      }),
    }),
  },

  // Dashboard
  {
    method: 'get',
    path: '/api/dashboard/overview/',
    handler: () => ({
      data: createResponse({
        total_releases: 120,
        success_rate: 0.95,
        pending_audit_count: 5,
        upcoming_releases: 3,
      }),
    }),
  },
  {
    method: 'get',
    path: '/api/dashboard/trend/',
    handler: (config) => {
      const url = new URL(config.url || '', 'http://localhost');
      const days = parseInt(url.searchParams.get('days') || '30', 10);
      const data = Array.from({ length: Math.min(days, 30) }, (_, i) => ({
        date: `2026-05-${String(i + 1).padStart(2, '0')}`,
        count: Math.floor(Math.random() * 5) + 1,
      }));
      return { data: createResponse(data) };
    },
  },
  {
    method: 'get',
    path: '/api/dashboard/projects/',
    handler: () => ({
      data: createResponse([
        { project_id: '1', project_name: '核心交易平台', release_count: 45 },
        { project_id: '2', project_name: '数据中台', release_count: 32 },
      ]),
    }),
  },

  // System
  {
    method: 'get',
    path: '/api/system/configs/',
    handler: (config) => {
      const { page, page_size } = getParams(config);
      return { data: createPaginatedResponse(systemConfigs, page, page_size) };
    },
  },
  {
    method: 'put',
    path: /\/api\/system\/configs\/[^/]+\//,
    handler: (config) => ({
      data: createResponse({ key: (config.url || '').split('/').slice(-2, -1)[0], ...(getBody(config)) }),
    }),
  },
  {
    method: 'get',
    path: '/api/system/logs/',
    handler: (config) => {
      const { page, page_size } = getParams(config);
      return { data: createPaginatedResponse(operationLogs, page, page_size) };
    },
  },
  {
    method: 'get',
    path: '/api/system/ai-logs/',
    handler: (config) => {
      const { page, page_size } = getParams(config);
      return {
        data: createPaginatedResponse(
          [
            { id: '1', prompt: '审查 commit 规范', model: 'claude-3-sonnet', tokens: 1200, used_at: '2026-06-22T10:00:00+08:00' },
          ],
          page,
          page_size
        ),
      };
    },
  },
];

export function mockRequest(config: AxiosRequestConfig): Promise<AxiosResponse> | undefined {
  const method = (config.method || 'get').toLowerCase();
  const fullUrl = (config.baseURL || '') + (config.url || '');

  for (const route of routes) {
    if (route.method !== method) continue;
    if (!matchPath(route.path, fullUrl)) continue;

    const result = route.handler(config);
    if (!result) continue;

    return Promise.resolve({
      data: result.data,
      status: result.status || 200,
      statusText: 'OK',
      headers: {},
      config: config as InternalAxiosRequestConfig,
      request: {},
    });
  }

  return undefined;
}

export function shouldMock(url?: string) {
  return import.meta.env.VITE_ENABLE_MOCK === 'true' && url?.startsWith('/api/');
}
