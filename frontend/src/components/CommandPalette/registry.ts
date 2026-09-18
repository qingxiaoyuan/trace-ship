import {
  Bell,
  BookOpen,
  Box,
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
  SlidersHorizontal,
  Tag,
  Users,
  Zap,
} from 'lucide-react';
import type { MenuItem } from '@/types';
import type { LucideIcon } from '@/layouts/components/navMenu';
import { buildGroups } from '@/layouts/components/navMenu';

/** 命令面板静态条目：功能入口（menu）与快捷操作（action） */
export interface CommandEntry {
  id: string;
  name: string;
  /** 跳转路径（可带查询参数，如 /packages?tab=configs） */
  path: string;
  /** 归属菜单路径，用于按当前用户可见菜单过滤（避免「搜得到、进不去」） */
  menuPath: string;
  /** 搜索关键词：中文别名 + 拼音首字母 */
  keywords: string[];
  icon: LucideIcon;
  group: 'menu' | 'action';
  /** 藏在深层 tab 内的入口给出路径提示，如「仓库 · 设置 · 审批流」 */
  hint?: string;
}

const COMMAND_ENTRIES: CommandEntry[] = [
  // ---- 功能入口：与侧边栏菜单一一对应 ----
  { id: 'dashboard', name: '工作台', path: '/dashboard', menuPath: '/dashboard', keywords: ['gongzuotai', 'gzt', '首页', 'home'], icon: LayoutDashboard, group: 'menu' },
  { id: 'releases', name: '发布看板', path: '/releases', menuPath: '/releases', keywords: ['fabu', 'fb', '发布', '看板', 'release'], icon: Rocket, group: 'menu' },
  { id: 'workflows', name: '审批中心', path: '/workflows', menuPath: '/workflows', keywords: ['shenpi', 'sp', '审批', '工作流', 'workflow'], icon: GitPullRequestArrow, group: 'menu' },
  { id: 'notifications', name: '通知', path: '/notifications', menuPath: '/notifications', keywords: ['tongzhi', 'tz', '消息', '通知'], icon: Bell, group: 'menu' },
  { id: 'guide', name: '使用说明', path: '/guide', menuPath: '/guide', keywords: ['shuoming', 'sm', '指南', '帮助', 'help', 'guide'], icon: BookOpen, group: 'menu' },
  { id: 'feedback', name: '使用反馈', path: '/feedback', menuPath: '/feedback', keywords: ['fankui', 'fk', '反馈', 'feedback'], icon: MessageSquareText, group: 'menu' },
  { id: 'changelog', name: '更新日志', path: '/changelog', menuPath: '/changelog', keywords: ['gengxin', 'gx', '日志', '版本记录', 'changelog'], icon: History, group: 'menu' },
  { id: 'projects', name: '项目/产品', path: '/projects', menuPath: '/projects', keywords: ['xiangmu', 'xm', '项目', '产品', 'project', 'chanpin', 'cp'], icon: FolderKanban, group: 'menu' },
  { id: 'repositories', name: '仓库', path: '/repositories', menuPath: '/repositories', keywords: ['cangku', 'ck', '仓库', 'repo', '代码'], icon: GitFork, group: 'menu' },
  { id: 'credentials', name: '凭证', path: '/credentials', menuPath: '/credentials', keywords: ['pingzheng', 'pz', '凭证', 'credential', '密钥'], icon: KeyRound, group: 'menu' },
  { id: 'packages', name: '打包看板', path: '/packages', menuPath: '/packages', keywords: ['dabao', 'db', '打包', 'package', '构建'], icon: Hammer, group: 'menu' },
  { id: 'commits', name: '提交审查', path: '/commits', menuPath: '/commits', keywords: ['tijiao', 'tj', '提交', '审查', 'commit', '规范'], icon: ScanSearch, group: 'menu' },

  { id: 'system-users', name: '用户管理', path: '/system/users', menuPath: '/system/users', keywords: ['yonghu', 'yh', '用户', 'user'], icon: Users, group: 'menu' },
  { id: 'system-roles', name: '角色管理', path: '/system/roles', menuPath: '/system/roles', keywords: ['juese', 'js', '角色', '权限', 'role'], icon: ShieldCheck, group: 'menu' },
  { id: 'system-configs', name: '系统配置', path: '/system/configs', menuPath: '/system/configs', keywords: ['xitongpeizhi', 'xtpz', '系统配置', 'config'], icon: Settings, group: 'menu' },
  { id: 'system-access-tokens', name: '访问令牌', path: '/system/access-tokens', menuPath: '/system/access-tokens', keywords: ['fangwenlingpai', 'fwlp', '令牌', 'token', '开放接口'], icon: KeySquare, group: 'menu' },
  { id: 'system-notifications', name: '通知发送', path: '/system/notifications', menuPath: '/system/notifications', keywords: ['tongzhifasong', 'tzfs', '通知发送', '广播', 'broadcast'], icon: Bell, group: 'menu' },
  { id: 'system-package-images', name: '打包镜像', path: '/system/package-images', menuPath: '/system/package-images', keywords: ['jingxiang', 'jx', '镜像', 'image', '打包镜像'], icon: Box, group: 'menu' },
  { id: 'system-logs', name: '操作日志', path: '/system/logs', menuPath: '/system/logs', keywords: ['caozuorizhi', 'czrz', '日志', '审计', 'log'], icon: ScrollText, group: 'menu' },

  // ---- 高频深配置项：藏在 tab / 卡片内，给出路径提示 ----
  { id: 'package-configs', name: '打包配置', path: '/packages?tab=configs', menuPath: '/packages', keywords: ['dabaopeizhi', 'dbpz', '打包配置', 'package config'], icon: SlidersHorizontal, group: 'menu', hint: '打包看板 · 打包配置' },
  { id: 'ldap-config', name: 'LDAP 配置', path: '/system/configs', menuPath: '/system/configs', keywords: ['ldap', '域账号', '域登录', '单点登录'], icon: Settings, group: 'menu', hint: '系统管理 · 系统配置 · LDAP' },
  { id: 'repo-audit-flow', name: '仓库审批流配置', path: '/repositories', menuPath: '/repositories', keywords: ['shenpiliu', 'spl', '审批流', '仓库审批', '流程配置'], icon: GitPullRequestArrow, group: 'menu', hint: '仓库 · 设置 · 审批流（需先选择仓库）' },
  { id: 'repo-version-rule', name: '版本规则', path: '/repositories', menuPath: '/repositories', keywords: ['banbenguize', 'bbgz', '版本', '版本规则', 'tag 规则'], icon: Tag, group: 'menu', hint: '仓库 · 设置 · 版本规则（需先选择仓库）' },

  // ---- 快捷操作 ----
  { id: 'action-create-release', name: '新建发布', path: '/releases/create', menuPath: '/releases/create', keywords: ['xinjianfabu', 'xjfb', '新建', '发布', 'xinjian'], icon: Tag, group: 'action' },
  { id: 'action-trigger-package', name: '触发打包', path: '/packages', menuPath: '/packages', keywords: ['chufadabao', 'cfdb', '触发', '打包', '构建'], icon: Zap, group: 'action' },
  { id: 'action-create-credential', name: '新建凭证', path: '/credentials', menuPath: '/credentials', keywords: ['xinjianpingzheng', 'xjpz', '新建', '凭证'], icon: KeyRound, group: 'action' },
];

