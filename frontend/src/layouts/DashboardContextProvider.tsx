import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Result, Spin } from 'antd';
import { dashboardApi } from '@/api/dashboard';
import type { DashboardContext } from '@/api/dashboard';
import { useAuthStore } from '@/stores/authStore';
import { DashboardContextState } from '@/hooks/useDashboardContext';

const projectPermissionQueryRoots = new Set([
  'project', 'projects', 'package-board-projects', 'package-configs',
  'repository', 'repositories', 'release', 'package-task', 'package-tasks',
]);

/** 整个登录外壳共享服务端结论，不从分页列表或全局角色推断项目身份。 */
export function DashboardContextProvider({ children }: { children: ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const location = useLocation();
  const queryClient = useQueryClient();
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
  const previousContext = useRef<{ userId?: string; mode: DashboardContext['layout_mode'] } | null>(null);
  const { refetch } = query;
  useEffect(() => {
    if (!query.data) return;
    const current = { userId: user?.id, mode: query.data.layout_mode };
    const previous = previousContext.current;
    previousContext.current = current;
    if (previous && previous.userId === current.userId && previous.mode !== current.mode) {
      // 只在身份模式变化时重查资源权限，普通导航和轮询不重置表单。
      void queryClient.invalidateQueries({ predicate: (cached) => projectPermissionQueryRoots.has(String(cached.queryKey[0])) });
    }
  }, [query.data, queryClient, user?.id]);
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
