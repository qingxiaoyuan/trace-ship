// 审批中心常量与共享类型

import type { ReleaseType } from '@/types';

/** 审批任务状态到展示状态/文案的映射（用于「我的已办」审批动作列） */
export const workflowStatusMap: Record<
  string,
  { status: 'success' | 'danger' | 'info' | 'warning'; text: string }
> = {
  approved: { status: 'success', text: '已通过' },
  rejected: { status: 'danger', text: '已驳回' },
  transferred: { status: 'info', text: '已转交' },
  rollbacked: { status: 'warning', text: '已回退' },
};

/** 流程实例状态到展示文案/色调的映射（用于详情头徽标） */
export const instanceStatusMap: Record<
  string,
  { text: string; badge: string }
> = {
  running: { text: '审批中', badge: 'border-amber-200 bg-amber-50 text-amber-700' },
  completed: { text: '已完成', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  rejected: { text: '已驳回', badge: 'border-rose-200 bg-rose-50 text-rose-600' },
  revoked: { text: '已撤销', badge: 'border-slate-200 bg-slate-50 text-slate-500' },
};

/** 审批中心 Tab 标识 */
export type TabKey = 'todo' | 'initiated' | 'done';

/** 审批中心 Tab 配置 */
export const tabItems: { key: TabKey; label: string }[] = [
  { key: 'todo', label: '待我审批' },
  { key: 'initiated', label: '我发起的' },
  { key: 'done', label: '我的已办' },
];

/** 发布类型文案 */
export const releaseTypeText: Record<ReleaseType, string> = {
  formal: '正式',
  rc: 'RC',
  beta: 'Beta',
};

/** 发布类型徽标样式 */
export const releaseTypeBadge: Record<ReleaseType, string> = {
  formal: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  rc: 'border-blue-200 bg-blue-50 text-blue-700',
  beta: 'border-amber-200 bg-amber-50 text-amber-700',
};