/** 按当前用户可见菜单过滤静态条目（复用 navMenu 的分组可见性逻辑，含未登录时的兜底菜单） */
export function getVisibleEntries(menus: MenuItem[]): CommandEntry[] {
  const visiblePaths = new Set(buildGroups(menus).flatMap((group) => group.items.map((item) => item.path)));
  return COMMAND_ENTRIES.filter((entry) => visiblePaths.has(entry.menuPath));
}

/**
 * 仓库审批流 / 版本规则：有最近访问仓库时深链到该仓库对应 tab，
 * 否则仍落到仓库列表（需先选仓库）。
 */
export function applyRepoDeepLinks(
  entries: CommandEntry[],
  recentRepoId?: string,
  recentRepoTitle?: string,
): CommandEntry[] {
  if (!recentRepoId) return entries;
  const title = recentRepoTitle || '仓库';
  return entries.map((entry) => {
    if (entry.id === 'repo-audit-flow') {
      return {
        ...entry,
        path: `/repositories/${recentRepoId}/workflows`,
        hint: `${title} · 设置 · 审批流`,
      };
    }
    if (entry.id === 'repo-version-rule') {
      return {
        ...entry,
        path: `/repositories/${recentRepoId}/version-rule`,
        hint: `${title} · 设置 · 版本规则`,
      };
    }
    return entry;
  });
}

/** 静态条目匹配：name / keywords 的包含匹配（不引拼音库，关键词在注册表内维护） */
export function matchEntry(entry: CommandEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    entry.name.toLowerCase().includes(q) ||
    entry.keywords.some((keyword) => keyword.toLowerCase().includes(q))
  );
}
