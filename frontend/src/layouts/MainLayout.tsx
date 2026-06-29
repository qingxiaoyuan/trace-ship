import { Outlet } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { TopHeader } from './components/TopHeader';
import { tokens } from '@/styles/theme';

export function MainLayout() {
  return (
    <div className="relative min-h-screen bg-[#F6F7FB]">
      <div className="aurora-workspace" />
      <div className="aurora-workspace-3" />
      <Sidebar />
      <div
        className="relative z-10 min-h-screen lg:ml-[244px]"
        style={{ marginLeft: undefined }}
      >
        <TopHeader />
        <main
          className="grid-bg-workspace"
          style={{
            minHeight: `calc(100vh - ${tokens.layout.headerHeight}px)`,
          }}
        >
          <div className="page-fade-in mx-auto max-w-[1400px] px-5 py-6 lg:px-7 lg:py-7">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
