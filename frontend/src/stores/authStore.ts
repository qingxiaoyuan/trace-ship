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
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchUserInfo: () => Promise<void>;
  setUser: (user: UserInfo) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      refreshToken: null,
      user: null,
      menus: [],
      isAuthenticated: false,

      login: async (username, password) => {
        const data = await authApi.login({ username, password });
        localStorage.setItem('accessToken', data.access_token);
        localStorage.setItem('refreshToken', data.refresh_token);
        set({
          token: data.access_token,
          refreshToken: data.refresh_token,
          isAuthenticated: true,
        });
        await get().fetchUserInfo();
      },

      logout: async () => {
        try {
          await authApi.logout();
        } finally {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          set({ token: null, refreshToken: null, user: null, menus: [], isAuthenticated: false });
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
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        token: state.token,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
