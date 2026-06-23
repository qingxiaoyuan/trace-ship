import type { Project } from '@/types';

export const mockProjects: Project[] = [
  {
    id: '1',
    code: 'CORE-TRADE',
    name: '核心交易平台',
    leader_id: 'u1',
    leader_name: '李四',
    description: '核心交易业务系统，包含订单、支付、清结算等模块。',
    status: 'active',
    repo_count: 3,
    member_count: 12,
    created_at: '2025-03-12T10:00:00+08:00',
    version_rule: '主版本.次版本.修订号',
    release_cycle: '正式版本 3 天一发',
    formal_branch: 'master,main',
    test_prefix: '-test',
    compliance_threshold: 100,
  },
  {
    id: '2',
    code: 'DATA-HUB',
    name: '数据中台',
    leader_id: 'u2',
    leader_name: '王五',
    description: '数据中台服务，统一数据治理与分析。',
    status: 'active',
    repo_count: 2,
    member_count: 8,
    created_at: '2025-06-20T10:00:00+08:00',
    version_rule: '主版本.次版本.修订号',
    release_cycle: '正式版本 7 天一发',
    formal_branch: 'main',
    test_prefix: '-test',
    compliance_threshold: 90,
  },
  {
    id: '3',
    code: 'OPS-PORTAL',
    name: '运维门户',
    leader_id: 'u3',
    leader_name: '赵六',
    description: '运维门户系统，提供统一运维入口。',
    status: 'inactive',
    repo_count: 1,
    member_count: 6,
    created_at: '2024-11-08T10:00:00+08:00',
    version_rule: '年月日.修订号',
    release_cycle: '按需发布',
    formal_branch: 'main',
    test_prefix: '-rc',
    compliance_threshold: 85,
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
