import axios from 'axios';
import type { ApiResponse } from '@/types';

export interface RefreshResult {
  access: string;
  refresh?: string;
  expires_in?: number;
}

const baseURL = import.meta.env.VITE_API_BASE_URL || '/api';

/**
 * 使用独立 axios 实例刷新 access token，避免与 api/request.ts 形成循环依赖。
 */
export async function refreshAccessToken(refresh: string): Promise<RefreshResult> {
  const res = await axios.post<ApiResponse<RefreshResult>>(
    `${baseURL}/auth/token/refresh/`,
    { refresh }
  );
  return res.data.data;
}
