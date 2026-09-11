import type { VersionRule } from '@/types';

/** 回填后的完整版本规则 */
export interface ResolvedVersionRule {
  prefix: string;
  major: number;
  minor: number;
  patch: number;
  suffixes: {
    rc: string;
    beta: string;
  };
  with_date: boolean;
}

/** 新建仓库的系统默认版本规则：前缀 V，RC/Beta 后缀，默认不带时间戳 */
export const DEFAULT_VERSION_RULE: ResolvedVersionRule = {
  prefix: 'V',
  major: 1,
  minor: 0,
  patch: 0,
  suffixes: {
    rc: 'rc',
    beta: 'beta',
  },
  with_date: false,
};

/** 将仓库已存规则与系统默认合并，供版本规则表单回填 */
export function resolveVersionRule(rule?: VersionRule | null): ResolvedVersionRule {
  const suffixes = rule?.suffixes || {};
  return {
    prefix: rule?.prefix || DEFAULT_VERSION_RULE.prefix,
    major: rule?.major ?? DEFAULT_VERSION_RULE.major,
    minor: rule?.minor ?? DEFAULT_VERSION_RULE.minor,
    patch: rule?.patch ?? DEFAULT_VERSION_RULE.patch,
    suffixes: {
      rc: suffixes.rc || DEFAULT_VERSION_RULE.suffixes.rc,
      beta: suffixes.beta || DEFAULT_VERSION_RULE.suffixes.beta,
    },
    with_date: rule?.with_date ?? DEFAULT_VERSION_RULE.with_date,
  };
}
