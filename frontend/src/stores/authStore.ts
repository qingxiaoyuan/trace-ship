import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UserInfo, MenuItem } from '@/types';
import { authApi } from '@/api/auth';

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  user: UserInfo | null;
  menus: MenuItem[];
  isAuthenticated: boolean;
  hydrated: boolean;
  isInitializing: boolean;
  login: (username: string, password: string) => Promise<void>;
  ssoLogin: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  clearAuth: () => void;
  fetchUserInfo: () => Promise<void>;
  initializeAuth: () => Promise<boolean>;
  setTokens: (token: string, refreshToken?: string) => void;
  setUser: (user: UserInfo) => void;
  setHydrated: (hydrated: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      refreshToken: null,
      user: null,
      menus: [],
      isAuthenticated: false,
      hydrated: false,
      isInitializing: false,

      login: async (username, password) => {
        const data = await authApi.login({ username, password });
        get().setTokens(data.access_token, data.refresh_token);
        try {
          await get().fetchUserInfo();
        } catch (e) {
          console.warn('获取用户信息失败，已保持登录状态', e);
        }
      },

      ssoLogin: async (token) => {
        const data = await authApi.ssoLogin(token);
        get().setTokens(data.access_token, data.refresh_token);
        try {
          await get().fetchUserInfo();
        } catch (e) {
          console.warn('获取用户信息失败，已保持登录状态', e);
        }
      },

      logout: async () => {
        try {
          await authApi.logout();
        } finally {
          get().clearAuth();
        }
      },

      clearAuth: () => {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        set({ token: null, refreshToken: null, user: null, menus: [], isAuthenticated: false });
      },

      setTokens: (token, refreshToken) => {
        localStorage.setItem('accessToken', token);
        if (refreshToken) {
          localStorage.setItem('refreshToken', refreshToken);
        }
        set({ token, ...(refreshToken ? { refreshToken } : {}), isAuthenticated: true });
      },

      initializeAuth: async () => {
        set({ isInitializing: true });
        // 记录本次恢复使用的 refresh token。SSO/普通登录若在恢复期间完成，
        // 会替换该值，此次恢复不得再覆盖新会话或清理新会话。
        const refreshTokenAtStart = get().refreshToken || localStorage.getItem('refreshToken');
        try {
          const refreshToken = refreshTokenAtStart;
          if (!refreshToken) {
            get().clearAuth();
            return false;
          }
          const data = await authApi.refresh(refreshToken);
          if (localStorage.getItem('refreshToken') !== refreshTokenAtStart) {
            return true;
          }
          const newRefreshToken = data.refresh || refreshToken;
          get().setTokens(data.access, newRefreshToken);
          try {
            await get().fetchUserInfo();
          } catch (e) {
            console.warn('恢复用户信息失败', e);
          }
          return true;
        } catch (e) {
          console.warn('恢复会话失败', e);
          // 登录流程可能已替换 refresh token；旧恢复请求失败时不能清理新会话。
          if (localStorage.getItem('refreshToken') === refreshTokenAtStart) {
            get().clearAuth();
          }
          return false;
        } finally {
          set({ isInitializing: false });
        }
      },

      fetchUserInfo: async () => {
        const [user, menus] = await Promise.all([
          authApi.getUserInfo(),
          authApi.getMenus(),
        ]);
        set({ user, menus });
      },

      setUser: (user) => set({ user }),
      setHydrated: (hydrated) => set({ hydrated }),
    }),
    {
      name: 'auth-storage',
      // 只持久化 token，menus/user/isAuthenticated 在 initializeAuth 时从 API 恢复
      partialize: (state) => ({
        token: state.token,
        refreshToken: state.refreshToken,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    }
  )
);
