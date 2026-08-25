import { get, post, put, patch, del } from './request';
import type { PaginatedData } from '@/types';

export interface SystemConfig {
  id: string;
  key: string;
  value: string;
  description?: string;
  is_public: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface SystemLogUser {
  id?: string;
  username?: string;
  nickname?: string;
}

export interface SystemLog {
  id: string;
  user?: SystemLogUser | null;
  action: string;
  module: string;
  resource_type?: string;
  resource_id?: string;
  detail?: Record<string, unknown>;
  description?: string;
  result?: 'success' | 'failure';
  ip?: string;
  created_at: string;
}

/** Access Token 接口范围（与后端常量保持一致） */
export type AccessTokenScope = 'release.doc' | 'repo.compare';

/** Access Token 列表项 */
export interface AccessToken {
  id: string;
  name: string;
  token_prefix: string;
  scopes: AccessTokenScope[];
  is_active: boolean;
  expires_at?: string | null;
  last_used_at?: string | null;
  last_used_ip?: string | null;
  remark?: string;
  created_by?: { id: string; username: string; nickname?: string } | null;
  created_at: string;
  updated_at: string;
}

/** 创建 Access Token 响应，额外带一次性明文 token */
export interface AccessTokenCreated extends AccessToken {
  token: string;
}

export interface AccessTokenPayload {
  name: string;
  scopes: AccessTokenScope[];
  expires_at?: string | null;
  remark?: string;
  is_active?: boolean;
}

export interface AccessTokenListParams {
  search?: string;
  is_active?: boolean;
  page?: number;
  page_size?: number;
}

export interface ConfigListParams {
  keyword?: string;
  page?: number;
  page_size?: number;
}

export interface LogListParams {
  keyword?: string;
  module?: string;
  action?: string;
  user?: string;
  result?: string;
  created_at__gte?: string;
  created_at__lte?: string;
  page?: number;
  page_size?: number;
}

export const systemApi = {
  getConfigs: (params?: ConfigListParams) =>
    get<PaginatedData<SystemConfig>>('/system/configs/', { params }),
  getConfig: (key: string) => get<SystemConfig>(`/system/configs/${key}/`),
  createConfig: (data: Partial<SystemConfig>) => post<SystemConfig>('/system/configs/', data),
  updateConfig: (key: string, data: Partial<SystemConfig>) =>
    put<SystemConfig>(`/system/configs/${key}/`, data),
  patchConfig: (key: string, data: Partial<SystemConfig>) =>
    patch<SystemConfig>(`/system/configs/${key}/`, data),
  deleteConfig: (key: string) => del<null>(`/system/configs/${key}/`),
  testLdapConnection: () => post<{ detail: string }>('/system/configs/ldap-test/', {}),
  /** 读取公开配置（is_public=true，仅需登录），返回 {key: value} 字典 */
  getPublicConfigs: () => get<Record<string, string>>('/system/configs/public/'),
  getLogs: (params?: LogListParams) =>
    get<PaginatedData<SystemLog>>('/system/logs/', { params }),
  listAccessTokens: (params?: AccessTokenListParams) =>
    get<PaginatedData<AccessToken>>('/system/access-tokens/', { params }),
  createAccessToken: (data: AccessTokenPayload) =>
    post<AccessTokenCreated>('/system/access-tokens/', data),
  updateAccessToken: (id: string, data: Partial<AccessTokenPayload>) =>
    patch<AccessToken>(`/system/access-tokens/${id}/`, data),
  deleteAccessToken: (id: string) => del<null>(`/system/access-tokens/${id}/`),
};
