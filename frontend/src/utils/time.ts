import dayjs from 'dayjs';

export function formatRelativeTime(dateStr?: string): string {
  if (!dateStr) return '-';
  const target = dayjs(dateStr);
  if (!target.isValid()) return dateStr;

  const now = dayjs();
  const seconds = now.diff(target, 'second');

  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 30 * 86400) return `${Math.floor(seconds / 86400)} 天前`;
  return target.format('YYYY-MM-DD HH:mm');
}
