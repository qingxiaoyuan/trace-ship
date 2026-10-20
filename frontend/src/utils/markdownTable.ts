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

/** 生成器只转义管道符；分列时保留转义，读取字段时再还原。 */
function splitCells(line: string, preserveWhitespace = false): string[] {
  return line.split(/(?<!\\)\|/).map((cell) => preserveWhitespace ? cell : cell.trim());
}

/** 生成器在分隔符内侧各写一个空格；其余空白属于字段，不能 trim。 */
function removeCellPadding(value: string): string {
  return value.replace(/^ /, '').replace(/ $/, '');
}

function unescapePipes(value: string): string {
  return value.replace(/\\\|/g, '|');
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
export function parseMdTable(md: string, options: { preserveWhitespace?: boolean } = {}): MdTableRow[] {
  if (!md) return [];
  const rows: MdTableRow[] = [];
  const lines = md.trim().split('\n');
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    const rowSource = options.preserveWhitespace ? lines[i].trimStart().replace(/\r$/, '') : trimmed;
    if (!trimmed.startsWith('|')) {
      i++;
      continue;
    }

    // 空首行只有两个分隔符，末尾的管道属于列分隔，尚不是值的闭合符。
    if (/(?<!\\)\|$/.test(trimmed) && (!options.preserveWhitespace || splitCells(trimmed).length >= 4)) {
      // 完整单行：| key | value |
      const cells = splitCells(rowSource, options.preserveWhitespace);
      const inner = cells.slice(1, -1);
      if (inner.length < 2) { i++; continue; }
      const key = inner[0].trim();
      const value = options.preserveWhitespace ? removeCellPadding(inner[1]) : inner[1];
      if (/^[-:\s]+$/.test(key)) { i++; continue; }
      if ((key === '项目' || key === '字段') && value === '内容') { i++; continue; }
      rows.push({ key: unescapePipes(key), value: unescapePipes(value) });
      i++;
    } else {
      // 多行单元格：| key | value line 1 (未闭合)
      const cells = splitCells(rowSource, options.preserveWhitespace);
      const key = (cells[1] || '').trim();
      // key 之后到行尾的内容是 value 的第一行
      let valueParts = options.preserveWhitespace
        ? cells.slice(2).join('|').replace(/^ /, '')
        : cells.slice(2).join('|').trim();
      i++;
      // 后续不以 | 开头的行都是 value 的延续
      while (i < lines.length && (!lines[i].trim().startsWith('|')
        || (options.preserveWhitespace && lines[i].trim() === '|'))) {
        const continuation = options.preserveWhitespace
          ? lines[i].replace(/\r$/, '').replace(/ ?(?<!\\)\|$/, '')
          : lines[i].trim().replace(/(?<!\\)\|$/, '').trim();
        valueParts += '\n' + continuation;
        i++;
      }
      if (/^[-:\s]+$/.test(key)) continue;
      if ((key === '项目' || key === '字段') && valueParts === '内容') continue;
      rows.push({ key: unescapePipes(key), value: unescapePipes(valueParts) });
    }
  }
  return rows;
}

/** 仅在两列表格可完整往返时使用字段协议，不吞掉混合正文、额外列或有效缩进。 */
export function parseCompleteMdTable(content: string): MdTableRow[] {
  const rows = parseMdTable(content, { preserveWhitespace: true });
  if (!rows.length) return [];
  const source = content.trim().split(/\r?\n/);
  if (/^\|\s*(?:项目|字段)\s*\|\s*内容\s*\|$/.test(source[0].trim())) source.shift();
  if (/^\|\s*[-:]+\s*\|\s*[-:]+\s*\|$/.test(source[0]?.trim() || '')) source.shift();
  const normalize = (lines: string[]) => lines.map((line) => line.startsWith('|')
    ? line.replace(/(?<!\\)\| ?/g, '|').replace(/ ?(?<!\\)\|/g, '|')
    : line.replace(/ (?<!\\)\|$/, '|')).join('\n');
  return normalize(source) === normalize(buildMdTable(rows).split('\n').slice(2)) ? rows : [];
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
