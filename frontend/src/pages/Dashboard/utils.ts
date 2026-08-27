import type { PackageTask, Release } from '@/types';
import type { BuildTrendItem } from './types';

/** 发布状态（与后端 ReleaseRecord.status 对齐） */
export type ReleaseStatus = 'draft' | 'pending' | 'released' | 'rejected';

/** 取日期字符串的日期部分（YYYY-MM-DD） */
export function formatDate(value?: string): string {
  return value?.split('T')[0] || '-';
}

/** 将时间字符串格式化为相对时间描述 */
export function formatRelative(value?: string): string {
  if (!value) return '刚刚';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDate(value);

  const diff = Date.now() - date.getTime();
  const minutes = Math.max(1, Math.floor(diff / 60000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

/** 取日期对应的 YYYY-MM-DD 键 */
export function getDateKey(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

/** 格式化趋势图展示用的日期（M/D） */
export function formatTrendDay(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/** 将后端按天发布趋势映射为图表数据（M/D 标签，不足 7 天前端补零） */
export function mapReleaseTrend(
  trend: Array<{ date: string; success_count: number; failure_count: number }>,
): BuildTrendItem[] {
  const byDate = new Map(trend.map((item) => [item.date, item]));
  const today = new Date();

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    const item = byDate.get(getDateKey(date));
    return {
      day: formatTrendDay(date),
      success: item?.success_count || 0,
      failed: item?.failure_count || 0,
    };
  });
}

/** 解析时长字符串（HH:MM:SS 或 Nm Ns）为秒数 */
export function parseDurationSeconds(duration?: string): number | null {
  if (!duration) return null;

  const parts = duration.split(':').map(Number);
  if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  const minuteMatch = duration.match(/(\d+)\s*m/i);
  const secondMatch = duration.match(/(\d+)\s*s/i);
  const minutes = minuteMatch ? Number(minuteMatch[1]) : 0;
  const seconds = secondMatch ? Number(secondMatch[1]) : 0;
  const total = minutes * 60 + seconds;

  return total > 0 ? total : null;
}

/** 取打包任务的实际耗时（秒），优先用 duration，回退到起止时间差 */
export function getBuildDurationSeconds(task: PackageTask): number | null {
  if (typeof task.duration === 'number' && task.duration > 0) {
    return Math.round(task.duration / 1000);
  }

  if (!task.started_at || !task.finished_at) return null;
  const startedAt = new Date(task.started_at).getTime();
  const finishedAt = new Date(task.finished_at).getTime();

  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt <= startedAt) return null;
  return Math.round((finishedAt - startedAt) / 1000);
}

/** 将秒数格式化为可读时长（如 12m 30s、1h 5m） */
export function formatDurationSeconds(seconds: number | null): string {
  if (seconds === null) return '-';

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/** 根据当前时间返回问候语 */
export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

/** 将发布状态归一化（仅保留当前 ReleaseRecord 的四个状态，未知状态按草稿处理） */
export function normalizeStatus(release: Release): ReleaseStatus {
  const status = release.status as string;
  if (status === 'released' || status === 'rejected' || status === 'pending') {
    return status;
  }
  return 'draft';
}

/** 计算运行中打包任务的已运行秒数 */
export function getRunningElapsedSeconds(task: PackageTask): number | null {
  if (!task.started_at) return null;
  const startedAt = new Date(task.started_at).getTime();
  if (!Number.isFinite(startedAt)) return null;
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  return elapsed > 0 ? elapsed : null;
}

/** 判断打包任务是否处于运行中（排队或打包中） */
export function isBuildRunning(task: PackageTask): boolean {
  return task.status === 'queued' || task.status === 'running';
}
