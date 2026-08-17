// 发布看板常量

import type { ReleaseStatus, ReleaseType } from '@/types';

/** 发布状态文案 */
export const releaseStatusText: Record<ReleaseStatus, string> = {
  draft: '草稿',
  pending: '待审批',
  released: '已发布',
  rejected: '已驳回',
};

/** 看板列配置：状态 → 列样式 */
export const boardColumns: {
  key: ReleaseStatus;
  label: string;
  tone: string;
  dot: string;
  countText: string;
  cardBorder: string;
}[] = [
  {
    key: 'pending',
    label: '待审批',
    tone: 'border-amber-200/70 bg-amber-50/40',
    dot: 'bg-amber-500 pulse-dot',
    countText: 'text-amber-600',
    cardBorder: 'border-amber-200 hover:border-amber-400',
  },
  {
    key: 'released',
    label: '已发布',
    tone: 'border-emerald-200/70 bg-emerald-50/40',
    dot: 'bg-emerald-500',
    countText: 'text-emerald-600',
    cardBorder: 'border-emerald-200 hover:border-emerald-400',
  },
  {
    key: 'rejected',
    label: '已驳回',
    tone: 'border-rose-200/70 bg-rose-50/40',
    dot: 'bg-rose-500',
    countText: 'text-rose-500',
    cardBorder: 'border-rose-200 hover:border-rose-400',
  },
];

/** 发布类型文案 */
export const releaseTypeText: Record<ReleaseType, string> = {
  formal: '正式',
  rc: 'RC',
  beta: 'BETA',
};

/** 发布类型徽标样式 */
export const releaseTypeBadge: Record<ReleaseType, string> = {
  formal: 'border-emerald-200 bg-emerald-50 text-emerald-600',
  rc: 'border-blue-200 bg-blue-50 text-blue-600',
  beta: 'border-amber-200 bg-amber-50 text-amber-600',
};

/** 详情头状态徽标 */
export const statusBadge: Record<ReleaseStatus, string> = {
  draft: 'border-slate-200 bg-slate-50 text-slate-500',
  pending: 'border-amber-200 bg-amber-50 text-amber-700',
  released: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  rejected: 'border-rose-200 bg-rose-50 text-rose-600',
};
