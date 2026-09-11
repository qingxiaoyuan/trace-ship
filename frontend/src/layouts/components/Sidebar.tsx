import { useMemo } from 'react';
import { ChevronsUpDown } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { projectApi } from '@/api/project';
import { tokens } from '@/styles/theme';
import { useAuthStore } from '@/stores/authStore';
import { buildGroups } from './navMenu';
import { SidebarNav } from './SidebarNav';

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const menus = useAuthStore((state) => state.menus);
  const user = useAuthStore((state) => state.user);
  const navGroups = useMemo(() => buildGroups(menus), [menus]);
  const { data: projectData } = useQuery({
    queryKey: ['sidebar-project-count'],
    queryFn: () => projectApi.getProjects({ page: 1, page_size: 1 }),
  });
  const userName = user?.nickname || user?.username || '用户';
  const userInitials = userName
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-indigo-100 bg-white/70 backdrop-blur-xl lg:flex"
      style={{ width: tokens.layout.sidebarWidth }}
    >
      <div className="flex h-[60px] items-center gap-2.5 px-5">
        <img src="/favicon.ico" alt="溯舟" className="h-8 w-8 rounded-lg object-contain" />
        <div className="flex flex-col leading-none">
          <span className="text-[15px] font-semibold tracking-tight text-slate-900">溯舟</span>
          <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-indigo-400">
            Trace Ship
          </span>
        </div>
      </div>

      <div className="px-3 pb-1 pt-3">
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-lg border border-indigo-100 bg-indigo-50/40 px-2.5 py-2 text-left transition-colors hover:border-indigo-200 hover:bg-indigo-50"
        >
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-cyan-400 text-[11px] font-semibold text-white">
            {userInitials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-slate-800">
              {user?.department || userName}
            </div>
            <div className="truncate text-[10px] text-slate-400">
              {projectData ? `${projectData.total} 个产品` : '产品加载中'}
            </div>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />
        </button>
      </div>

      <SidebarNav
        groups={navGroups}
        currentPath={location.pathname}
        onNavigate={(path) => navigate(path)}
      />
    </aside>
  );
}
