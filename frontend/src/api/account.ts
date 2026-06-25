import { get, post, put, del } from './request';
import type { PaginatedData } from '@/types';

export interface AccountUser {
  id: string;
  username: string;
  nickname?: string;
  email?: string;
  phone?: string;
  department?: string;
  source: string;
  is_active: boolean;
  is_superuser: boolean;
  roles: string[];
  created_at: string;
}

export interface AccountRole {
  id: string;
  name: string;
  code: string;
  description?: string;
  created_at: string;
}

export interface AccountPermission {
  id: string;
  name: string;
  code: string;
  description?: string;
}

export interface UserListParams {
  keyword?: string;
  role?: string;
  source?: string;
  is_active?: boolean;
  page?: number;
  page_size?: number;
}

export interface RoleListParams {
  keyword?: string;
  page?: number;
  page_size?: number;
}

export const accountApi = {
  getUsers: (params?: UserListParams) =>
    get<PaginatedData<AccountUser>>('/account/users/', { params }),
  getUser: (id: string) => get<AccountUser>(`/account/users/${id}/`),
  createUser: (data: Partial<AccountUser>) => post<AccountUser>('/account/users/', data),
  updateUser: (id: string, data: Partial<AccountUser>) =>
    put<AccountUser>(`/account/users/${id}/`, data),
  deleteUser: (id: string) => del<null>(`/account/users/${id}/`),
  getRoles: (params?: RoleListParams) =>
    get<PaginatedData<AccountRole>>('/account/roles/', { params }),
  getRole: (id: string) => get<AccountRole>(`/account/roles/${id}/`),
  createRole: (data: Partial<AccountRole>) => post<AccountRole>('/account/roles/', data),
  updateRole: (id: string, data: Partial<AccountRole>) =>
    put<AccountRole>(`/account/roles/${id}/`, data),
  deleteRole: (id: string) => del<null>(`/account/roles/${id}/`),
  getPermissions: () => get<AccountPermission[]>('/account/permissions/'),
};
