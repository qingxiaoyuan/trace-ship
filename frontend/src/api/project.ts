import { get, post, put, patch, del } from './request';
import type { PaginatedData, Project, ProjectStatus } from '@/types';

export interface ProjectListParams {
  keyword?: string;
  status?: ProjectStatus;
  page?: number;
  page_size?: number;
}

export const projectApi = {
  getProjects: (params?: ProjectListParams) =>
    get<PaginatedData<Project>>('/projects/', { params }),
  getProject: (id: string) => get<Project>(`/projects/${id}/`),
  createProject: (data: Partial<Project>) => post<Project>('/projects/', data),
  updateProject: (id: string, data: Partial<Project>) =>
    put<Project>(`/projects/${id}/`, data),
  patchProject: (id: string, data: Partial<Project>) =>
    patch<Project>(`/projects/${id}/`, data),
  deleteProject: (id: string) => del<null>(`/projects/${id}/`),
};
