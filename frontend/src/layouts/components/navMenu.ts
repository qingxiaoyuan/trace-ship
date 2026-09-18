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
  { id: 'workflows', name: '审批中心', path: '/workflows', icon: 'ProfileOutlined' },
  { id: 'notifications', name: '通知', path: '/notifications', icon: 'BellOutlined' },
  { id: 'guide', name: '使用说明', path: '/guide', icon: 'ReadOutlined' },
  { id: 'feedback', name: '使用反馈', path: '/feedback', icon: 'MessageOutlined' },
  { id: 'changelog', name: '更新日志', path: '/changelog', icon: 'FileTextOutlined' },
  { id: 'projects', name: '项目/产品', path: '/projects', icon: 'FolderOutlined' },
  { id: 'repositories', name: '仓库', path: '/repositories', icon: 'DatabaseOutlined' },
  { id: 'credentials', name: '凭证', path: '/credentials', icon: 'KeyOutlined' },
  { id: 'packages', name: '打包看板', path: '/packages', icon: 'PlayCircleOutlined' },
  { id: 'commits', name: '提交审查', path: '/commits', icon: 'FileTextOutlined' },
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
      { id: 'system_notifications', name: '通知发送', path: '/system/notifications', icon: 'BellOutlined' },
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
  '/system/notifications': Bell,
  '/system/package-images': Box,
  '/system/logs': ScrollText,
};

const groupRules = [
  { title: '概览', paths: ['/dashboard', '/notifications'] },
  { title: '资源', paths: ['/projects', '/repositories', '/commits', '/credentials'] },
  { title: '发布', paths: ['/releases/create', '/releases', '/workflows', '/packages'] },
  {
    title: '系统',
    paths: [
      '/system/users',
      '/system/roles',
      '/system/configs',
      '/system/access-tokens',
      '/system/notifications',
      '/system/package-images',
      '/system/logs',
    ],
  },
  { title: '支持', paths: ['/guide', '/feedback', '/changelog'] },
];

// 全站统一命名口径（与后端菜单接口、路由标题一致），后端菜单名漂移时以此为准
const labelMap: Record<string, string> = {
  '/dashboard': '工作台',
  '/notifications': '通知',
  '/projects': '项目/产品',
  '/repositories': '仓库',
  '/commits': '提交审查',
  '/credentials': '凭证',
  '/releases/create': '新建发布',
  '/releases': '发布看板',
  '/workflows': '审批中心',
  '/packages': '打包看板',
  '/system/users': '用户管理',
  '/system/roles': '角色管理',
  '/system/configs': '系统配置',
  '/system/access-tokens': '访问令牌',
  '/system/notifications': '通知发送',
  '/system/package-images': '打包镜像',
  '/system/logs': '操作日志',
  '/guide': '使用说明',
  '/feedback': '使用反馈',
  '/changelog': '更新日志',
};

function flattenMenus(items: MenuItem[]): MenuItem[] {
  return items.flatMap((item) => (item.children?.length ? flattenMenus(item.children) : item));
}

function getMenuSource(menus: MenuItem[]): MenuItem[] {
  return menus.length > 0 ? menus : fallbackMenus;
}

function toNavItem(source: MenuItem, badge?: string): NavItem {
  return {
    id: source.id,
    name: labelMap[source.path] || source.name,
    path: source.path,
    icon: pathIconMap[source.path] || FileText,
    badge,
  };
}

export function buildGroups(menus: MenuItem[], badges?: Record<string, string>): NavGroup[] {
  const flatMenus = flattenMenus(getMenuSource(menus));
  const menuByPath = new Map(flatMenus.map((item) => [item.path, item]));

  const groups = groupRules
    .map((group) => ({
      title: group.title,
      items: group.paths.reduce<NavItem[]>((items, path) => {
        const source = menuByPath.get(path);
        if (!source) return items;
        items.push(toNavItem(source, badges?.[path]));
        return items;
      }, []),
    }))
    .filter((group) => group.items.length > 0);

  // 兜底：后端下发但不在分组规则内的菜单归入「其他」，不静默丢弃
  const knownPaths = new Set(groupRules.flatMap((group) => group.paths));
  const orphanItems = flatMenus
    .filter((item) => !knownPaths.has(item.path))
    .map((item) => toNavItem(item, badges?.[item.path]));
  if (orphanItems.length > 0) {
    if (import.meta.env.DEV) {
      console.warn(
        '[navMenu] 以下菜单路径未配置分组规则，已归入「其他」分组：',
        orphanItems.map((item) => item.path),
      );
    }
    groups.push({ title: '其他', items: orphanItems });
  }

  return groups;
}

export function isActivePath(currentPath: string, itemPath: string): boolean {
  if (itemPath === '/dashboard') {
    return currentPath === '/' || currentPath === '/dashboard';
  }
  // 新建发布是独立菜单项，发布看板不应在它下面高亮
  if (itemPath === '/releases' && currentPath.startsWith('/releases/create')) {
    return false;
  }
  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`);
}
