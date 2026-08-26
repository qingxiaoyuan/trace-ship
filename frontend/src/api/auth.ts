import { get, post } from './request';
import type { LoginParams, LoginData, UserInfo, MenuItem } from '@/types';

export const authApi = {
  login: (params: LoginParams) => post<LoginData>('/auth/login/', params),
  ssoLogin: (token: string) => post<LoginData>('/auth/sso/login/', { token }),
  refresh: (refresh: string) => post<{ access: string; refresh?: string; expires_in?: number }>('/auth/token/refresh/', { refresh }),
  logout: () => post<null>('/auth/logout/', {}),
  getUserInfo: () => get<UserInfo>('/auth/user-info/'),
  getMenus: () => get<MenuItem[]>('/auth/menus/'),
};
