/**
 * Markdown 表格轻量解析工具
 *
 * 用于发布详情页只读渲染 release_doc（Markdown 2 列表格）。
 */

export interface MdTableRow {
  key: string;
  value: string;
}

/**
 * 解析 Markdown 2 列表格为行数组
 *
 * 仅解析 `| key | value |` 格式，跳过表头行和分隔行。
 *
 * @param md Markdown 字符串
 * @returns 行数组
 */
export function parseMdTable(md: string): MdTableRow[] {
  if (!md) return [];
  const rows: MdTableRow[] = [];
  for (const line of md.trim().split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed.split('|').map((c) => c.trim());
    // 去掉首尾空串
    const filtered = cells.filter((_, i) => i !== 0 && i !== cells.length - 1);
    if (filtered.length < 2) continue;
    // 跳过分隔行 |------|------|
    if (/^[-:\s]+$/.test(filtered[0])) continue;
    // 跳过表头
    if (filtered[0] === '项目' && filtered[1] === '内容') continue;
    rows.push({ key: filtered[0], value: filtered[1] });
  }
  return rows;
}

/**
 * 将行数组序列化为 Markdown 2 列表格字符串
 *
 * @param rows 行数组
 * @returns Markdown 表格字符串（含最小表头以兼容 MD 语法）
 */
export function buildMdTable(rows: MdTableRow[]): string {
  const lines = ['| 项目 | 内容 |', '|------|------|'];
  for (const row of rows) {
    // 将换行转为 <br>，转义管道符
    const safeKey = row.key.replace(/\n/g, '<br>').replace(/\|/g, '\\|');
    const safeValue = row.value.replace(/\n/g, '<br>').replace(/\|/g, '\\|');
    lines.push(`| ${safeKey} | ${safeValue} |`);
  }
  return lines.join('\n');
}
