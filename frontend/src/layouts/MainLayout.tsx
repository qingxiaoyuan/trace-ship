import { Outlet } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { TopHeader } from './components/TopHeader';
import { MobileTabBar } from './components/MobileTabBar';
import { tokens } from '@/styles/theme';

export function MainLayout() {
  return (
    <div className="relative min-h-screen bg-[#F6F7FB]">
      <div className="aurora-workspace" />
      <div className="aurora-workspace-3" />
      <Sidebar />
      <div className="relative z-10 min-h-screen lg:ml-[244px]">
        <TopHeader />
        <main
          className="grid-bg-workspace"
          style={{
            minHeight: `calc(100vh - ${tokens.layout.headerHeight}px)`,
          }}
        >
          {/* 移动端底部留出操作栏空间 */}
          <div className="page-fade-in mx-auto max-w-[1400px] px-4 py-4 pb-28 sm:px-5 sm:py-6 lg:px-7 lg:py-7 lg:pb-7">
            <Outlet />
          </div>
        </main>
        <MobileTabBar />
      </div>
    </div>
  );
}
