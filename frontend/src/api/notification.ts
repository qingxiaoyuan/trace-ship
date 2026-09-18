import { get, post, del } from './request';
import type { PaginatedData, Notification, RemindSummary } from '@/types';

export const notificationApi = {
  getNotifications: (params?: Record<string, unknown>) =>
    get<PaginatedData<Notification>>('/notifications/', { params }),
  getUnreadCount: () => get<{ count: number }>('/notifications/unread-count/'),
  getRemindSummary: () => get<RemindSummary>('/notifications/remind-summary/'),
  /** 确认未读系统强提醒（弹窗「知道了」） */
  ackStrongNotices: () => post<{ count: number }>('/notifications/remind-ack/', {}),
  markRead: (id: string) => post<Notification>(`/notifications/${id}/read/`, {}),
  markAllRead: () => post<{ count: number }>('/notifications/read-all/', {}),
  clearRead: () => del<{ count: number }>('/notifications/clear/'),
  clearAll: () => del<{ count: number }>('/notifications/clear-all/'),
  /** 管理员发送系统通知（全员或指定用户） */
  broadcast: (data: {
    title: string;
    content: string;
    scope: 'all' | 'users';
    user_ids?: string[];
    is_strong?: boolean;
  }) => post<{ count: number }>('/notifications/broadcast/', data),
};
