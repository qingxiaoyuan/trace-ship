import { describe, expect, it } from 'vitest';
import { getAvatarColor } from './avatar';

describe('getAvatarColor', () => {
  it('无名返回调色板第一个颜色', () => {
    expect(getAvatarColor()).toBe('#2563EB');
    expect(getAvatarColor('')).toBe('#2563EB');
  });

  it('同名稳定返回同一颜色', () => {
    expect(getAvatarColor('张三')).toBe(getAvatarColor('张三'));
    expect(getAvatarColor('admin')).toBe(getAvatarColor('admin'));
  });

  it('返回值始终在调色板内', () => {
    const palette = ['#2563EB', '#D97706', '#7C3AED', '#DC2626', '#059669', '#0891B2', '#BE185D', '#4338CA'];
    for (const name of ['a', 'bb', 'ccc', '李四', 'test@example.com']) {
      expect(palette).toContain(getAvatarColor(name));
    }
  });
});
