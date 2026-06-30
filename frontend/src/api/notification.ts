import { get, post, del } from './request';
import type { PaginatedData, Notification } from '@/types';

export const notificationApi = {
  getNotifications: (params?: Record<string, unknown>) =>
    get<PaginatedData<Notification>>('/notifications/', { params }),
  getUnreadCount: () => get<{ count: number }>('/notifications/unread-count/'),
  markRead: (id: string) => post<Notification>(`/notifications/${id}/read/`, {}),
  markAllRead: () => post<{ count: number }>('/notifications/read-all/', {}),
  clearRead: () => del<{ count: number }>('/notifications/clear/'),
  clearAll: () => del<{ count: number }>('/notifications/clear-all/'),
};
