export const mockUsers = [
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

export const mockRoles = [
  { id: 'r1', name: '系统管理员', code: 'admin', description: '全部权限' },
  { id: 'r2', name: '项目管理员', code: 'project_manager', description: '项目管理权限' },
  { id: 'r3', name: '发布工程师', code: 'release_engineer', description: '发布与构建权限' },
];

export const sourceMap: Record<string, string> = {
  ldap: 'LDAP',
  local: '本地',
};

export const systemConfigCategories = [
  { key: 'ldap', label: 'LDAP/AD' },
  { key: 'jenkins', label: 'Jenkins' },
  { key: 'storage', label: '存储' },
  { key: 'notification', label: '通知' },
  { key: 'security', label: '安全策略' },
  { key: 'template', label: '公告/模板' },
];

export const operationLogActions = [
  { label: '查询', value: 'query', color: 'blue' },
  { label: '新增', value: 'create', color: 'green' },
  { label: '修改', value: 'update', color: 'orange' },
  { label: '删除', value: 'delete', color: 'red' },
  { label: '审批', value: 'audit', color: 'green' },
  { label: '发布', value: 'release', color: 'blue' },
];

export const mockOperationLogs = [
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
