import type { Project } from '@/types';

export const mockProjects: Project[] = [
  {
    id: '1',
    code: 'CORE_TRADE',
    name: '核心交易平台',
    leader_id: 'u1',
    leader_name: '张三',
    description: '核心交易业务系统',
    status: 'active',
    repo_count: 5,
    member_count: 12,
    created_at: '2026-01-15T10:00:00+08:00',
  },
  {
    id: '2',
    code: 'DATA_MIDDLE',
    name: '数据中台',
    leader_id: 'u2',
    leader_name: '李四',
    description: '数据中台服务',
    status: 'active',
    repo_count: 3,
    member_count: 8,
    created_at: '2026-02-20T10:00:00+08:00',
  },
  {
    id: '3',
    code: 'PAY_GATE',
    name: '支付网关',
    leader_id: 'u3',
    leader_name: '王五',
    description: '支付网关系统',
    status: 'inactive',
    repo_count: 2,
    member_count: 6,
    created_at: '2026-03-10T10:00:00+08:00',
  },
];

export const projectStatusOptions = [
  { label: '启用', value: 'active' },
  { label: '停用', value: 'inactive' },
];

export const projectRoleMap: Record<string, string> = {
  manager: '项目负责人',
  tester: '测试人员',
  developer: '开发工程师',
  auditor: '审计人员',
  viewer: '只读用户',
};
