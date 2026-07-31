import { get, post, put, del } from './request';
import type { PaginatedData } from '@/types';

export type ProjectMemberRole =
  | 'developer'
  | 'tester'
  | 'manager'
  | 'auditor'
  | 'viewer';

export interface ProjectMemberUser {
  id: string;
  username: string;
  nickname: string;
  department?: string;
}

export interface ProjectMember {
  id: string;
  user: ProjectMemberUser;
  user_id: string;
  role: ProjectMemberRole;
  created_at: string;
}

export interface AddProjectMemberData {
  user_id: string;
  role: ProjectMemberRole;
}

export interface BatchAddProjectMemberData {
  user_ids: string[];
  role: ProjectMemberRole;
}

export interface BatchAddProjectMemberResult {
  created: ProjectMember[];
  skipped: number;
}

export const projectMemberApi = {
  getMembers: (projectId: string) =>
    get<PaginatedData<ProjectMember>>(`/projects/${projectId}/members/`, {
      params: { page_size: 1000 },
    }),
  addMember: (projectId: string, data: AddProjectMemberData) =>
    post<ProjectMember>(`/projects/${projectId}/members/`, data),
  addMembers: (projectId: string, data: BatchAddProjectMemberData) =>
    post<BatchAddProjectMemberResult>(`/projects/${projectId}/members/`, data),
  updateMember: (
    projectId: string,
    memberId: string,
    data: { role: ProjectMemberRole }
  ) => put<ProjectMember>(`/projects/${projectId}/members/${memberId}/`, data),
  removeMember: (projectId: string, memberId: string) =>
    del<null>(`/projects/${projectId}/members/${memberId}/`),
};
