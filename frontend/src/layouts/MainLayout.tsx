import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { TopHeader } from './components/TopHeader';
import { MobileTabBar } from './components/MobileTabBar';
import { StrongRemindModal } from '@/components/StrongRemindModal';
import { CommandPalette } from '@/components/CommandPalette';
import { tokens } from '@/styles/theme';
import { useDashboardContext } from '@/hooks/useDashboardContext';
import { DashboardContextProvider } from './DashboardContextProvider';
import { isMaintainerRestrictedPath } from './components/navMenu';
import Forbidden from '@/pages/Error/Forbidden';

export function MainLayout() {
  return <DashboardContextProvider><MainLayoutContent /></DashboardContextProvider>;
}

function MainLayoutContent() {
  const context = useDashboardContext();
  const location = useLocation();
  const maintainerHome = context?.layout_mode === 'maintainer'
    && ['/', '/dashboard'].includes(location.pathname);
  const restricted = context?.layout_mode === 'maintainer'
    && isMaintainerRestrictedPath(location.pathname + location.search);
  return (
    <div className="relative min-h-screen bg-[#F6F7FB]">
      {!maintainerHome && <><div className="aurora-workspace" /><div className="aurora-workspace-3" /></>}
      <Sidebar />
      <div className="relative z-10 min-h-screen lg:ml-[244px]">
        <TopHeader />
        <main
          className={maintainerHome ? undefined : 'grid-bg-workspace'}
          style={{
            minHeight: `calc(100vh - ${tokens.layout.headerHeight}px)`,
          }}
        >
          {/* 移动端底部留出操作栏空间 */}
          <div className={`page-fade-in mx-auto max-w-[1400px] px-4 py-4 pb-28 sm:px-5 sm:py-6 lg:px-7 lg:py-7 lg:pb-7 ${maintainerHome ? 'max-md:px-5' : ''}`}>
            {restricted ? <Forbidden title="此页面不向纯维保账号开放" description="请从工作台查阅所属项目的已发布版本。" /> : <Outlet />}
          </div>
        </main>
        <MobileTabBar />
        <StrongRemindModal />
        <CommandPalette />
      </div>
    </div>
  );
}
