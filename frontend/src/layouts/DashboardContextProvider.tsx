import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Result, Spin } from 'antd';
import { dashboardApi } from '@/api/dashboard';
import { useAuthStore } from '@/stores/authStore';
import { DashboardContextState } from '@/hooks/useDashboardContext';

/** 整个登录外壳共享服务端结论，不从分页列表或全局角色推断项目身份。 */
export function DashboardContextProvider({ children }: { children: ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const location = useLocation();
  const query = useQuery({
    // 用户键隔离换账号后的缓存；普通 Tab 导航不卸载已挂载表单。
    queryKey: ['dashboard-context', user?.id, user?.is_superuser],
    queryFn: ({ signal }) => dashboardApi.getContext(signal),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    retry: false,
  });
  const previousLocation = useRef(location.key);
  const { refetch } = query;
  useEffect(() => {
    if (previousLocation.current !== location.key && ['/', '/dashboard'].includes(location.pathname)) {
      void refetch();
    }
    previousLocation.current = location.key;
  }, [location.key, location.pathname, refetch]);

  if (query.isError && !query.data) {
    return <Result status="error" title="无法加载工作台权限" subTitle="请重试以获取最新项目范围。"
      extra={<Button onClick={() => void query.refetch()}>重试</Button>} />;
  }
  if (!query.data || !query.isFetchedAfterMount) {
    return <div className="flex min-h-screen items-center justify-center gap-3" role="status">
      <Spin />正在加载工作台权限…
    </div>;
  }
  return <DashboardContextState.Provider value={query.data}>
    {query.isError && <Alert type="warning" title="工作台权限刷新失败"
      description="暂时保留上次已确认的项目范围，请重试获取最新权限。"
      action={<Button onClick={() => void query.refetch()}>重试</Button>} />}
    {children}
  </DashboardContextState.Provider>;
}
