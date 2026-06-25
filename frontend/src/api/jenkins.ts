import { get, post, put, patch, del } from './request';
import type { PaginatedData, BuildRecord, JenkinsJob } from '@/types';

export interface JenkinsJobListParams {
  project?: string;
  is_active?: boolean;
  page?: number;
  page_size?: number;
}

export const jenkinsApi = {
  // Jenkins 任务
  getJobs: (params?: JenkinsJobListParams) =>
    get<PaginatedData<JenkinsJob>>('/jenkins/jobs/', { params }),
  getJob: (id: string) => get<JenkinsJob>(`/jenkins/jobs/${id}/`),
  createJob: (data: Partial<JenkinsJob>) => post<JenkinsJob>('/jenkins/jobs/', data),
  updateJob: (id: string, data: Partial<JenkinsJob>) =>
    put<JenkinsJob>(`/jenkins/jobs/${id}/`, data),
  patchJob: (id: string, data: Partial<JenkinsJob>) =>
    patch<JenkinsJob>(`/jenkins/jobs/${id}/`, data),
  deleteJob: (id: string) => del<null>(`/jenkins/jobs/${id}/`),
  triggerJob: (id: string, data?: { release_id?: string; version?: string; branch?: string; git_hash?: string }) =>
    post<BuildRecord>(`/jenkins/jobs/${id}/trigger/`, data || {}),

  // Jenkins 构建记录
  getBuilds: (params?: Record<string, unknown>) =>
    get<PaginatedData<BuildRecord>>('/jenkins/builds/', { params }),
  getBuild: (id: string) => get<BuildRecord>(`/jenkins/builds/${id}/`),
  getBuildLog: (id: string) => get<{ content: string }>(`/jenkins/builds/${id}/log/`),
};
