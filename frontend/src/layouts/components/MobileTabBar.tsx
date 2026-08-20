import { useState } from 'react';
import { Bell, LayoutGrid, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { notificationApi } from '@/api/notification';
import { useAuthStore } from '@/stores/authStore';
import { MobileNavDrawer } from './MobileNavDrawer';
import { MobileUserSheet } from './MobileUserSheet';
import { useCurrentRouteTitle } from './useCurrentRouteTitle';

/**
 * 移动端底部操作栏（方案 C · 双胶囊 + 中央 +，见 docs/ui/mobile/mobile-tabbar.html）
 * 左胶囊：菜单入口 + 当前页指示；中央：新建发布快捷入口；右胶囊：消息 + 个人空间
 */
export function MobileTabBar() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const [navOpen, setNavOpen] = useState(false);
  const [userSheetOpen, setUserSheetOpen] = useState(false);

  const { data: unreadCountData } = useQuery({
    queryKey: ['notification-unread-count'],
    queryFn: () => notificationApi.getUnreadCount(),
  });
  const unreadCount = unreadCountData?.count || 0;

  const currentTitle = useCurrentRouteTitle();

  const userName = user?.nickname || user?.username || '用户';

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex items-center justify-between px-4 pb-[max(20px,env(safe-area-inset-bottom))] lg:hidden">
        {/* 左胶囊：菜单 + 当前页 */}
        <div className="ts-header-glass pointer-events-auto flex items-center rounded-2xl border border-indigo-100/60 p-1.5 shadow-lg shadow-indigo-500/5">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
            aria-label="打开导航菜单"
          >
            <LayoutGrid className="h-5 w-5" strokeWidth={1.5} />
          </button>
          <div className="mx-1 flex h-10 max-w-[88px] flex-col justify-center rounded-xl bg-indigo-50/70 px-2.5">
            <span className="text-[9px] font-medium uppercase tracking-wider text-indigo-400">当前</span>
            <span className="truncate text-[11px] font-semibold leading-tight text-indigo-700">
              {currentTitle}
            </span>
          </div>
        </div>

        {/* 中央：新建发布 */}
        <button
          type="button"
          onClick={() => navigate('/releases/create')}
          className="btn-glow pointer-events-auto flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl text-white"
          aria-label="新建发布"
        >
          <Plus className="h-6 w-6" strokeWidth={1.5} />
        </button>

        {/* 右胶囊：消息 + 个人空间 */}
        <div className="ts-header-glass pointer-events-auto flex items-center rounded-2xl border border-indigo-100/60 p-1.5 shadow-lg shadow-indigo-500/5">
          <button
            type="button"
            onClick={() => navigate('/notifications')}
            className="relative flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
            aria-label="消息"
          >
            <Bell className="h-5 w-5" strokeWidth={1.5} />
            {unreadCount > 0 ? (
              <span className="absolute right-0.5 top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-semibold text-white ring-2 ring-white">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setUserSheetOpen(true)}
            className="ml-1 flex h-10 items-center gap-1.5 rounded-xl px-2 transition-colors hover:bg-indigo-50"
            aria-label="个人空间"
          >
            <span
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-semibold text-white"
              style={{ background: 'linear-gradient(135deg,#818CF8,#22D3EE)' }}
            >
              {userName.charAt(0)}
            </span>
          </button>
        </div>
      </div>

      <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
      <MobileUserSheet open={userSheetOpen} onClose={() => setUserSheetOpen(false)} />
    </>
  );
}
