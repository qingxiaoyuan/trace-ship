/**
 * Markdown 表格轻量解析工具
 *
 * 用于发布详情页只读渲染 release_doc（Markdown 2 列表格）。
 * 支持多行单元格：值中含换行时，后续不以 | 开头的行视为上一行值的延续。
 */

export interface MdTableRow {
  key: string;
  value: string;
}

/**
 * 解析 Markdown 2 列表格为行数组
 *
 * 仅解析 `| key | value |` 格式，跳过表头行和分隔行。
 * 支持多行单元格：当某行不以 | 结尾时，后续不以 | 开头的行
 * 视为该行 value 的延续行，用 \n 拼接。
 *
 * @param md Markdown 字符串
 * @returns 行数组
 */
export function parseMdTable(md: string): MdTableRow[] {
  if (!md) return [];
  const rows: MdTableRow[] = [];
  const lines = md.trim().split('\n');
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith('|')) {
      i++;
      continue;
    }

    if (trimmed.endsWith('|')) {
      // 完整单行：| key | value |
      const cells = trimmed.split('|').map((c) => c.trim());
      const inner = cells.slice(1, -1);
      if (inner.length < 2) { i++; continue; }
      if (/^[-:\s]+$/.test(inner[0])) { i++; continue; }
      if ((inner[0] === '项目' || inner[0] === '字段') && inner[1] === '内容') { i++; continue; }
      rows.push({ key: inner[0], value: inner[1] });
      i++;
    } else {
      // 多行单元格：| key | value line 1 (未闭合)
      const cells = trimmed.split('|').map((c) => c.trim());
      const key = cells[1] || '';
      // key 之后到行尾的内容是 value 的第一行
      let valueParts = cells.slice(2).join('|').trim();
      i++;
      // 后续不以 | 开头的行都是 value 的延续
      while (i < lines.length && !lines[i].trim().startsWith('|')) {
        valueParts += '\n' + lines[i].trim().replace(/\|$/, '').trim();
        i++;
      }
      if (/^[-:\s]+$/.test(key)) continue;
      if ((key === '项目' || key === '字段') && valueParts === '内容') continue;
      rows.push({ key, value: valueParts });
    }
  }
  return rows;
}

/**
 * 将行数组序列化为 Markdown 2 列表格字符串
 *
 * 保持多行值原样输出（值中含 \n 时生成多行单元格），
 * 不拆分为多行也不使用 <br> 标签。
 *
 * 注意：parseMdTable -> buildMdTable 为幂等往返--含换行的值
 * 经往返后保持为同一行的多行单元格。
 *
 * @param rows 行数组
 * @returns Markdown 表格字符串（含最小表头以兼容 MD 语法）
 */
export function buildMdTable(rows: MdTableRow[]): string {
  const lines = ['| 字段 | 内容 |', '|------|------|'];
  for (const row of rows) {
    const safeKey = row.key.replace(/\|/g, '\\|');
    const safeValue = row.value.replace(/\|/g, '\\|');
    lines.push(`| ${safeKey} | ${safeValue} |`);
  }
  return lines.join('\n');
}
