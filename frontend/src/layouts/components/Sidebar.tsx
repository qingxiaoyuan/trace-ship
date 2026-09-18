import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { tokens } from '@/styles/theme';
import { useAuthStore } from '@/stores/authStore';
import { useWorkflowTodoCount } from '@/hooks/useWorkflowTodoCount';
import { buildGroups } from './navMenu';
import { SidebarNav } from './SidebarNav';

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const menus = useAuthStore((state) => state.menus);
  const todoCount = useWorkflowTodoCount();
  const navGroups = useMemo(
    () =>
      buildGroups(
        menus,
        todoCount > 0 ? { '/workflows': todoCount > 99 ? '99+' : String(todoCount) } : undefined,
      ),
    [menus, todoCount],
  );

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

      <SidebarNav
        groups={navGroups}
        currentPath={location.pathname}
        onNavigate={(path) => navigate(path)}
      />
    </aside>
  );
}
