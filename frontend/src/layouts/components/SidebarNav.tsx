import type { NavGroup } from './navMenu';
import { isActivePath } from './navMenu';

interface SidebarNavProps {
  groups: NavGroup[];
  currentPath: string;
  onNavigate: (path: string) => void;
  /** 移动端抽屉内加大行高，便于触控 */
  large?: boolean;
}

export function SidebarNav({ groups, currentPath, onNavigate, large = false }: SidebarNavProps) {
  return (
    <nav className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-3 py-2">
      {groups.map((group) => (
        <div key={group.title}>
          <div className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {group.title}
          </div>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = isActivePath(currentPath, item.path);

              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => onNavigate(item.path)}
                  className={[
                    'flex w-full items-center gap-2.5 rounded-lg border px-2.5 text-left font-medium transition-colors',
                    large ? 'py-2.5 text-[14px]' : 'py-1.5 text-[13px]',
                    active
                      ? 'nav-active'
                      : 'border-transparent text-slate-500 hover:bg-indigo-50/60 hover:text-indigo-600',
                  ].join(' ')}
                >
                  <Icon className="h-[17px] w-[17px] shrink-0" strokeWidth={1.5} />
                  <span className="truncate">{item.name}</span>
                  {item.badge ? (
                    <span
                      className={[
                        'ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                        item.path === '/releases'
                          ? 'bg-amber-50 text-amber-600'
                          : 'bg-indigo-50 text-indigo-600',
                      ].join(' ')}
                    >
                      {item.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
