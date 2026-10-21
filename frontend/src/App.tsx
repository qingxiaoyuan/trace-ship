import { ConfigProvider, App as AntApp, theme } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { router } from '@/router';
import { antdTheme } from '@/styles/theme';
import { useAuthStore } from '@/stores/authStore';
import { registerAuthHandlers, registerErrorNotifier } from '@/api/request';

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
  const restoreStarted = useRef(false);

  useEffect(() => {
    // SSO 页面正在用 OA 一次性凭证建立新会话时，不要并发恢复旧会话。
    if (hydrated && !restoreStarted.current && window.location.pathname !== '/sso') {
      // StrictMode 会重放挂载 effect；刷新令牌会轮换，因此每次挂载只恢复一次。
      restoreStarted.current = true;
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
          <GlobalErrorNotifier />
          <RouterProvider router={router} />
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>
  );
}

/** 在 AntApp 上下文中注册全局错误 toast，使拦截器提示复用主题化的 message 实例 */
function GlobalErrorNotifier() {
  const { message: appMessage } = AntApp.useApp();

  useEffect(() => {
    registerErrorNotifier((content) => appMessage.error(content));
    // 认证提示同样使用 App 上下文，避免静态 message 无法消费动态主题。
    registerAuthHandlers({
      getRefreshToken: () => localStorage.getItem('refreshToken'),
      onRefreshSuccess: (accessToken, refreshToken) => {
        useAuthStore.getState().setTokens(accessToken, refreshToken);
      },
      onRefreshFailed: () => {
        useAuthStore.getState().clearAuth();
        appMessage.error('登录已过期，请重新登录');
        router.navigate('/login', { replace: true });
      },
    });
  }, [appMessage]);

  return null;
}

export default App;
