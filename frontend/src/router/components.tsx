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

/** 系统管理路由守卫：仅超管可访问，否则展示 403 页面 */
export function SystemGuard() {
  const user = useAuthStore((state) => state.user);

  if (!user?.is_superuser) {
    return <Forbidden description="系统管理功能仅对超级管理员开放，如有需要请联系系统管理员。" />;
  }
  return <Outlet />;
}
