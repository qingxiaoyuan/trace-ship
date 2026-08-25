import type { ComponentType } from 'react';
import {
  Bell,
  BookOpen,
  Box,
  FileText,
  FolderKanban,
  GitFork,
  GitPullRequestArrow,
  Hammer,
  History,
  KeyRound,
  KeySquare,
  LayoutDashboard,
  MessageSquareText,
  Rocket,
  ScanSearch,
  ScrollText,
  Settings,
  ShieldCheck,
  Tag,
  Users,
} from 'lucide-react';
import type { MenuItem } from '@/types';

export type LucideIcon = ComponentType<{ className?: string; strokeWidth?: number }>;

export interface NavItem {
  id: string;
  name: string;
  path: string;
  icon: LucideIcon;
  badge?: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

const fallbackMenus: MenuItem[] = [
  { id: 'dashboard', name: '工作台', path: '/dashboard', icon: 'AppstoreOutlined' },
  { id: 'releases', name: '发布看板', path: '/releases', icon: 'RocketOutlined' },
  { id: 'workflows', name: '工作流审批', path: '/workflows', icon: 'ProfileOutlined' },
  { id: 'notifications', name: '通知', path: '/notifications', icon: 'BellOutlined' },
  { id: 'guide', name: '使用说明', path: '/guide', icon: 'ReadOutlined' },
  { id: 'feedback', name: '使用反馈', path: '/feedback', icon: 'MessageOutlined' },
  { id: 'changelog', name: '更新日志', path: '/changelog', icon: 'FileTextOutlined' },
  { id: 'projects', name: '项目管理', path: '/projects', icon: 'FolderOutlined' },
  { id: 'repositories', name: '仓库管理', path: '/repositories', icon: 'DatabaseOutlined' },
  { id: 'credentials', name: '凭证管理', path: '/credentials', icon: 'KeyOutlined' },
  { id: 'packages', name: '打包看板', path: '/packages', icon: 'PlayCircleOutlined' },
  { id: 'commits', name: '提交规范审查', path: '/commits', icon: 'FileTextOutlined' },
  { id: 'tags', name: '新建发布', path: '/releases/create', icon: 'TagsOutlined' },
  {
    id: 'system',
    name: '系统管理',
    path: '/system',
    icon: 'SettingOutlined',
    children: [
      { id: 'system_users', name: '用户管理', path: '/system/users', icon: 'TeamOutlined' },
      { id: 'system_roles', name: '角色管理', path: '/system/roles', icon: 'SafetyCertificateOutlined' },
      { id: 'system_configs', name: '系统配置', path: '/system/configs', icon: 'SettingOutlined' },
      { id: 'system_access_tokens', name: '访问令牌', path: '/system/access-tokens', icon: 'KeyOutlined' },
      { id: 'system_package_images', name: '打包镜像', path: '/system/package-images', icon: 'BoxPlotOutlined' },
      { id: 'system_logs', name: '操作日志', path: '/system/logs', icon: 'FileTextOutlined' },
    ],
  },
];

const pathIconMap: Record<string, LucideIcon> = {
  '/dashboard': LayoutDashboard,
  '/releases': Rocket,
  '/workflows': GitPullRequestArrow,
  '/notifications': Bell,
  '/guide': BookOpen,
  '/feedback': MessageSquareText,
  '/changelog': History,
  '/projects': FolderKanban,
  '/repositories': GitFork,
  '/credentials': KeyRound,
  '/packages': Hammer,
  '/commits': ScanSearch,
  '/releases/create': Tag,
  '/system/users': Users,
  '/system/roles': ShieldCheck,
  '/system/configs': Settings,
  '/system/access-tokens': KeySquare,
  '/system/package-images': Box,
  '/system/logs': ScrollText,
};

const groupRules = [
  { title: '概览', paths: ['/dashboard', '/releases', '/workflows', '/notifications', '/guide', '/feedback', '/changelog'] },
  { title: '资源', paths: ['/projects', '/repositories', '/credentials', '/packages'] },
  { title: '质量', paths: ['/commits', '/releases/create'] },
  { title: '系统', paths: ['/system/users', '/system/roles', '/system/configs', '/system/access-tokens', '/system/package-images', '/system/logs'] },
];

const labelMap: Record<string, string> = {
  '/projects': '项目',
  '/repositories': '仓库',
  '/credentials': '凭证',
  '/packages': '打包看板',
  '/system/package-images': '打包镜像',
  '/commits': '提交审查',
  '/releases/create': '新建发布',
  '/workflows': '审批中心',
  '/notifications': '通知',
};

function flattenMenus(items: MenuItem[]): MenuItem[] {
  return items.flatMap((item) => (item.children?.length ? flattenMenus(item.children) : item));
}

function getMenuSource(menus: MenuItem[]): MenuItem[] {
  return menus.length > 0 ? menus : fallbackMenus;
}

export function buildGroups(menus: MenuItem[]): NavGroup[] {
  const flatMenus = flattenMenus(getMenuSource(menus));
  const menuByPath = new Map(flatMenus.map((item) => [item.path, item]));

  return groupRules
    .map((group) => ({
      title: group.title,
      items: group.paths.reduce<NavItem[]>((items, path) => {
          const source = menuByPath.get(path);
          if (!source) return items;

          items.push({
            id: source.id,
            name: labelMap[source.path] || source.name,
            path: source.path,
            icon: pathIconMap[source.path] || FileText,
          });
          return items;
        }, []),
    }))
    .filter((group) => group.items.length > 0);
}

export function isActivePath(currentPath: string, itemPath: string): boolean {
  if (itemPath === '/dashboard') {
    return currentPath === '/' || currentPath === '/dashboard';
  }
  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`);
}
