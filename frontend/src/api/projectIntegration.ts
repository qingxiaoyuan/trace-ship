import { get, post, put, del } from './request';
import type { PaginatedData } from '@/types';

export type IntegrationType = 'git_repo' | 'svn_repo' | 'jenkins';

export interface ProjectIntegration {
  id: string;
  integration_type: IntegrationType;
  vendor: string;
  name: string;
  external_identity: string;
  config: Record<string, unknown>;
  credential?: string;
  credential_name?: string;
  credential_mode: string;
  specified_user?: string;
  specified_user_name?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectIntegrationTestResult {
  connected: boolean;
  detail: string;
  integration_type: IntegrationType;
  vendor: string;
}

export const projectIntegrationApi = {
  getIntegrations: (projectId: string) =>
    get<PaginatedData<ProjectIntegration>>(
      `/projects/${projectId}/integrations/`,
      { params: { page_size: 1000 } }
    ),
  createIntegration: (projectId: string, data: Partial<ProjectIntegration>) =>
    post<ProjectIntegration>(`/projects/${projectId}/integrations/`, data),
  updateIntegration: (
    projectId: string,
    integrationId: string,
    data: Partial<ProjectIntegration>
  ) =>
    put<ProjectIntegration>(
      `/projects/${projectId}/integrations/${integrationId}/`,
      data
    ),
  deleteIntegration: (projectId: string, integrationId: string) =>
    del<null>(`/projects/${projectId}/integrations/${integrationId}/`),
  testIntegration: (projectId: string, integrationId: string) =>
    post<ProjectIntegrationTestResult>(
      `/projects/${projectId}/integrations/${integrationId}/test/`,
      {}
    ),
};
