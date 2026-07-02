import { get, post, put, del } from './request';
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
  keyword?: string;
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
    put<Repository>(`/repositories/${id}/`, data),
  deleteRepository: (id: string) => del<null>(`/repositories/${id}/`),
  testRepository: (id: string) =>
    post<{ connected: boolean; detail?: string }>(`/repositories/${id}/test/`, {}),
  syncCommits: (id: string) => post<unknown>(`/repositories/${id}/sync-commits/`, {}),
  getVendors: () => get<{ value: string; label: string }[]>('/repositories/vendors/'),
  getBranches: (id: string) => get<RepositoryBranch[]>(`/repositories/${id}/branches/`),
  getTags: (id: string) => get<RepositoryTag[]>(`/repositories/${id}/tags/`),
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
  previewChanges: (id: string, branch: string) =>
    get<ChangesPreview>(`/repositories/${id}/changes-preview/`, { params: { branch } }),
  reviewRange: (id: string, tag?: string) =>
    get<ReviewRangeResult>(`/repositories/${id}/review-range/`, {
      params: { tag: tag || 'latest' },
    }),
};
