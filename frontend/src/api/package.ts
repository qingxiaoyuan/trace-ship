import { get, post, put, patch, del } from './request';
import type {
  AvailableImageResult,
  NexusImageSearchResult,
  NexusRepository,
  PackageConfig,
  PackageImage,
  PackageImageSource,
  PackageNode,
  PackageNodeTestResult,
  PackageTask,
  PaginatedData,
  SvnEntriesData,
} from '@/types';

export interface PackageImageListParams {
  source?: PackageImageSource;
  is_active?: boolean;
  page?: number;
  page_size?: number;
}

export interface PackageConfigListParams {
  project?: string;
  repository?: string;
  mode?: string;
  is_active?: boolean;
  auto_package_on_release?: boolean;
  page?: number;
  page_size?: number;
}

/** 任务日志增量分片（tail 截尾 / offset 增量模式） */
export interface TaskLogChunk {
  /** 日志文件总字节数（即下次轮询应传的 offset） */
  size: number;
  /** 本次内容的起始字节位置 */
  offset: number;
  content: string;
  /** 日志文件被截断/重建时为 true，内容为全量 */
  truncated?: boolean;
}

export interface PackageTaskListParams {  project?: string;
  repository?: string;
  release?: string;
  config?: string;
  status?: string;
  mode?: string;
  search?: string;
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
  /** 聚合列出可选打包镜像（本地 Docker + Nexus） */
  getAvailableImages: (params?: { source?: PackageImageSource; keyword?: string }) =>
    get<AvailableImageResult>('/packages/images/available/', { params }),
  /** 上传镜像 tar 包导入本地 Docker */
  importImage: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return post<{ loaded: string[] }>('/packages/images/import/', formData, {
      headers: { 'Content-Type': undefined },
      // 镜像包通常较大，放宽超时到 10 分钟
      timeout: 600_000,
    });
  },

  getNodes: (params?: { is_active?: boolean; keyword?: string; page?: number; page_size?: number }) =>
    get<PaginatedData<PackageNode>>('/packages/nodes/', { params }),
  createNode: (data: Partial<PackageNode>) => post<PackageNode>('/packages/nodes/', data),
  updateNode: (id: string, data: Partial<PackageNode>) =>
    put<PackageNode>(`/packages/nodes/${id}/`, data),
  patchNode: (id: string, data: Partial<PackageNode>) =>
    patch<PackageNode>(`/packages/nodes/${id}/`, data),
  deleteNode: (id: string) => del<null>(`/packages/nodes/${id}/`),
  /** 测试已保存节点的 SSH 连通性 */
  testNode: (id: string) => post<PackageNodeTestResult>(`/packages/nodes/${id}/test/`),
  /** 测试未保存的节点连接参数 */
  testNodeConnection: (data: {
    host: string;
    port?: number;
    credential_id: string;
    work_root?: string;
  }) => post<PackageNodeTestResult>('/packages/nodes/test-connection/', data),

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
  deleteTask: (id: string) => del<null>(`/packages/tasks/${id}/`),
  pushSvn: (id: string) => post<PackageTask>(`/packages/tasks/${id}/push-svn/`),
  getTaskLog: (id: string) => get<Blob>(`/packages/tasks/${id}/logs/`, { responseType: 'blob' }),
  /** 增量读取任务日志：tail 取末尾字节（首屏），offset 取增量（轮询） */
  getTaskLogChunk: (id: string, params: { offset?: number; tail?: number }) =>
    get<TaskLogChunk>(`/packages/tasks/${id}/logs/`, { params }),
  downloadArtifact: (taskId: string, artifactId: string) =>
   get<Blob>(`/packages/tasks/${taskId}/artifacts/${artifactId}/download/`, { responseType: 'blob' }),
  downloadAllArtifacts: (taskId: string) =>
    get<Blob>(`/packages/tasks/${taskId}/download-all/`, { responseType: 'blob' }),
};
