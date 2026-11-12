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
export interface ArchiveSelection { task_id: string; artifact_id?: string | null; path?: string; source_kind?: 'local' | 'svn' }
export interface ArchiveArtifact extends ArchiveSelection { task_name: string; name: string; path: string }
export interface ArchivePreparation {
  selection: ArchiveSelection;
  source?: Partial<TaskSvnArtifact> & { kind: 'local' | 'svn'; supplemented: boolean };
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
  source: { task_id: string; task_name: string; path: string; version: string; tag_name: string; git_hash: string; kind: string; supplemented: boolean; [key: string]: unknown };
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
export const oaArchiveApi = {
  options: (releaseId: string) => get<{ artifacts: ArchiveArtifact[]; svn_tasks?: { task_id: string; task_name: string }[] }>(`/releases/${releaseId}/oa-archive/options/`),
  prepare: (releaseId: string, selection: ArchiveSelection, form?: ArchiveForm) =>
    post<ArchivePreparation>(`/releases/${releaseId}/oa-archive/prepare/`, { ...selection, ...(form ? { form } : {}) }),
  records: (releaseId: string) => get<ArchiveApplication[]>(`/releases/${releaseId}/oa-archive/records/`),
  confirmNoOrder: (releaseId: string, applicationId: string, evidence: string) =>
    post<ArchiveApplication>(`/releases/${releaseId}/oa-archive/confirm-no-order/`, { application_id: applicationId, confirmation: 'checked_no_order', evidence }),
  submit: (releaseId: string, selection: ArchiveSelection, form: ArchiveForm, submissionId: string, confirmation?: { previous_id: string; confirmation: ArchiveConfirmation }) =>
    post<ArchiveApplication>(`/releases/${releaseId}/oa-archive/submit/`, { ...selection, form, submission_id: submissionId, ...confirmation }, { timeout: 45000, silent: true }),
};
