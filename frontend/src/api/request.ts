import axios from 'axios';
import type { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import type { ApiResponse } from '@/types';
import { useAuthStore } from '@/stores/authStore';

const request: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

request.interceptors.request.use(
  async (config) => {
    if (import.meta.env.DEV) {
      const { shouldMock, mockRequest } = await import('./mock');
      const fullUrl = (config.baseURL || '') + (config.url || '');
      if (shouldMock(fullUrl)) {
        const mockResponse = await mockRequest(config);
        if (mockResponse) {
          config.adapter = async () => mockResponse;
        }
      }
    }
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
    const res = response.data as ApiResponse<unknown>;
    if (res.code !== 0) {
      return Promise.reject(res);
    }
    return response;
  },
  (error: AxiosError<ApiResponse<unknown>>) => {
    const data = error.response?.data;
    if (error.response?.status === 401 || data?.code === 40100) {
      useAuthStore.getState().clearAuth();
      window.location.href = '/login';
    }
    return Promise.reject(data || error);
  }
);

export async function get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const res = await request.get<ApiResponse<T>>(url, config);
  return res.data.data;
}

export async function post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const res = await request.post<ApiResponse<T>>(url, data, config);
  return res.data.data;
}

export async function put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const res = await request.put<ApiResponse<T>>(url, data, config);
  return res.data.data;
}

export async function del<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const res = await request.delete<ApiResponse<T>>(url, config);
  return res.data.data;
}

export default request;
