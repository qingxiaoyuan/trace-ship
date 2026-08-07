import { Suspense } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuthStore } from '@/stores/authStore';
import Forbidden from '@/pages/Error/Forbidden';

export function PageLoader({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center">
          <Spin size="large" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

export function AuthGuard() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hydrated = useAuthStore((state) => state.hydrated);
  const isInitializing = useAuthStore((state) => state.isInitializing);

  if (!hydrated || isInitializing) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spin size="large" />
      </div>
    );
  }

  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
}

/** 系统管理路由守卫：超管或拥有任一 system.* 权限可进入系统管理区域 */
export function SystemGuard() {
  const user = useAuthStore((state) => state.user);
  const hasAnySystem = (user?.permissions ?? []).some((p) => p.startsWith('system.'));

  if (!user?.is_superuser && !hasAnySystem) {
    return <Forbidden description="系统管理功能需要对应用户管理/角色管理等权限，如有需要请联系系统管理员。" />;
  }
  return <Outlet />;
}

/** 细粒度系统权限守卫：仅超管或拥有指定权限的用户可访问包裹内容 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: string;
  children: React.ReactNode;
}) {
  const user = useAuthStore((state) => state.user);
  const hasPermission = user?.is_superuser || (user?.permissions ?? []).includes(permission);
  if (!hasPermission) {
    return <Forbidden description="没有访问该功能的权限，请联系系统管理员分配对应角色。" />;
  }
  return <>{children}</>;
}
