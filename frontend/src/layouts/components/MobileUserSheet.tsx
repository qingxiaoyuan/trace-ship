import { BookOpen, LogOut, MessageSquareText, User } from 'lucide-react';
import { Drawer } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationApi } from '@/api/notification';
import { useAuthStore } from '@/stores/authStore';
import { getRoleLabel } from '@/utils/role';
import type { Notification } from '@/types';

const typeMap: Record<string, string> = {
  audit: '审批',
  build: '打包',
  release: '发布',
  review: '审查整改',
  system: '系统',
};

interface MobileUserSheetProps {
  open: boolean;
  onClose: () => void;
}

/** 移动端个人空间底部弹层：用户卡片 + 最近通知 + 功能入口 */
export function MobileUserSheet({ open, onClose }: MobileUserSheetProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const queryClient = useQueryClient();

  const { data: unreadCountData } = useQuery({
    queryKey: ['notification-unread-count'],
    queryFn: () => notificationApi.getUnreadCount(),
  });
  const { data: notificationData } = useQuery({
    queryKey: ['mobile-sheet-notifications'],
    queryFn: () => notificationApi.getNotifications({ page_size: 3 }),
    enabled: open,
  });
  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationApi.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['mobile-sheet-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['header-notifications'] });
    },
  });

  const unreadCount = unreadCountData?.count || 0;
  const notifications = notificationData?.results || [];
  const userName = user?.nickname || user?.username || '用户';
  const roleLabel = getRoleLabel(user);

  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  const entries = [
    { label: '个人中心', icon: User, onClick: () => go('/profile') },
    { label: '使用说明', icon: BookOpen, onClick: () => go('/guide') },
    { label: '使用反馈', icon: MessageSquareText, onClick: () => go('/feedback') },
    { label: '退出登录', icon: LogOut, onClick: () => { onClose(); logout(); }, danger: true },
  ];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement="bottom"
      size="auto"
      closable={false}
      styles={{
        body: { padding: '8px 0 20px' },
        section: { borderRadius: '16px 16px 0 0' },
      }}
    >
      <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-200" />

      {/* 用户卡片 */}
      <div className="flex items-center gap-3 px-5 pb-3 pt-2">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[15px] font-semibold text-white"
          style={{ background: 'linear-gradient(135deg,#818CF8,#22D3EE)' }}
        >
          {userName.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold tracking-tight text-slate-900">{userName}</div>
          <div className="mt-0.5 truncate text-[11px] text-slate-400">
            {roleLabel}{user?.department ? ` · ${user.department}` : ''}
          </div>
        </div>
      </div>

      {/* 消息提醒 */}
      <div className="flex items-center justify-between border-t border-indigo-50 px-5 pb-1 pt-3">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-slate-800">
          消息提醒
          {unreadCount > 0 ? (
            <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">
              {unreadCount} 未读
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => go('/notifications')}
          className="text-[12px] font-medium text-indigo-600"
        >
          全部通知
        </button>
      </div>
      <div className="px-3 py-1">
        {notifications.length === 0 ? (
          <div className="px-2.5 py-4 text-center text-[12px] text-slate-400">暂无通知</div>
        ) : (
          notifications.map((item: Notification) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (!item.is_read) markReadMutation.mutate(item.id);
                go('/notifications');
              }}
              className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-indigo-50/50"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="shrink-0 rounded bg-indigo-50 px-1 py-px text-[10px] font-medium text-indigo-600">
                    {typeMap[item.notification_type] || item.notification_type}
                  </span>
                  <span
                    className={`truncate text-[13px] font-medium ${item.is_read ? 'text-slate-500' : 'text-slate-900'}`}
                  >
                    {item.title}
                  </span>
                  {!item.is_read ? (
                    <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
                  ) : null}
                </div>
                <div className="mt-0.5 line-clamp-1 text-[11px] text-slate-400">{item.content}</div>
              </div>
            </button>
          ))
        )}
      </div>

      {/* 功能入口 */}
      <div className="grid grid-cols-4 gap-2 border-t border-indigo-50 px-4 pt-3">
        {entries.map((entry) => {
          const Icon = entry.icon;
          return (
            <button
              key={entry.label}
              type="button"
              onClick={entry.onClick}
              className={`flex flex-col items-center gap-1.5 rounded-xl py-2.5 transition-colors ${
                entry.danger ? 'hover:bg-rose-50/60' : 'hover:bg-indigo-50/60'
              }`}
            >
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                  entry.danger ? 'bg-rose-50 text-rose-600' : 'bg-indigo-50 text-indigo-600'
                }`}
              >
                <Icon className="h-4 w-4" strokeWidth={1.5} />
              </div>
              <span className={`text-[11px] ${entry.danger ? 'text-rose-600' : 'text-slate-600'}`}>
                {entry.label}
              </span>
            </button>
          );
        })}
      </div>
    </Drawer>
  );
}
