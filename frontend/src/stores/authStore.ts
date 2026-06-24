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
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearAuth: () => void;
  fetchUserInfo: () => Promise<void>;
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

      login: async (username, password) => {
        const data = await authApi.login({ username, password });
        localStorage.setItem('accessToken', data.access_token);
        localStorage.setItem('refreshToken', data.refresh_token);
        set({
          token: data.access_token,
          refreshToken: data.refresh_token,
          isAuthenticated: true,
        });
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
      partialize: (state) => ({
        token: state.token,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
        menus: state.menus,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    }
  )
);
