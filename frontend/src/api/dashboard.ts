import { get, post } from './request';
import type { PaginatedData, Release, CommitRecord, BuildRecord, DashboardOverview } from '@/types';

export const dashboardApi = {
  getOverview: () => get<DashboardOverview>('/dashboard/overview/'),
  getTrend: (days = 30) => get<unknown>('/dashboard/trend/', { params: { days } }),
  getProjectStats: () => get<unknown>('/dashboard/projects/'),
};

export const releaseApi = {
  getReleases: (params?: Record<string, unknown>) =>
    get<PaginatedData<Release>>('/releases/', { params }),
  getRelease: (id: string) => get<Release>(`/releases/${id}/`),
};

export const commitApi = {
  getCommits: (params?: Record<string, unknown>) =>
    get<PaginatedData<CommitRecord>>('/commits/', { params }),
  getCommit: (id: string) => get<CommitRecord>(`/commits/${id}/`),
  reviewCommit: (id: string, data: { review_status: string; reason?: string }) =>
    post<CommitRecord>(`/commits/${id}/review/`, data),
  getAiReview: (id: string) => get<unknown>(`/commits/${id}/ai-review/`),
};

export const jenkinsApi = {
  getBuilds: (params?: Record<string, unknown>) =>
    get<PaginatedData<BuildRecord>>('/jenkins/builds/', { params }),
  getBuild: (id: string) => get<BuildRecord>(`/jenkins/builds/${id}/`),
  getBuildLog: (id: string) => get<{ content: string }>(`/jenkins/builds/${id}/log/`),
};
