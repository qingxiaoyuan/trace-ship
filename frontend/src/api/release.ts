import { get, post } from './request';
import type { PaginatedData, Release } from '@/types';

export const releaseApi = {
  getReleases: (params?: Record<string, unknown>) =>
    get<PaginatedData<Release>>('/releases/', { params }),
  getRelease: (id: string) => get<Release>(`/releases/${id}/`),
  createRelease: (data: Record<string, unknown>) =>
    post<Release>('/releases/', data),
  generateDoc: (id: string, data?: { commit_ids?: string[]; merge_similar?: boolean }) =>
    post<string>(`/releases/${id}/generate-doc/`, data || {}),
  updateDoc: (id: string, releaseDoc: string) =>
    post<Release>(`/releases/${id}/update-doc/`, { release_doc: releaseDoc }),
  submitAudit: (id: string) =>
    post<{ id: string; status: string; workflow_instance_id?: string }>(`/releases/${id}/submit-audit/`, {}),
  pushTag: (id: string) => post<Release>(`/releases/${id}/push-tag/`, {}),
  exportPdf: (id: string) =>
    get<Blob>(`/releases/${id}/export-pdf/`, { responseType: 'blob' }),
  exportWord: (id: string) =>
    get<Blob>(`/releases/${id}/export-word/`, { responseType: 'blob' }),
  exportMd: (id: string) =>
    get<Blob>(`/releases/${id}/export-md/`, { responseType: 'blob' }),
  getCatalog: () => get<{ formal: Release[]; rc: Release[]; beta: Release[] }>('/releases/catalog/'),
};
