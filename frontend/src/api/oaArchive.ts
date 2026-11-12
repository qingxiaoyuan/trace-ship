import { get, post } from './request';

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
export interface ArchiveSelection { task_id: string; artifact_id: string }
export interface ArchiveArtifact extends ArchiveSelection { task_name: string; name: string; path: string }
export interface ArchivePreparation {
  selection: ArchiveSelection;
  configuration: { configured: boolean; reason: string };
  content_source: 'release_doc_changes' | 'release_doc_original';
  form: ArchiveForm;
}
export const oaArchiveApi = {
  options: (releaseId: string) => get<{ artifacts: ArchiveArtifact[] }>(`/releases/${releaseId}/oa-archive/options/`),
  prepare: (releaseId: string, selection: ArchiveSelection, form?: ArchiveForm) =>
    post<ArchivePreparation>(`/releases/${releaseId}/oa-archive/prepare/`, { ...selection, ...(form ? { form } : {}) }),
};
