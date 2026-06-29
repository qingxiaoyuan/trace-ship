// 仓库管理常量

import type { Repository } from '@/types';

/** vendor 文案映射 */
export const vendorText: Record<string, string> = {
  gitlab: 'GitLab',
  gitea: 'Gitea',
  github: 'GitHub',
  gitee: 'Gitee',
  svn: 'SVN',
};

/** 仓库类型 + 平台徽标样式 */
export function repoTypeBadge(repo: Repository): { text: string; cls: string } {
  if (repo.repo_type === 'svn') {
    return { text: 'SVN', cls: 'border-amber-200 bg-amber-50 text-amber-600' };
  }
  const vendor = repo.vendor;
  const vendorLabel = vendorText[vendor] || vendor;
  return {
    text: `Git · ${vendorLabel}`,
    cls: vendor === 'gitea'
      ? 'border-cyan-200 bg-cyan-50 text-cyan-600'
      : vendor === 'github'
        ? 'border-slate-200 bg-slate-50 text-slate-600'
        : vendor === 'gitee'
          ? 'border-rose-200 bg-rose-50 text-rose-600'
          : 'border-indigo-200 bg-indigo-50 text-indigo-600',
  };
}

/** 健康状态展示 */
export function healthDisplay(status: Repository['health_status']): { text: string; cls: string; dot: string } {
  switch (status) {
    case 'healthy':
      return { text: '健康', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' };
    case 'unhealthy':
      return { text: '异常', cls: 'border-rose-200 bg-rose-50 text-rose-600', dot: 'bg-rose-500' };
    default:
      return { text: '未知', cls: 'border-slate-200 bg-slate-50 text-slate-500', dot: 'bg-slate-400' };
  }
}
