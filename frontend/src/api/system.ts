import { get, post, put, del } from './request';
import type { PaginatedData } from '@/types';

export interface SystemConfig {
  key: string;
  name: string;
  value: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SystemLog {
  id: string;
  user_id?: string;
  username?: string;
  action: string;
  module: string;
  resource_type?: string;
  resource_id?: string;
  detail?: string;
  ip_address?: string;
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
  deleteConfig: (key: string) => del<null>(`/system/configs/${key}/`),
  getLogs: (params?: LogListParams) =>
    get<PaginatedData<SystemLog>>('/system/logs/', { params }),
};
