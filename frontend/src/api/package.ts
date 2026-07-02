import { get, post, put, patch, del } from './request';
import type { PackageConfig, PackageImage, PackageTask, PaginatedData, PackageBuildType } from '@/types';

export interface PackageImageListParams {
  build_type?: PackageBuildType;
  is_active?: boolean;
  page?: number;
  page_size?: number;
}

export interface PackageConfigListParams {
  project?: string;
  repository?: string;
  mode?: string;
  build_type?: PackageBuildType;
  is_active?: boolean;
  auto_package_on_release?: boolean;
  page?: number;
  page_size?: number;
}

export interface PackageTaskListParams {
  project?: string;
  repository?: string;
  release?: string;
  config?: string;
  status?: string;
  mode?: string;
  build_type?: PackageBuildType;
  page?: number;
  page_size?: number;
}

export const packageApi = {
  getImages: (params?: PackageImageListParams) =>
    get<PaginatedData<PackageImage>>('/packages/images/', { params }),
  createImage: (data: Partial<PackageImage>) => post<PackageImage>('/packages/images/', data),
  updateImage: (id: string, data: Partial<PackageImage>) =>
    put<PackageImage>(`/packages/images/${id}/`, data),
  deleteImage: (id: string) => del<null>(`/packages/images/${id}/`),

  getConfigs: (params?: PackageConfigListParams) =>
    get<PaginatedData<PackageConfig>>('/packages/configs/', { params }),
  createConfig: (data: Partial<PackageConfig>) => post<PackageConfig>('/packages/configs/', data),
  updateConfig: (id: string, data: Partial<PackageConfig>) =>
    put<PackageConfig>(`/packages/configs/${id}/`, data),
  patchConfig: (id: string, data: Partial<PackageConfig>) =>
    patch<PackageConfig>(`/packages/configs/${id}/`, data),
  deleteConfig: (id: string) => del<null>(`/packages/configs/${id}/`),
  triggerConfig: (id: string, releaseId: string) =>
    post<PackageTask>(`/packages/configs/${id}/trigger/`, { release_id: releaseId }),

  getTasks: (params?: PackageTaskListParams) =>
    get<PaginatedData<PackageTask>>('/packages/tasks/', { params }),
  getTask: (id: string) => get<PackageTask>(`/packages/tasks/${id}/`),
  getTaskLog: (id: string) => get<Blob>(`/packages/tasks/${id}/logs/`, { responseType: 'blob' }),
  downloadArtifact: (taskId: string, artifactId: string) =>
    get<Blob>(`/packages/tasks/${taskId}/artifacts/${artifactId}/download/`, { responseType: 'blob' }),
};
