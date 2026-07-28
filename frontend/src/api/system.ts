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
  getLogs: (params?: LogListParams) =>
    get<PaginatedData<SystemLog>>('/system/logs/', { params }),
};
