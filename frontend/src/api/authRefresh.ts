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
  const body = res.data;
  // 后端约定返回 {code, message, data} 信封；遇到 HTML 错误页、空响应等
  // 非信封数据时主动抛错，由调用方走重新登录流程，避免解析崩掉
  if (!body || typeof body !== 'object' || body.code !== 0 || !body.data?.access) {
    throw new Error('登录状态已失效，请重新登录');
  }
  return body.data;
}
