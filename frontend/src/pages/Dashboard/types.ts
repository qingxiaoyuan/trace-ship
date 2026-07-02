import type { ComponentType, ReactNode } from 'react';
import type { Release } from '@/types';

/** Lucide 图标组件类型 */
export type LucideIcon = ComponentType<{ className?: string; strokeWidth?: number }>;

/** 发布流水线卡片状态 */
export type PipelineStatus = 'draft' | 'building' | 'pending' | 'released' | 'rejected';

/** KPI 指标卡片数据 */
export interface KpiCard {
  title: string;
  value: ReactNode;
  unit?: string;
  description: ReactNode;
  icon: LucideIcon;
  iconClass: string;
  action?: ReactNode;
  footer?: ReactNode;
}

/** 发布流水线列数据 */
export interface PipelineColumn {
  key: PipelineStatus;
  label: string;
  count: number;
  tone: string;
  dot: string;
  cardBorder: string;
  releases: Release[];
}

/** 我的待办项数据 */
export interface TodoItem {
  key: string;
  title: string;
  project: string;
  meta: string;
  icon: LucideIcon;
  iconClass: string;
  actions: ReactNode;
  type: 'audit' | 'build' | 'commit';
}

/** 发布流水线时间范围过滤 */
export type PipelineRange = 'all' | 'today' | 'week';

/** 我的待办类型过滤 */
export type TodoFilter = 'all' | 'audit' | 'build';

/** 打包趋势单日数据 */
export interface BuildTrendItem {
  day: string;
  success: number;
  failed: number;
}
