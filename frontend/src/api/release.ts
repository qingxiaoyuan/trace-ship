import { del, get, post } from './request';
import type {
  PaginatedData,
  Release,
  ReleaseCommit,
  ReleaseReviewIssue,
  SvnSyncResult,
} from '@/types';

export const releaseApi = {
  getReleases: (params?: Record<string, unknown>) =>
    get<PaginatedData<Release>>('/releases/', { params }),
  getRelease: (id: string) => get<Release>(`/releases/${id}/`),
  createRelease: (data: Record<string, unknown>) =>
    post<Release>('/releases/', data),
  /** 删除草稿 / 已驳回发布（仅草稿、已驳回状态可删） */
  deleteRelease: (id: string) => del<null>(`/releases/${id}/`),
  generateDoc: (id: string, data?: { commit_ids?: string[]; merge_similar?: boolean }) =>
    post<string>(`/releases/${id}/generate-doc/`, data || {}, {
      // 发布说明内容较多时生成耗时较长，放宽到 5 分钟，避免默认 30s 超时失败
      timeout: 300_000,
    }),
  updateDoc: (id: string, releaseDoc: string) =>
    post<Release & { svn_sync_results?: SvnSyncResult[] }>(`/releases/${id}/update-doc/`, {
      release_doc: releaseDoc,
    }),
  submitAudit: (id: string) =>
    post<{ id: string; status: string; workflow_instance_id?: string }>(`/releases/${id}/submit-audit/`, {}),
  pushTag: (id: string) => post<Release>(`/releases/${id}/push-tag/`, {}),
  /** 推 tag 失败后重试（仅审批已通过、推 tag 环节失败的已驳回发布可用） */
  retryPushTag: (id: string) => post<Release>(`/releases/${id}/retry-push-tag/`, {}),
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
  /** 发布关联提交快照（分页） */
  getCommits: (id: string, params?: Record<string, unknown>) =>
    get<PaginatedData<ReleaseCommit>>(`/releases/${id}/commits/`, { params }),
  /** 获取发布文档整改意见列表 */
  getReviewIssues: (id: string) => get<ReleaseReviewIssue[]>(`/releases/${id}/review-issues/`),
  /** 发起整改意见（审查员） */
  createReviewIssue: (id: string, content: string) =>
    post<ReleaseReviewIssue>(`/releases/${id}/review-issues/`, { content }),
  /** 发布人回复整改意见 */
  replyReviewIssue: (id: string, issueId: string, content: string) =>
    post<ReleaseReviewIssue>(`/releases/${id}/review-issues/${issueId}/reply/`, { content }),
  /** 审查员通过整改意见 */
  resolveReviewIssue: (id: string, issueId: string) =>
    post<ReleaseReviewIssue>(`/releases/${id}/review-issues/${issueId}/resolve/`, {}),
  /** 审查员驳回整改意见（可填备注） */
  rejectReviewIssue: (id: string, issueId: string, comment?: string) =>
    post<ReleaseReviewIssue>(`/releases/${id}/review-issues/${issueId}/reject/`, { comment }),
};
