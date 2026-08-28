import { get, post, put, patch, del } from './request';
import { refreshAccessToken } from './authRefresh';
import type {
  AIGenerateScriptPayload,
  AIScriptDraft,
  AIScriptStreamEvent,
  AvailableImageResult,
  NexusImageSearchResult,
  NexusRepository,
  PackageConfig,
  PackageImage,
  PackageImageSource,
  PackageKnowledge,
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
  triggered_by?: string;
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
    os_type?: 'windows' | 'kylin';
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
  /** 按仓库某条分支最新代码直接触发打包（不经发布流程，任务标题与编码按分支名命名） */
  triggerConfigBranch: (id: string, branch: string) =>
    post<PackageTask>(`/packages/configs/${id}/trigger-branch/`, { branch }),
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
  /** AI 生成打包脚本草稿（支持未保存配置，请求体携带当前表单值） */
  aiGenerateScript: (data: AIGenerateScriptPayload) =>
    post<AIScriptDraft>('/packages/configs/ai-generate-script/', data, {
      // 仓库扫描 + 容器探测 + AI 生成耗时较长，放宽超时
      timeout: 300_000,
    }),
  /** AI 生成打包脚本草稿（SSE 流式：delta 实时文本 / done 结果 / error 失败） */
  async *aiGenerateScriptStream(
    data: AIGenerateScriptPayload,
  ): AsyncGenerator<AIScriptStreamEvent> {
    const base = import.meta.env.VITE_API_BASE_URL || '/api';
    const url = `${base}/packages/configs/ai-generate-script-stream/`;
    let token = localStorage.getItem('accessToken');
    const doFetch = async (): Promise<Response> =>
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(data),
      });
    let resp = await doFetch();
    if (resp.status === 401) {
      // access token 过期：刷新一次后重试（与 request.ts 的刷新逻辑一致）
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken) {
        try {
          const res = await refreshAccessToken(refreshToken);
          localStorage.setItem('accessToken', res.access);
          if (res.refresh) {
            localStorage.setItem('refreshToken', res.refresh);
          }
          token = res.access;
          resp = await doFetch();
        } catch {
          // 刷新失败：沿用 401 响应走下方错误处理
        }
      }
    }
    if (!resp.ok || !resp.body) {
      let message = `请求失败（HTTP ${resp.status || '未知'}）`;
      try {
        const body = (await resp.json()) as { message?: string };
        message = body?.message || message;
      } catch {
        // 非 JSON 错误体，保留通用提示
      }
      throw new Error(message);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // 统一换行分帧，兼容代理把 \n\n 改写为 \r\n\r\n 的情况
      buffer = buffer.replace(/\r\n/g, '\n');
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, sep).trim();
        buffer = buffer.slice(sep + 2);
        if (!raw.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(raw.slice(6)) as AIScriptStreamEvent;
          yield event;
        } catch {
          // 忽略不完整的半截事件
        }
      }
    }
  },
  /** AI 打包通用知识库（系统级上下文） */
  getKnowledge: (params?: { is_active?: boolean; search?: string; page?: number; page_size?: number }) =>
    get<PaginatedData<PackageKnowledge>>('/packages/knowledge/', { params }),
  createKnowledge: (data: Partial<PackageKnowledge>) =>
    post<PackageKnowledge>('/packages/knowledge/', data),
  updateKnowledge: (id: string, data: Partial<PackageKnowledge>) =>
    put<PackageKnowledge>(`/packages/knowledge/${id}/`, data),
  patchKnowledge: (id: string, data: Partial<PackageKnowledge>) =>
    patch<PackageKnowledge>(`/packages/knowledge/${id}/`, data),
  deleteKnowledge: (id: string) => del<null>(`/packages/knowledge/${id}/`),

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
