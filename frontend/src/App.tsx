import { ConfigProvider, App as AntApp, theme, message } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { useEffect } from 'react';
import { router } from '@/router';
import { antdTheme } from '@/styles/theme';
import { useAuthStore } from '@/stores/authStore';
import { registerAuthHandlers } from '@/api/request';

// 注册认证回调处理器，避免 request.ts 与 authStore/authApi 形成循环依赖。
registerAuthHandlers({
  getRefreshToken: () => localStorage.getItem('refreshToken'),
  onRefreshSuccess: (accessToken, refreshToken) => {
    useAuthStore.getState().setTokens(accessToken, refreshToken);
  },
  onRefreshFailed: () => {
    useAuthStore.getState().clearAuth();
    message.error('登录已过期，请重新登录');
    router.navigate('/login', { replace: true });
  },
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  const hydrated = useAuthStore((state) => state.hydrated);

  useEffect(() => {
    if (hydrated) {
      const refreshToken = useAuthStore.getState().refreshToken;
      if (refreshToken) {
        useAuthStore.getState().initializeAuth();
      }
    }
  }, [hydrated]);

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider theme={{ ...antdTheme, algorithm: theme.defaultAlgorithm }}>
        <AntApp>
          <RouterProvider router={router} />
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>
  );
}

export default App;
