import type { ReleaseType } from '@/types';

/** 发布状态文案映射 */
export const releaseStatusText: Record<string, string> = {
  draft: '草稿',
  pending: '待审批',
  building: '打包中',
  auditing: '待审批',
  released: '已发布',
  rejected: '已驳回',
};

/** 发布类型文案映射 */
export const releaseTypeText: Record<ReleaseType, string> = {
  formal: '正式',
  rc: 'RC',
  beta: 'Beta',
};

/** 发布类型样式映射 */
export const releaseTypeClass: Record<ReleaseType, string> = {
  formal: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  rc: 'border-blue-200 bg-blue-50 text-blue-700',
  beta: 'border-amber-200 bg-amber-50 text-amber-700',
};

/** 发布状态文字样式映射 */
export const statusTextClass: Record<string, string> = {
  draft: 'text-slate-500',
  pending: 'text-amber-700',
  building: 'text-cyan-700',
  auditing: 'text-amber-700',
  released: 'text-emerald-700',
  rejected: 'text-rose-600',
};

/** 发布状态圆点样式映射 */
export const statusDotClass: Record<string, string> = {
  draft: 'bg-slate-400',
  pending: 'bg-amber-500 pulse-dot',
  building: 'bg-cyan-500 pulse-dot',
  auditing: 'bg-amber-500 pulse-dot',
  released: 'bg-emerald-500',
  rejected: 'bg-rose-500',
};
