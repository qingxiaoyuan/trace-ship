import { get, post } from './request';
import type { PaginatedData, Release } from '@/types';

export const releaseApi = {
  getReleases: (params?: Record<string, unknown>) =>
    get<PaginatedData<Release>>('/releases/', { params }),
  getRelease: (id: string) => get<Release>(`/releases/${id}/`),
  createRelease: (data: Partial<Release> & { project: string; repository: string; release_type: string; source_branch: string; target_branch: string }) =>
    post<Release>('/releases/', data),
  exportPdf: (id: string) =>
    get<Blob>(`/releases/${id}/export-pdf/`, { responseType: 'blob' }),
  exportWord: (id: string) =>
    get<Blob>(`/releases/${id}/export-word/`, { responseType: 'blob' }),
  getCatalog: () => get<{ formal: Release[]; test: Release[] }>('/releases/catalog/'),
  submitAudit: (id: string) =>
    post<{ id: string; status: string; workflow_instance_id?: string }>(`/releases/${id}/submit-audit/`, {}),
};
