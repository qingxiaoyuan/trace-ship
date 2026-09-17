import { get, post, patch, del } from './request';
import type {
  ChangesPreview,
  CommitRecord,
  PaginatedData,
  RepoComplianceStat,
  Repository,
  RepositoryBranch,
  RepositoryStats,
  RepositoryTag,
  ReviewRangeResult,
} from '@/types';

export interface RepositoryListParams {
  search?: string;
  project?: string;
  credential?: string;
  repo_type?: string;
  page?: number;
  page_size?: number;
}

export const repositoryApi = {
  getRepositories: (params?: RepositoryListParams) =>
    get<PaginatedData<Repository>>('/repositories/', { params }),
  getRepository: (id: string) => get<Repository>(`/repositories/${id}/`),
  getRepositoryStats: () => get<RepositoryStats>('/repositories/stats/'),
  getComplianceStats: () => get<RepoComplianceStat[]>('/repositories/compliance-stats/'),
  createRepository: (data: Partial<Repository>) => post<Repository>('/repositories/', data),
  updateRepository: (id: string, data: Partial<Repository>) =>
    patch<Repository>(`/repositories/${id}/`, data),
  deleteRepository: (id: string) => del<null>(`/repositories/${id}/`),
  testRepository: (id: string) =>
    post<{ connected: boolean; detail?: string }>(`/repositories/${id}/test/`, {}),
  syncCommits: (id: string) => post<unknown>(`/repositories/${id}/sync-commits/`, {}),
  syncBranches: (id: string) =>
    post<{ synced_count: number; total: number; detail?: string }>(
      `/repositories/${id}/sync-branches/`,
      {},
    ),
  getVendors: () => get<{ value: string; label: string }[]>('/repositories/vendors/'),
  getBranches: (id: string) => get<RepositoryBranch[]>(`/repositories/${id}/branches/`),
  getTags: (id: string) => get<RepositoryTag[]>(`/repositories/${id}/tags/`),
  /** 删除仓库标签：需输入完整 tag 名称二次确认（仅项目管理员） */
  deleteTag: (id: string, tagName: string) =>
    post<{ tag_name: string; remote_deleted: boolean }>(`/repositories/${id}/delete-tag/`, {
      tag_name: tagName,
    }),
  getRepositoryCommits: (id: string, params?: Record<string, unknown>) =>
    get<PaginatedData<CommitRecord>>(`/repositories/${id}/commits/`, { params }),
  getNextVersion: (id: string, releaseType: string) =>
    get<{
      latest_tag: string | null;
      next_version: string;
      next_tag_name: string;
      has_existing_tags: boolean;
      all_types: Record<
        'formal' | 'rc' | 'beta',
        {
          latest_tag: string | null;
          next_version: string;
          next_tag_name: string;
        }
      >;
    }>(`/repositories/${id}/next-version/`, { params: { release_type: releaseType } }),
  previewChanges: (id: string, branch: string, releaseType: string = 'formal') =>
    get<ChangesPreview>(`/repositories/${id}/changes-preview/`, {
      params: { branch, release_type: releaseType },
    }),
  reviewRange: (id: string, baseTag?: string, headTag?: string) =>
    get<ReviewRangeResult>(`/repositories/${id}/review-range/`, {
      params: { base: baseTag || undefined, head: headTag || undefined },
    }),
};
