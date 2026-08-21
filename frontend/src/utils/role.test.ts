import { describe, expect, it } from 'vitest';
import { getRoleLabel } from './role';

describe('getRoleLabel', () => {
  it('空用户返回默认标签', () => {
    expect(getRoleLabel(null)).toBe('用户');
    expect(getRoleLabel(undefined)).toBe('用户');
  });

  it('超管优先于角色列表', () => {
    expect(getRoleLabel({ is_superuser: true, roles: ['developer'] })).toBe('超级管理员');
  });

  it('已知角色映射为中文', () => {
    expect(getRoleLabel({ roles: ['developer'] })).toBe('开发人员');
    expect(getRoleLabel({ roles: ['software_admin'] })).toBe('软件管理员');
  });

  it('未知角色原样展示，无角色回退默认标签', () => {
    expect(getRoleLabel({ roles: ['custom_role'] })).toBe('custom_role');
    expect(getRoleLabel({ roles: [] })).toBe('用户');
  });
});
