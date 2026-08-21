import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './time';

describe('formatRelativeTime', () => {
  it('空值返回占位符', () => {
    expect(formatRelativeTime()).toBe('-');
    expect(formatRelativeTime('')).toBe('-');
  });

  it('非法日期原样返回', () => {
    expect(formatRelativeTime('not-a-date')).toBe('not-a-date');
  });

  it('按时间差分级展示', () => {
    const now = Date.now();
    expect(formatRelativeTime(new Date(now - 30 * 1000).toISOString())).toBe('刚刚');
    expect(formatRelativeTime(new Date(now - 5 * 60 * 1000).toISOString())).toBe('5 分钟前');
    expect(formatRelativeTime(new Date(now - 3 * 3600 * 1000).toISOString())).toBe('3 小时前');
    expect(formatRelativeTime(new Date(now - 2 * 86400 * 1000).toISOString())).toBe('2 天前');
  });

  it('超过 30 天回退为完整日期格式', () => {
    const old = new Date(Date.now() - 40 * 86400 * 1000);
    expect(formatRelativeTime(old.toISOString())).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});
