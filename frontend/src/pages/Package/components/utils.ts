import type { PackageTaskStatus } from '@/types';

export const stageLabels: Record<string, string> = {
  checkout: '拉取源码',
  build: '构建打包',
  artifacts: '扫描产物',
  done: '已完成',
};

export interface StatusMeta {
  label: string;
  dot: string;
  text: string;
  border: string;
  bg: string;
  pulse?: boolean;
}

export const statusMeta: Record<PackageTaskStatus, StatusMeta> = {
  queued: { label: '排队中', dot: 'bg-slate-400', text: 'text-slate-500', border: 'border-slate-200', bg: 'bg-slate-50' },
  running: { label: '打包中', dot: 'bg-cyan-500', text: 'text-cyan-700', border: 'border-cyan-200', bg: 'bg-cyan-50', pulse: true },
  success: { label: '成功', dot: 'bg-emerald-500', text: 'text-emerald-700', border: 'border-emerald-200', bg: 'bg-emerald-50' },
  failure: { label: '失败', dot: 'bg-rose-500', text: 'text-rose-600', border: 'border-rose-200', bg: 'bg-rose-50' },
  canceled: { label: '已取消', dot: 'bg-slate-400', text: 'text-slate-500', border: 'border-slate-200', bg: 'bg-slate-50' },
};

export const iconColors = ['icon-indigo', 'icon-violet', 'icon-cyan', 'icon-rose', 'icon-amber', 'icon-emerald'];

export function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '-';
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min}m${String(sec).padStart(2, '0')}s`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr}h${String(remMin).padStart(2, '0')}m`;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function isRunning(status: PackageTaskStatus): boolean {
  return status === 'running' || status === 'queued';
}

export function formatRelativeTime(date: string | Date): string {
  const now = new Date();
  const then = typeof date === 'string' ? new Date(date) : date;
  const diff = now.getTime() - then.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}个月前`;
  return `${Math.floor(months / 12)}年前`;
}
