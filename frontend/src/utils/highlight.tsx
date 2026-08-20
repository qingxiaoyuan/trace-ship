/**
 * 文本关键字高亮工具（纯前端）
 *
 * 用于审查员查看变更文档时高亮系统配置维护的关键字，
 * 不依赖后端处理，仅在渲染层包裹 <mark>。
 */
import type { ReactNode } from 'react';

/** 转义正则特殊字符 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 将 text 中命中的关键字用 <mark> 高亮
 *
 * 关键字匹配不区分大小写；无关键字或无命中时原样返回字符串。
 *
 * Args:
 *   text: 原始文本
 *   keywords: 关键字列表（已去空白）
 *
 * Returns:
 *   ReactNode（字符串或带 <mark> 的节点数组）
 */
export function highlightKeywords(text: string, keywords: string[]): ReactNode {
  const valid = keywords.filter((k) => k.trim());
  if (!text || valid.length === 0) return text;

  const pattern = new RegExp(`(${valid.map(escapeRegExp).join('|')})`, 'gi');
  const parts = text.split(pattern);
  if (parts.length <= 1) return text;

  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded bg-amber-200/70 px-0.5 text-inherit">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

/** 解析配置值为关键字列表（支持换行 / 中英文逗号分隔） */
export function parseKeywords(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n,，;；]+/)
    .map((k) => k.trim())
    .filter(Boolean);
}
