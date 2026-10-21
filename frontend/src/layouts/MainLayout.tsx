import { Outlet, useLocation } from 'react-router-dom';
import { useLayoutEffect, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { TopHeader } from './components/TopHeader';
import { MobileTabBar } from './components/MobileTabBar';
import { StrongRemindModal } from '@/components/StrongRemindModal';
import { CommandPalette } from '@/components/CommandPalette';
import { tokens } from '@/styles/theme';
import { useDashboardContext } from '@/hooks/useDashboardContext';
import { PageScrollContext } from '@/hooks/usePageScroll';
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
  const maintainerRelease = context?.layout_mode === 'maintainer'
    && /^\/releases\/[^/]+\/?$/.test(location.pathname);
  const mobileScrollPage = maintainerHome || maintainerRelease;
  const scrollRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (mobileScrollPage) scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname, mobileScrollPage]);
  const restricted = context?.layout_mode === 'maintainer'
    && isMaintainerRestrictedPath(location.pathname + location.search);
  return (
    <PageScrollContext.Provider value={mobileScrollPage ? scrollRef : null}>
    <div className={`relative min-h-screen bg-[#F6F7FB] ${mobileScrollPage ? 'max-md:h-dvh max-md:min-h-0 max-md:overflow-hidden max-md:[--maintainer-nav-height:max(80px,calc(62px_+_env(safe-area-inset-bottom)))] max-md:[--maintainer-content-height:calc(100dvh_-_56px_-_var(--maintainer-nav-height))]' : ''} ${maintainerRelease ? 'max-md:bg-[#f5f7fb]' : ''}`}>
      {!maintainerHome && <><div className={`aurora-workspace ${maintainerRelease ? 'max-md:hidden' : ''}`} /><div className={`aurora-workspace-3 ${maintainerRelease ? 'max-md:hidden' : ''}`} /></>}
      <Sidebar />
      <div className={`relative z-10 min-h-screen lg:ml-[244px] ${mobileScrollPage ? 'max-md:flex max-md:h-full max-md:min-h-0 max-md:flex-col' : ''}`}>
        <TopHeader />
        <main
          ref={scrollRef}
          className={`${maintainerHome ? '' : 'grid-bg-workspace'} ${maintainerRelease ? 'max-md:bg-none!' : ''} ${mobileScrollPage ? 'max-md:mb-[var(--maintainer-nav-height)] max-md:min-h-0! max-md:flex-1 max-md:overflow-y-auto max-md:overscroll-y-contain max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden' : ''}`}
          style={{
            minHeight: `calc(100vh - ${tokens.layout.headerHeight}px)`,
          }}
        >
          {/* 移动端底部留出操作栏空间 */}
          <div className={`page-fade-in mx-auto max-w-[1400px] px-4 py-4 pb-28 sm:px-5 sm:py-6 lg:px-7 lg:py-7 lg:pb-7 ${maintainerHome ? 'max-md:px-5 max-md:pb-5' : ''} ${maintainerRelease ? 'max-md:px-0 max-md:py-0' : ''}`}>
            {restricted ? <Forbidden title="此页面不向纯维保账号开放" description="请从工作台查阅所属项目的已发布版本。" /> : <Outlet />}
          </div>
        </main>
        <MobileTabBar />
        <StrongRemindModal />
        <CommandPalette />
      </div>
    </div>
    </PageScrollContext.Provider>
  );
}
