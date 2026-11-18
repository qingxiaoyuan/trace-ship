import { get, patch, post } from './request';
import type { PaginatedData } from '@/types';

export interface SoftwareSummary {
  id: string;
  repository: string;
  repository_name: string;
  slug: string;
  name: string;
  description: string;
  is_active: boolean;
}

interface SoftwareUser {
  id: string;
  username: string;
  nickname: string;
}

export interface Software extends SoftwareSummary {
  owner: SoftwareUser | null;
  can_maintain: boolean;
  latest_release_version: string | null;
  latest_release_tag: string | null;
  package_config_count: number | null;
}

export interface ProjectSoftware {
  id: string;
  software: SoftwareSummary;
  is_active: boolean;
  can_view_repository: boolean;
  is_usable: boolean;
}

type SoftwareFields = Pick<SoftwareSummary, 'name' | 'description'>;

export const softwareApi = {
  list: (params: { repository?: string; search?: string; page: number }) =>
    get<PaginatedData<Software>>('/software/', { params }),
  register: (payload: SoftwareFields & { repository: string; slug: string }) =>
    post<Software>('/software/', payload),
  update: (id: string, payload: Partial<SoftwareFields & { is_active: boolean }>) =>
    patch<Software>(`/software/${id}/`, payload),
  listProject: (project: string, active?: boolean) =>
    get<ProjectSoftware[]>(`/projects/${project}/software/`, { params: { active } }),
};
