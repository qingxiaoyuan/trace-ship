import { describe, expect, it } from 'vitest';
import { DEFAULT_VERSION_RULE, resolveVersionRule } from './versionRule';

describe('resolveVersionRule', () => {
  it('空规则回退到系统默认：前缀 V、RC/Beta 后缀、不带时间戳', () => {
    expect(resolveVersionRule()).toEqual(DEFAULT_VERSION_RULE);
    expect(resolveVersionRule(null)).toEqual(DEFAULT_VERSION_RULE);
    expect(resolveVersionRule({})).toEqual({
      prefix: 'V',
      major: 1,
      minor: 0,
      patch: 0,
      suffixes: { rc: 'rc', beta: 'beta' },
      with_date: false,
    });
  });

  it('保留仓库已配置的前缀、后缀和日期开关', () => {
    expect(resolveVersionRule({
      prefix: 'VA',
      major: 2,
      suffixes: { rc: 'RC' },
      with_date: true,
    })).toEqual({
      prefix: 'VA',
      major: 2,
      minor: 0,
      patch: 0,
      suffixes: { rc: 'RC', beta: 'beta' },
      with_date: true,
    });
  });
});
