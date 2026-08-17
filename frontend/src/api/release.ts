import { del, get, post } from './request';
import type { PaginatedData, Release } from '@/types';

export const releaseApi = {
  getReleases: (params?: Record<string, unknown>) =>
    get<PaginatedData<Release>>('/releases/', { params }),
  getRelease: (id: string) => get<Release>(`/releases/${id}/`),
  createRelease: (data: Record<string, unknown>) =>
    post<Release>('/releases/', data),
  /** 删除草稿 / 已驳回发布（仅草稿、已驳回状态可删） */
  deleteRelease: (id: string) => del<null>(`/releases/${id}/`),
  generateDoc: (id: string, data?: { commit_ids?: string[]; merge_similar?: boolean }) =>
    post<string>(`/releases/${id}/generate-doc/`, data || {}),
  updateDoc: (id: string, releaseDoc: string) =>
    post<Release>(`/releases/${id}/update-doc/`, { release_doc: releaseDoc }),
  submitAudit: (id: string) =>
    post<{ id: string; status: string; workflow_instance_id?: string }>(`/releases/${id}/submit-audit/`, {}),
  pushTag: (id: string) => post<Release>(`/releases/${id}/push-tag/`, {}),
  /** 删除已发布版本：需输入完整 tag 名称二次确认 */
  deleteReleased: (id: string, tagName: string) =>
    post<{ tag_name: string; remote_deleted: boolean }>(`/releases/${id}/delete-released/`, {
      tag_name: tagName,
    }),
  exportPdf: (id: string) =>
    get<Blob>(`/releases/${id}/export-pdf/`, { responseType: 'blob' }),
  exportWord: (id: string) =>
    get<Blob>(`/releases/${id}/export-word/`, { responseType: 'blob' }),
  exportMd: (id: string) =>
    get<Blob>(`/releases/${id}/export-md/`, { responseType: 'blob' }),
  getCatalog: () => get<{ formal: Release[]; rc: Release[]; beta: Release[] }>('/releases/catalog/'),
};
