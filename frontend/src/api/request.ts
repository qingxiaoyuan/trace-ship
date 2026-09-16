import axios from 'axios';
import type { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import type { ApiResponse } from '@/types';
import { refreshAccessToken } from './authRefresh';

declare module 'axios' {
  interface AxiosRequestConfig {
    /** 置为 true 时拦截器不再全局 toast 错误，由调用方自行处理 */
    silent?: boolean;
  }
}

/** 统一后的错误对象：保留后端 {code, message} 结构，附加友好提示与权限标记 */
export interface NormalizedError {
  code?: number;
  message?: string;
  data?: unknown;
  /** HTTP 状态码，网络异常时为 undefined */
  status?: number;
  /** 面向用户的具体错误原因 */
  friendlyMessage: string;
  /** 是否为权限不足（HTTP 403 或业务码 403xx） */
  isPermissionDenied: boolean;
  /** 全局 toast 已展示过该错误，页面无需重复提示 */
  __toastShown?: boolean;
}

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

/** 全局错误提示回调（由 AntApp 内部组件注册，拿到带主题的 message 实例） */
let errorNotifier: ((content: string) => void) | null = null;

export function registerErrorNotifier(notifier: (content: string) => void) {
  errorNotifier = notifier;
}

/** 相同内容的 toast 在该时间窗口内只展示一次，避免并发请求失败时刷屏 */
const TOAST_DEDUP_INTERVAL = 1500;
let lastToast: { content: string; time: number } | null = null;

function toastError(content: string) {
  const now = Date.now();
  if (lastToast && lastToast.content === content && now - lastToast.time < TOAST_DEDUP_INTERVAL) {
    return;
  }
  lastToast = { content, time: now };
  errorNotifier?.(content);
}

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
  return url?.includes('/auth/token/refresh') || url?.includes('/auth/login') || url?.includes('/auth/sso/');
}

/** 从后端响应体与 HTTP 状态码中提取面向用户的具体错误原因 */
function extractFriendlyMessage(status: number | undefined, data: unknown): string {
  const body = data as { message?: unknown; detail?: unknown } | undefined;
  if (body && typeof body.message === 'string' && body.message) {
    return body.message;
  }
  if (body && typeof body.detail === 'string' && body.detail) {
    return body.detail;
  }
  switch (status) {
    case 400:
      return '请求参数有误，请检查输入';
    case 401:
      return '登录状态已失效，请重新登录';
    case 403:
      return '没有执行该操作的权限，请联系产品管理员或系统管理员';
    case 404:
      return '请求的资源不存在或已被删除';
    case 409:
      return '操作冲突，请刷新后重试';
    case 500:
      return '服务器内部错误，请稍后重试';
    case 502:
    case 503:
      return '服务暂时不可用，请稍后重试';
    default:
      return status ? `请求失败（HTTP ${status}）` : '网络异常，请检查网络连接';
  }
}

/** 将拦截到的错误规范化为 NormalizedError，并按需全局 toast */
function normalizeError(
  status: number | undefined,
  data: unknown,
  config?: AxiosRequestConfig,
): NormalizedError {
  const body = (data ?? {}) as { code?: number; message?: string; data?: unknown };
  const friendlyMessage = extractFriendlyMessage(status, data);
  const isPermissionDenied =
    status === 403 || (typeof body.code === 'number' && Math.floor(body.code / 100) === 403);
  const normalized: NormalizedError = {
    code: body.code,
    message: body.message ?? friendlyMessage,
    data: body.data,
    status,
    friendlyMessage,
    isPermissionDenied,
  };
  if (!config?.silent) {
    normalized.__toastShown = true;
    toastError(friendlyMessage);
  }
  return normalized;
}

request.interceptors.request.use(
  async (config) => {
    const token = localStorage.getItem('accessToken');
    // 登录、刷新 Token 等认证接口本身不依赖旧的 access token，避免带上过期 token 导致 401
    if (token && config.headers && !isAuthRequest(config.url)) {
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
    const res = response.data as ApiResponse<unknown> | string | null;
    // 后端约定返回 {code, message, data} 信封；遇到网关/代理注入的 HTML 错误页、
    // 空响应体等非信封数据时按失败处理，避免页面按信封字段解析导致崩掉
    if (!res || typeof res !== 'object' || typeof res.code !== 'number') {
      return Promise.reject(
        normalizeError(
          response.status,
          { message: '服务返回了无法识别的数据，请稍后重试' },
          response.config,
        ),
      );
    }
    if (res.code !== 0) {
      return Promise.reject(normalizeError(response.status, res, response.config));
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

    return Promise.reject(
      normalizeError(error.response?.status, data ?? error.message, originalRequest),
    );
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
