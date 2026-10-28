import { del, get, patch, post } from './request';
import type {
  PaginatedData,
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowInstanceListItem,
  WorkflowTask,
} from '@/types';

export interface ReviewScopeData {
  status: 'first_release' | 'no_changes' | 'incomplete' | 'ready';
  base_tag: string;
  base_git_hash: string;
  head_git_hash: string;
  warnings: string[];
  context?: string;
  context_is_requirement?: boolean;
  documents?: Record<string, string>;
}

export interface AiReviewFinding {
  id?: string;
  severity: string;
  title: string;
  reason: string;
  suggestion: string;
  path?: string;
  side?: 'old' | 'new';
  line_start?: number;
  line_end?: number;
}

export interface AiReviewData {
  node_id: string;
  node_name?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'incomplete' | 'first_release' | 'no_changes' | 'skipped' | 'canceled';
  summary: string;
  coverage: { total_files?: number; reviewed_files?: number; warnings?: string[]; reviewed_paths?: string[]; unreviewed_paths?: string[] };
  dimensions?: string[];
  findings?: AiReviewFinding[];
  can_recover?: boolean;
  skip_reason?: string;
  skipped_at?: string | null;
  skipped_by?: string | null;
  skipped_by_name?: string;
  history?: Array<{ token: string; status: string; summary: string; updated_at: string; coverage?: AiReviewData['coverage']; dimensions?: string[]; findings?: AiReviewFinding[] }>;
}

export const workflowApi = {
  getDefinitions: (params?: Record<string, unknown>) =>
    get<PaginatedData<WorkflowDefinition>>('/workflow/definitions/', { params }),
  createDefinition: (data: Partial<WorkflowDefinition>) =>
    post<WorkflowDefinition>('/workflow/definitions/', data),
  updateDefinition: (id: string, data: Partial<WorkflowDefinition>) =>
    patch<WorkflowDefinition>(`/workflow/definitions/${id}/`, data),
  deleteDefinition: (id: string) => del(`/workflow/definitions/${id}/`),
  createInstance: (data: { definition_id: string; biz_type?: string; biz_id: string }) =>
    post<WorkflowInstance>('/workflow/instances/', data),
  getInstances: (params?: Record<string, unknown>) =>
    get<PaginatedData<WorkflowInstanceListItem>>('/workflow/instances/', { params }),
  getInstance: (id: string) => get<WorkflowInstance>(`/workflow/instances/${id}/`),
  getReviewScope: (id: string) => get<ReviewScopeData>(`/workflow/instances/${id}/review-scope/`, { silent: true }),
  getAiReview: (id: string) => get<{ reviews: AiReviewData[] }>(`/workflow/instances/${id}/ai-review/`, { silent: true }),
  retryAiReview: (id: string, node_id: string) => post(`/workflow/instances/${id}/ai-review-retry/`, { node_id }),
  skipAiReview: (id: string, node_id: string, reason: string) => post(`/workflow/instances/${id}/ai-review-skip/`, { node_id, reason }),
  revokeInstance: (id: string, data?: { comment?: string }) =>
    post<WorkflowInstance>(`/workflow/instances/${id}/revoke/`, data || {}),
  /** 我发起的流程实例列表，支持 status 过滤 */
  getInitiatedInstances: (params?: Record<string, unknown>) =>
    get<PaginatedData<WorkflowInstanceListItem>>('/workflow/instances/initiated/', { params }),
  getTodoTasks: (params?: Record<string, unknown>) =>
    get<PaginatedData<WorkflowTask>>('/workflow/tasks/todo/', { params }),
  /** 单个审批任务详情（深链时用于将任务 ID 解析为流程实例 ID） */
  getTask: (id: string) => get<WorkflowTask>(`/workflow/tasks/${id}/`),
  /** 当前用户待审批任务数（侧边栏「审批中心」徽标数据源） */
  getTodoCount: () => get<{ count: number }>('/workflow/todo-count/', { silent: true }),
  getDoneTasks: (params?: Record<string, unknown>) =>
    get<PaginatedData<WorkflowTask>>('/workflow/tasks/done/', { params }),
  approveTask: (id: string, data?: { comment?: string }) =>
    post(`/workflow/tasks/${id}/approve/`, data || {}),
  rejectTask: (id: string, data?: { comment?: string }) =>
    post(`/workflow/tasks/${id}/reject/`, data || {}),
  transferTask: (id: string, data: { to_user_id: string; comment?: string }) =>
    post(`/workflow/tasks/${id}/transfer/`, data),
  returnForRevision: (id: string, data?: { comment?: string }) =>
    post(`/workflow/tasks/${id}/return-for-revision/`, data || {}),
  rollbackTask: (id: string, data?: { comment?: string; rollback_target?: string }) =>
    post(`/workflow/tasks/${id}/rollback/`, data || {}),
};
