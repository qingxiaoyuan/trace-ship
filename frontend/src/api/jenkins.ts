import { get } from './request';
import type { PaginatedData, BuildRecord } from '@/types';

export const jenkinsApi = {
  getBuilds: (params?: Record<string, unknown>) =>
    get<PaginatedData<BuildRecord>>('/jenkins/builds/', { params }),
  getBuild: (id: string) => get<BuildRecord>(`/jenkins/builds/${id}/`),
  getBuildLog: (id: string) => get<{ content: string }>(`/jenkins/builds/${id}/log/`),
};
