import { del, get, patch, post } from './request';
import type {
  PaginatedData,
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowInstanceListItem,
  WorkflowTask,
} from '@/types';

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
  getInstance: (id: string) => get<WorkflowInstance>(`/workflow/instances/${id}/`),
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
  rollbackTask: (id: string, data?: { comment?: string; rollback_target?: string }) =>
    post(`/workflow/tasks/${id}/rollback/`, data || {}),
};
