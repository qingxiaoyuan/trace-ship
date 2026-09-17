import { useAuthStore } from '@/stores/authStore';

export type ProjectRole = 'manager' | 'developer' | 'tester' | 'auditor' | 'viewer' | 'software_admin';

export interface ProjectPermissions {
  /** 当前用户在项目中的角色（超管视为 manager，非成员为 null） */
  role: ProjectRole | null;
  /** manager / software_admin：项目设置 / 成员管理 / 仓库管理 / 打包配置 / 流程节点编辑 */
  canManage: boolean;
  /** developer 及以上（含 software_admin）：发布写操作 / 仓库同步测试 / 打包取消与推 SVN */
  canDevelop: boolean;
  /** tester/developer/manager（含 software_admin）：手动触发打包 */
  canTriggerPackage: boolean;
  /** 任意项目成员均可拉人进项目（可授予角色见 grantableRoles） */
  canAddMember: boolean;
  /**
   * 当前用户可授予的成员角色：
   * manager 全部；software_admin 除 manager/software_admin；其他成员仅 developer/tester
   */
  grantableRoles: ProjectRole[];
}

/**
 * 项目内操作权限 hook
 *
 * 项目内操作只看项目成员角色（my_role，由项目详情接口返回），
 * 与系统角色解耦；超管拥有全部权限。软件管理员拥有项目内全部操作权限。
 */
export function useProjectRole(project?: { my_role?: string | null } | null): ProjectPermissions {
  const user = useAuthStore((state) => state.user);
  const role = (user?.is_superuser ? 'manager' : project?.my_role ?? null) as ProjectRole | null;

  const grantableRoles: ProjectRole[] =
    role === 'manager'
      ? ['developer', 'tester', 'manager', 'auditor', 'viewer', 'software_admin']
      : role === 'software_admin'
        ? ['developer', 'tester', 'auditor', 'viewer']
        : role
          ? ['developer', 'tester']
          : [];

  return {
    role,
    canManage: role === 'manager' || role === 'software_admin',
    canDevelop: role === 'manager' || role === 'developer' || role === 'software_admin',
    canTriggerPackage:
      role === 'manager' || role === 'developer' || role === 'tester' || role === 'software_admin',
    canAddMember: role !== null,
    grantableRoles,
  };
}
