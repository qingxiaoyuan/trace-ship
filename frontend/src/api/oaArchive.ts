import { get, post } from './request';
import type { TaskSvnArtifact } from './package';

export interface ArchiveForm {
  docCreator: string;
  applyCount: 1;
  soft_name: string;
  soft_version: string;
  developer: string;
  soft_source: '' | '内部自制' | '外购';
  git_svn: string;
  sn_code: string;
  edit_content: string;
  edit_reason: string;
  other_description: string;
  soft_number: string;
}
export interface ArchiveSelection { task_id: string; scope?: 'file' | 'directory'; artifact_id?: string | null; path?: string; source_kind?: 'local' | 'svn' }
export interface ArchiveArtifact extends ArchiveSelection { task_name: string; name: string; path: string }
export interface ArchiveDirectory extends ArchiveSelection { task_name: string; name: string; path: '.'; scope: 'directory'; source_kind: 'local' | 'svn'; artifact_count?: number | null; created_at?: string; svn_url?: string }
export interface ArchiveDirectorySource {
  kind: 'local' | 'svn'; scope: 'directory'; supplemented: boolean; name: string; path: '.'; url: string;
  original: { artifact_count: number | null; files: { path: string; size: number | null; sha256: string | null; revision: string | null }[] };
  current: { kind: 'dir'; artifact_count: number; repository_revision?: string; revision?: string; date?: string;
    files?: { path: string; size: number | null; revision: string | null }[] };
}
export interface ArchivePreparation {
  selection: ArchiveSelection;
  source?: ArchiveDirectorySource | (Partial<TaskSvnArtifact> & { kind: 'local' | 'svn'; scope?: 'file'; supplemented: boolean });
  configuration: { configured: boolean; reason: string };
  content_source: 'release_doc_changes' | 'release_doc_original';
  form: ArchiveForm;
}
export type ArchiveConfirmation = '' | 'reapply' | 'retry' | 'checked_no_order';
export interface ArchiveApplication {
  id: string;
  submission_id: string;
  status: 'sending' | 'success' | 'failure' | 'unknown';
  operator: { id: string; username: string; nickname: string };
  source: { scope?: 'file' | 'directory'; task_id: string; task_name: string; path: string; version: string; tag_name: string; git_hash: string; kind: string; supplemented: boolean; [key: string]: unknown };
  form: ArchiveForm;
  message: string;
  soft_number: string;
  software_archive_id: unknown;
  number_apply_id: unknown;
  created_at: string;
  finished_at: string | null;
  previous_id: string | null;
  confirmation: ArchiveConfirmation;
  no_order_confirmation?: { operator: { id: string; username: string; nickname: string }; confirmed_at: string; evidence: string } | null;
}

/** 内网 HTTP 下 randomUUID 可能不可用，使用浏览器随机字节生成同样的 UUID v4。 */
export function createArchiveSubmissionId(): string {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  if (typeof crypto?.getRandomValues !== 'function') throw new Error('当前浏览器无法生成归档提交标识，请更换浏览器后重试');
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const oaArchiveApi = {
  options: (releaseId: string) => get<{ directories: ArchiveDirectory[]; artifacts: ArchiveArtifact[]; svn_tasks?: { task_id: string; task_name: string }[] }>(`/releases/${releaseId}/oa-archive/options/`),
  prepare: (releaseId: string, selection: ArchiveSelection, form?: ArchiveForm) =>
    post<ArchivePreparation>(`/releases/${releaseId}/oa-archive/prepare/`, { ...selection, ...(form ? { form } : {}) }),
  records: (releaseId: string) => get<ArchiveApplication[]>(`/releases/${releaseId}/oa-archive/records/`),
  confirmNoOrder: (releaseId: string, applicationId: string, evidence: string) =>
    post<ArchiveApplication>(`/releases/${releaseId}/oa-archive/confirm-no-order/`, { application_id: applicationId, confirmation: 'checked_no_order', evidence }),
  submit: (releaseId: string, selection: ArchiveSelection, form: ArchiveForm, submissionId: string, confirmation?: { previous_id: string; confirmation: ArchiveConfirmation }) =>
    post<ArchiveApplication>(`/releases/${releaseId}/oa-archive/submit/`, { ...selection, form, submission_id: submissionId, ...confirmation }, { timeout: 45000, silent: true }),
};
