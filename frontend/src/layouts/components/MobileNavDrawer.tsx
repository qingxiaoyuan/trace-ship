import { useMemo } from 'react';
import { Drawer } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { buildGroups } from './navMenu';
import { SidebarNav } from './SidebarNav';

interface MobileNavDrawerProps {
  open: boolean;
  onClose: () => void;
}

/** 移动端导航抽屉：从底部弹出，复用桌面侧边栏的分组菜单 */
export function MobileNavDrawer({ open, onClose }: MobileNavDrawerProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const menus = useAuthStore((state) => state.menus);
  const navGroups = useMemo(() => buildGroups(menus), [menus]);

  const handleNavigate = (path: string) => {
    onClose();
    navigate(path);
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement="bottom"
      size="75vh"
      closable={false}
      styles={{
        body: { padding: '8px 0 16px', display: 'flex', flexDirection: 'column' },
        section: { borderRadius: '16px 16px 0 0' },
      }}
    >
      <div className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-slate-200" />
      <div className="flex shrink-0 items-center gap-2.5 px-5 pb-2">
        <img src="/favicon.ico" alt="溯舟" className="h-8 w-8 rounded-lg object-contain" />
        <div className="flex flex-col leading-none">
          <span className="text-[15px] font-semibold tracking-tight text-slate-900">溯舟</span>
          <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-indigo-400">
            Trace Ship
          </span>
        </div>
      </div>
      <SidebarNav
        groups={navGroups}
        currentPath={location.pathname}
        onNavigate={handleNavigate}
        large
      />
    </Drawer>
  );
}
