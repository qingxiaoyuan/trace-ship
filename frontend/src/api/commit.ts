import { get, post } from './request';
import type { PaginatedData, CommitRecord } from '@/types';

export const commitApi = {
  getCommits: (params?: Record<string, unknown>) =>
    get<PaginatedData<CommitRecord>>('/commits/', { params }),
  getCommit: (id: string) => get<CommitRecord>(`/commits/${id}/`),
  reviewCommit: (id: string, data: { review_status: string; reason?: string }) =>
    post<CommitRecord>(`/commits/${id}/review/`, data),
};
