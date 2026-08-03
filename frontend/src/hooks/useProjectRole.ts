import { useAuthStore } from '@/stores/authStore';

export type ProjectRole = 'manager' | 'developer' | 'tester' | 'auditor' | 'viewer';

export interface ProjectPermissions {
  /** 当前用户在项目中的角色（超管视为 manager，非成员为 null） */
  role: ProjectRole | null;
  /** manager：项目设置 / 成员管理 / 仓库管理 / 打包配置 / 流程节点编辑 */
  canManage: boolean;
  /** developer 及以上：发布写操作 / 仓库同步测试 / 打包取消与推 SVN */
  canDevelop: boolean;
  /** tester/developer/manager：手动触发打包 */
  canTriggerPackage: boolean;
}

/**
 * 项目内操作权限 hook
 *
 * 项目内操作只看项目成员角色（my_role，由项目详情接口返回），
 * 与系统角色解耦；超管拥有全部权限。
 */
export function useProjectRole(project?: { my_role?: string | null } | null): ProjectPermissions {
  const user = useAuthStore((state) => state.user);
  const role = (user?.is_superuser ? 'manager' : project?.my_role ?? null) as ProjectRole | null;

  return {
    role,
    canManage: role === 'manager',
    canDevelop: role === 'manager' || role === 'developer',
    canTriggerPackage: role === 'manager' || role === 'developer' || role === 'tester',
  };
}
