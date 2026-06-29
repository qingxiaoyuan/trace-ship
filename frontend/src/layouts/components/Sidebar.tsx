import type { ComponentType } from 'react';
import {
  Bell,
  ChevronsUpDown,
  FileText,
  FolderKanban,
  GitFork,
  GitPullRequestArrow,
  Hammer,
  KeyRound,
  LayoutDashboard,
  Rocket,
  ScanSearch,
  ScrollText,
  Settings,
  ShieldCheck,
  Tag,
  Users,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { tokens } from '@/styles/theme';
import { useAuthStore } from '@/stores/authStore';
import type { MenuItem } from '@/types';

type LucideIcon = ComponentType<{ className?: string; strokeWidth?: number }>;

interface NavItem {
  id: string;
  name: string;
  path: string;
  icon: LucideIcon;
  badge?: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const fallbackMenus: MenuItem[] = [
  { id: 'dashboard', name: '工作台', path: '/dashboard', icon: 'AppstoreOutlined' },
  { id: 'releases', name: '发布看板', path: '/releases', icon: 'RocketOutlined' },
  { id: 'workflows', name: '工作流审批', path: '/workflows', icon: 'ProfileOutlined' },
  { id: 'notifications', name: '通知', path: '/notifications', icon: 'BellOutlined' },
  { id: 'projects', name: '项目管理', path: '/projects', icon: 'FolderOutlined' },
  { id: 'repositories', name: '仓库管理', path: '/repositories', icon: 'DatabaseOutlined' },
  { id: 'credentials', name: '凭证管理', path: '/credentials', icon: 'KeyOutlined' },
  { id: 'jenkins', name: 'Jenkins构建', path: '/jenkins', icon: 'PlayCircleOutlined' },
  { id: 'commits', name: '提交规范审查', path: '/commits', icon: 'FileTextOutlined' },
  { id: 'tags', name: 'Tag 生成与发布', path: '/tags', icon: 'TagsOutlined' },
  {
    id: 'system',
    name: '系统管理',
    path: '/system',
    icon: 'SettingOutlined',
    children: [
      { id: 'system_users', name: '用户管理', path: '/system/users', icon: 'TeamOutlined' },
      { id: 'system_roles', name: '角色管理', path: '/system/roles', icon: 'SafetyCertificateOutlined' },
      { id: 'system_configs', name: '系统配置', path: '/system/configs', icon: 'SettingOutlined' },
      { id: 'system_logs', name: '操作日志', path: '/system/logs', icon: 'FileTextOutlined' },
    ],
  },
];

const pathIconMap: Record<string, LucideIcon> = {
  '/dashboard': LayoutDashboard,
  '/releases': Rocket,
  '/workflows': GitPullRequestArrow,
  '/notifications': Bell,
  '/projects': FolderKanban,
  '/repositories': GitFork,
  '/credentials': KeyRound,
  '/jenkins': Hammer,
  '/commits': ScanSearch,
  '/tags': Tag,
  '/system/users': Users,
  '/system/roles': ShieldCheck,
  '/system/configs': Settings,
  '/system/logs': ScrollText,
};

const groupRules = [
  { title: '概览', paths: ['/dashboard', '/releases', '/workflows', '/notifications'] },
  { title: '资源', paths: ['/projects', '/repositories', '/credentials', '/jenkins'] },
  { title: '质量', paths: ['/commits', '/tags'] },
  { title: '系统', paths: ['/system/users', '/system/roles', '/system/configs', '/system/logs'] },
];

const labelMap: Record<string, string> = {
  '/projects': '项目',
  '/repositories': '仓库',
  '/credentials': '凭证',
  '/jenkins': 'Jenkins',
  '/commits': '提交审查',
  '/tags': 'Tag 生成',
  '/workflows': '审批中心',
  '/notifications': '通知',
};

function flattenMenus(items: MenuItem[]): MenuItem[] {
  return items.flatMap((item) => (item.children?.length ? flattenMenus(item.children) : item));
}

function getMenuSource(menus: MenuItem[]): MenuItem[] {
  return menus.length > 0 ? menus : fallbackMenus;
}

function buildGroups(menus: MenuItem[]): NavGroup[] {
  const flatMenus = flattenMenus(getMenuSource(menus));
  const menuByPath = new Map(flatMenus.map((item) => [item.path, item]));

  return groupRules
    .map((group) => ({
      title: group.title,
      items: group.paths.reduce<NavItem[]>((items, path) => {
          const source = menuByPath.get(path);
          if (!source && path === '/notifications') {
            items.push({
              id: 'notifications',
              name: '通知',
              path,
              icon: Bell,
            });
            return items;
          }
          if (!source && path === '/releases') {
            items.push({
              id: 'releases',
              name: '发布看板',
              path,
              icon: Rocket,
              badge: '3',
            });
            return items;
          }
          if (!source) return items;

          items.push({
            id: source.id,
            name: labelMap[source.path] || source.name,
            path: source.path,
            icon: pathIconMap[source.path] || FileText,
            badge: source.path === '/workflows' ? '5' : undefined,
          });
          return items;
        }, []),
    }))
    .filter((group) => group.items.length > 0);
}

function isActivePath(currentPath: string, itemPath: string): boolean {
  if (itemPath === '/dashboard') {
    return currentPath === '/' || currentPath === '/dashboard';
  }
  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`);
}

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const menus = useAuthStore((state) => state.menus);
  const navGroups = buildGroups(menus);

  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-indigo-100 bg-white/70 backdrop-blur-xl lg:flex"
      style={{ width: tokens.layout.sidebarWidth }}
    >
      <div className="flex h-[60px] items-center gap-2.5 px-5">
        <img src="/favicon.ico" alt="溯舟" className="h-8 w-8 rounded-lg object-contain" />
        <div className="flex flex-col leading-none">
          <span className="text-[15px] font-semibold tracking-tight text-slate-900">溯舟</span>
          <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-indigo-400">
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
            PD
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-slate-800">平台研发部</div>
            <div className="truncate text-[10px] text-slate-400">12 个项目</div>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />
        </button>
      </div>

      <nav className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-3 py-2">
        {navGroups.map((group) => (
          <div key={group.title}>
            <div className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {group.title}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isActivePath(location.pathname, item.path);

                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => navigate(item.path)}
                    className={[
                      'flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors',
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
    </aside>
  );
}
