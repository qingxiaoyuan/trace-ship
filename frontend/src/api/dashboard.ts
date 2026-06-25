import { get } from './request';
import type { DashboardOverview } from '@/types';

export const dashboardApi = {
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
