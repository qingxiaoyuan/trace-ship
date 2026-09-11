import { get, post, put, patch, del } from './request';
import type {
  PaginatedData,
  ProductComponent,
  Project,
  ProjectStats,
  ProjectStatus,
  Repository,
  RepositoryBranch,
  RepositoryTag,
} from '@/types';

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
  getProjectStats: () => get<ProjectStats>('/projects/stats/'),
  createProject: (data: Partial<Project>) => post<Project>('/projects/', data),
  updateProject: (id: string, data: Partial<Project>) =>
    put<Project>(`/projects/${id}/`, data),
  patchProject: (id: string, data: Partial<Project>) =>
    patch<Project>(`/projects/${id}/`, data),
  deleteProject: (id: string) => del<null>(`/projects/${id}/`),
  getComponents: (projectId: string) =>
    get<ProductComponent[]>(`/projects/${projectId}/components/`),
  getAvailableRepositories: (projectId: string, search?: string) =>
    get<Repository[]>(`/projects/${projectId}/components/available/`, {
      params: search ? { search } : undefined,
    }),
  createComponent: (projectId: string, data: Partial<ProductComponent>) =>
    post<ProductComponent>(`/projects/${projectId}/components/`, data),
  updateComponent: (projectId: string, id: string, data: Partial<ProductComponent>) =>
    patch<ProductComponent>(`/projects/${projectId}/components/${id}/`, data),
  deleteComponent: (projectId: string, id: string) =>
    del<null>(`/projects/${projectId}/components/${id}/`),
  getComponentBranches: (projectId: string, id: string, credentialLoan?: string) =>
    get<RepositoryBranch[]>(`/projects/${projectId}/components/${id}/branches/`, {
      params: credentialLoan ? { credential_loan: credentialLoan } : undefined,
    }),
  getComponentTags: (projectId: string, id: string, credentialLoan?: string) =>
    get<RepositoryTag[]>(`/projects/${projectId}/components/${id}/tags/`, {
      params: credentialLoan ? { credential_loan: credentialLoan } : undefined,
    }),
  getComponentNextVersion: (
    projectId: string,
    id: string,
    releaseType: string,
    credentialLoan?: string,
  ) => get<{ next_version: string; next_tag_name: string }>(
    `/projects/${projectId}/components/${id}/next-version/`,
    { params: { release_type: releaseType, credential_loan: credentialLoan } },
  ),
};
