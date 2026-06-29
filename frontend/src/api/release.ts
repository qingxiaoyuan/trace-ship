import { get, post } from './request';
import type { PaginatedData, Release, ReleaseCommit } from '@/types';

export const releaseApi = {
  getReleases: (params?: Record<string, unknown>) =>
    get<PaginatedData<Release>>('/releases/', { params }),
  getRelease: (id: string) => get<Release>(`/releases/${id}/`),
  createRelease: (data: Partial<Release> & { project: string; repository: string; release_type: string; source_branch: string; target_branch: string }) =>
    post<Release>('/releases/', data),
  generateDoc: (id: string, data?: { commit_ids?: string[]; merge_similar?: boolean }) =>
    post<unknown>(`/releases/${id}/generate-doc/`, data || {}),
  submitAudit: (id: string) =>
    post<{ id: string; status: string; workflow_instance_id?: string }>(`/releases/${id}/submit-audit/`, {}),
  pushTag: (id: string) => post<Release>(`/releases/${id}/push-tag/`, {}),
  getCommits: (id: string, params?: Record<string, unknown>) =>
    get<PaginatedData<ReleaseCommit>>(`/releases/${id}/commits/`, { params }),
  exportPdf: (id: string) =>
    get<Blob>(`/releases/${id}/export-pdf/`, { responseType: 'blob' }),
  exportWord: (id: string) =>
    get<Blob>(`/releases/${id}/export-word/`, { responseType: 'blob' }),
  getCatalog: () => get<{ formal: Release[]; rc: Release[]; beta: Release[] }>('/releases/catalog/'),
};
