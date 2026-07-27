import { get, post, put, patch, del } from './request';
import type {
  NexusImageSearchResult,
  NexusRepository,
  PackageConfig,
  PackageImage,
  PackageTask,
  PaginatedData,
  PackageBuildType,
  SvnEntriesData,
} from '@/types';

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

  getNexusRepositories: () => get<NexusRepository[]>('/packages/images/nexus-repositories/'),
  getNexusImages: (params: { repository?: string; keyword?: string; continuation_token?: string }) =>
    get<NexusImageSearchResult>('/packages/images/nexus-images/', { params }),

  getConfigs: (params?: PackageConfigListParams) =>
    get<PaginatedData<PackageConfig>>('/packages/configs/', { params }),
  getConfig: (id: string) => get<PackageConfig>(`/packages/configs/${id}/`),
  createConfig: (data: Partial<PackageConfig>) => post<PackageConfig>('/packages/configs/', data),
  updateConfig: (id: string, data: Partial<PackageConfig>) =>
    put<PackageConfig>(`/packages/configs/${id}/`, data),
  patchConfig: (id: string, data: Partial<PackageConfig>) =>
    patch<PackageConfig>(`/packages/configs/${id}/`, data),
  deleteConfig: (id: string) => del<null>(`/packages/configs/${id}/`),
  triggerConfig: (id: string, releaseId: string) =>
    post<PackageTask>(`/packages/configs/${id}/trigger/`, { release_id: releaseId }),
 /** 实时浏览打包配置的 SVN 制品目录（path 为相对 svn_url 的子路径） */
 listSvnEntries: (id: string, path?: string) =>
   get<SvnEntriesData>(`/packages/configs/${id}/svn-entries/`, { params: { path: path || '' } }),
  /** 测试 SVN 推送配置连通性（支持未保存配置） */
  testSvn: (data: {
    project_id: string;
    svn_url: string;
    svn_credential_id: string;
    svn_path_template?: string;
  }) => post<{ ok: boolean; entries: Array<{ name: string; kind: string }>; message: string }>(
    '/packages/configs/test-svn/',
    data
  ),

  getTasks: (params?: PackageTaskListParams) =>
    get<PaginatedData<PackageTask>>('/packages/tasks/', { params }),
  getTask: (id: string) => get<PackageTask>(`/packages/tasks/${id}/`),
  cancelTask: (id: string) => post<PackageTask>(`/packages/tasks/${id}/cancel/`),
  pushSvn: (id: string) => post<PackageTask>(`/packages/tasks/${id}/push-svn/`),
  getTaskLog: (id: string) => get<Blob>(`/packages/tasks/${id}/logs/`, { responseType: 'blob' }),
  downloadArtifact: (taskId: string, artifactId: string) =>
   get<Blob>(`/packages/tasks/${taskId}/artifacts/${artifactId}/download/`, { responseType: 'blob' }),
  downloadAllArtifacts: (taskId: string) =>
    get<Blob>(`/packages/tasks/${taskId}/download-all/`, { responseType: 'blob' }),
};
