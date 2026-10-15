import { get } from './request';
import type { DashboardOverview } from '@/types';

export interface DashboardContext {
  layout_mode: 'general' | 'maintainer';
  visible_project_count: number;
}

export interface MaintainerProjectScope {
  id: string;
  name: string;
  release_count: number;
  software: Array<{ id: string; name: string; release_count: number }>;
}

export interface MaintainerPackageTask {
  id: string;
  name: string;
  project: string;
  project_name: string;
  component_name: string;
  version: string;
  status: 'queued' | 'running' | 'success' | 'failure' | 'canceled';
  status_display: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration: number;
  error_message: string;
  artifact_count: number;
  trigger_source: string;
}

export interface MaintainerSummary {
  projects: MaintainerProjectScope[];
  software_count: number;
  stats: {
    days: number; since: string; until: string; released_count: number; failed_task_count: number;
    package_total: number; package_success: number; package_success_rate: number | null;
  };
  recent_tasks: MaintainerPackageTask[];
}

export const dashboardApi = {
  getContext: (signal?: AbortSignal) => get<DashboardContext>('/releases/dashboard/context/', { signal }),
  getMaintainerSummary: () => get<MaintainerSummary>('/releases/dashboard/maintainer-summary/'),
  getOverview: () => get<DashboardOverview>('/releases/dashboard/overview/'),
  getTrend: (days = 30) =>
    get<Array<{ date: string; count: number; success_count: number; failure_count: number }>>(
      '/releases/dashboard/trend/',
      { params: { days } },
    ),
  getProjectStats: () =>
    get<Array<{ project_id: string; project_name: string; release_count: number; success_rate: number }>>(
      '/releases/dashboard/projects/',
    ),
};
