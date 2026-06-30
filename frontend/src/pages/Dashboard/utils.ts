import type { BuildRecord, Release } from '@/types';
import type { BuildTrendItem, PipelineStatus } from './types';

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

/** 基于构建记录统计最近 7 天的成功/失败趋势 */
export function buildSevenDayTrend(builds: BuildRecord[]): BuildTrendItem[] {
  const today = new Date();

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    const key = getDateKey(date);
    const matchedBuilds = builds.filter((build) => getDateKey(new Date(build.created_at)) === key);

    return {
      day: formatTrendDay(date),
      success: matchedBuilds.filter((build) => build.status === 'success').length,
      failed: matchedBuilds.filter((build) => build.status === 'failure' || build.status === 'aborted').length,
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

/** 取构建记录的实际耗时（秒），优先用 duration，回退到起止时间差 */
export function getBuildDurationSeconds(build: BuildRecord): number | null {
  if (typeof build.duration === 'number' && build.duration > 0) {
    return Math.round(build.duration / 1000);
  }
  if (typeof build.duration === 'string') {
    const parsed = parseDurationSeconds(build.duration);
    if (parsed !== null) return parsed;
  }

  if (!build.started_at || !build.finished_at) return null;
  const startedAt = new Date(build.started_at).getTime();
  const finishedAt = new Date(build.finished_at).getTime();

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

/** 将发布状态归一化为流水线卡片状态（auditing 归入 pending） */
export function normalizeStatus(release: Release): PipelineStatus {
  const status = release.status as string;
  if (status === 'building') return 'building';
  if (status === 'auditing') return 'pending';
  if (status === 'released' || status === 'rejected' || status === 'pending' || status === 'draft') {
    return status;
  }
  return 'draft';
}

/** 判断构建是否处于运行中（排队或构建中） */
export function isBuildRunning(build: BuildRecord): boolean {
  return build.status === 'queue' || build.status === 'running';
}
