/** 角色码 → 中文展示 */
const roleMap: Record<string, string> = {
  super_admin: '超级管理员',
  developer: '开发人员',
  tester: '测试人员',
  auditor: '审核人',
  viewer: '只读人员',
  manager: '产品负责人',
  software_admin: '软件管理员',
};

interface RoleLikeUser {
  is_superuser?: boolean;
  roles?: string[];
}

/** 用户角色中文标签（超管优先） */
export function getRoleLabel(user: RoleLikeUser | null | undefined): string {
  if (!user) return '用户';
  if (user.is_superuser) return '超级管理员';
  const role = user.roles?.[0] || '';
  return roleMap[role] || role || '用户';
}
