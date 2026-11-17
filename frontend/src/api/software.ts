import { del, get, patch, post } from './request';
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
  owner: SoftwareUser;
  maintainers: SoftwareUser[];
  can_maintain: boolean;
  can_manage: boolean;
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
  update: (id: string, payload: Partial<SoftwareFields & { is_active: boolean; owner_username: string }>) =>
    patch<Software>(`/software/${id}/`, payload),
  grant: (id: string, username: string) => post<Software>(`/software/${id}/maintainers/`, { username }),
  revoke: (id: string, user: string) => del<Software>(`/software/${id}/maintainers/${user}/`),
  listProject: (project: string, active?: boolean) =>
    get<ProjectSoftware[]>(`/projects/${project}/software/`, { params: { active } }),
  available: (project: string) => get<SoftwareSummary[]>(`/projects/${project}/software/available/`),
  choose: (project: string, software: string) =>
    post<ProjectSoftware>(`/projects/${project}/software/`, { software }),
  setSelection: (project: string, id: string, is_active: boolean) =>
    patch<ProjectSoftware>(`/projects/${project}/software/${id}/`, { is_active }),
};
