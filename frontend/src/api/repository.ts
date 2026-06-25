import { get, post, put, del } from './request';
import type { PaginatedData, Repository } from '@/types';

export interface RepositoryListParams {
  keyword?: string;
  project_id?: string;
  repo_type?: string;
  page?: number;
  page_size?: number;
}

export const repositoryApi = {
  getRepositories: (params?: RepositoryListParams) =>
    get<PaginatedData<Repository>>('/repositories/', { params }),
  getRepository: (id: string) => get<Repository>(`/repositories/${id}/`),
  createRepository: (data: Partial<Repository>) => post<Repository>('/repositories/', data),
  updateRepository: (id: string, data: Partial<Repository>) =>
    put<Repository>(`/repositories/${id}/`, data),
  deleteRepository: (id: string) => del<null>(`/repositories/${id}/`),
  testRepository: (id: string) =>
    post<{ connected: boolean; detail?: string }>(`/repositories/${id}/test/`, {}),
  syncCommits: (id: string) => post<unknown>(`/repositories/${id}/sync-commits/`, {}),
  getVendors: () => get<{ value: string; label: string }[]>('/repositories/vendors/'),
};
