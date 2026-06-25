import { ConfigProvider, App as AntApp, theme } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { useEffect } from 'react';
import { router } from '@/router';
import { antdTheme } from '@/styles/theme';
import { useAuthStore } from '@/stores/authStore';

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
