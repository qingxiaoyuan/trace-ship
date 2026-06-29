import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

export function isExpired(date?: string) {
  if (!date) return false;
  return dayjs(date).isBefore(dayjs());
}

export function isNearExpiry(date?: string, days = 30) {
  if (!date) return false;
  const target = dayjs(date);
  const now = dayjs();
  const diff = target.diff(now, 'millisecond');
  return diff > 0 && diff < days * 24 * 60 * 60 * 1000;
}

export type CredentialStatus = 'valid' | 'nearExpiry' | 'expired' | 'inactive';

export function getCredentialStatus(active: boolean, expiresAt?: string): CredentialStatus {
  if (!active) return 'inactive';
  if (isExpired(expiresAt)) return 'expired';
  if (isNearExpiry(expiresAt)) return 'nearExpiry';
  return 'valid';
}

export const statusConfig: Record<
  CredentialStatus,
  { label: string; dot: string; border: string; bg: string; text: string }
> = {
  valid: {
    label: '有效',
    dot: 'bg-emerald-500',
    border: 'border-emerald-200',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
  },
  nearExpiry: {
    label: '即将过期',
    dot: 'bg-amber-500',
    border: 'border-amber-200',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
  },
  expired: {
    label: '已过期',
    dot: 'bg-rose-500',
    border: 'border-rose-200',
    bg: 'bg-rose-50',
    text: 'text-rose-600',
  },
  inactive: {
    label: '停用',
    dot: 'bg-slate-400',
    border: 'border-slate-200',
    bg: 'bg-slate-50',
    text: 'text-slate-600',
  },
};

export function formatDate(date?: string, fallback = '-') {
  if (!date) return fallback;
  return dayjs(date).format('YYYY-MM-DD');
}

export function formatDateTime(date?: string, fallback = '-') {
  if (!date) return fallback;
  return dayjs(date).format('YYYY-MM-DD HH:mm');
}

export function fromNow(date?: string, fallback = '-') {
  if (!date) return fallback;
  return dayjs(date).fromNow();
}
