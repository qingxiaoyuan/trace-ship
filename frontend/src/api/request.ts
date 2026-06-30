import axios from 'axios';
import type { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import type { ApiResponse } from '@/types';
import { refreshAccessToken } from './authRefresh';

const request: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

export interface AuthHandlers {
  getRefreshToken: () => string | null;
  onRefreshSuccess: (accessToken: string, refreshToken?: string) => void;
  onRefreshFailed: () => void;
}

let authHandlers: AuthHandlers | null = null;

/**
 * 注册认证相关的回调处理器。
 *
 * 由应用启动时设置，避免 request.ts 直接依赖 authStore / authApi，
 * 从而打破模块间的循环依赖。
 */
export function registerAuthHandlers(handlers: AuthHandlers) {
  authHandlers = handlers;
}

function getRefreshToken(): string | null {
  return authHandlers?.getRefreshToken() ?? localStorage.getItem('refreshToken');
}

function clearAuthAndRedirect() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  authHandlers?.onRefreshFailed();
}

function onRefreshed(token: string) {
  refreshSubscribers.forEach((callback) => callback(token));
  refreshSubscribers = [];
}

function isAuthRequest(url?: string) {
  return url?.includes('/auth/token/refresh') || url?.includes('/auth/login');
}

request.interceptors.request.use(
  async (config) => {
    const token = localStorage.getItem('accessToken');
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

request.interceptors.response.use(
  (response) => {
    // 二进制流直接透传，不包装为 ApiResponse 校验
    if (response.config.responseType === 'blob' || response.data instanceof Blob) {
      return response;
    }
    const res = response.data as ApiResponse<unknown>;
    if (res.code !== 0) {
      return Promise.reject(res);
    }
    return response;
  },
  (error: AxiosError<ApiResponse<unknown>>) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };
    const data = error.response?.data;

    if (isAuthRequest(originalRequest?.url)) {
      return Promise.reject(data || error);
    }

    if (
      !originalRequest?._retry &&
      (error.response?.status === 401 || data?.code === 40100)
    ) {
      if (isRefreshing) {
        return new Promise((resolve) => {
          refreshSubscribers.push((token: string) => {
            originalRequest.headers = originalRequest.headers || {};
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(request(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = getRefreshToken();
      if (!refreshToken) {
        clearAuthAndRedirect();
        return Promise.reject(data || error);
      }

      return new Promise((resolve, reject) => {
        refreshAccessToken(refreshToken)
          .then((res) => {
            const newAccessToken = res.access;
            const newRefreshToken = res.refresh || refreshToken;
            localStorage.setItem('accessToken', newAccessToken);
            localStorage.setItem('refreshToken', newRefreshToken);
            authHandlers?.onRefreshSuccess(newAccessToken, newRefreshToken);
            request.defaults.headers.common.Authorization = `Bearer ${newAccessToken}`;
            onRefreshed(newAccessToken);
            originalRequest.headers = originalRequest.headers || {};
            originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
            resolve(request(originalRequest));
          })
          .catch((refreshError) => {
            clearAuthAndRedirect();
            reject(refreshError);
          })
          .finally(() => {
            isRefreshing = false;
          });
      });
    }

    return Promise.reject(data || error);
  }
);

export async function get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const res = await request.get<ApiResponse<T>>(url, config);
  if (res.data instanceof Blob) {
    return res.data as T;
  }
  return res.data.data;
}

export async function post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const res = await request.post<ApiResponse<T>>(url, data, config);
  if (res.data instanceof Blob) {
    return res.data as T;
  }
  return res.data.data;
}

export async function put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const res = await request.put<ApiResponse<T>>(url, data, config);
  if (res.data instanceof Blob) {
    return res.data as T;
  }
  return res.data.data;
}

export async function patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const res = await request.patch<ApiResponse<T>>(url, data, config);
  if (res.data instanceof Blob) {
    return res.data as T;
  }
  return res.data.data;
}

export async function del<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const res = await request.delete<ApiResponse<T>>(url, config);
  if (res.data instanceof Blob) {
    return res.data as T;
  }
  return res.data.data;
}

export default request;
