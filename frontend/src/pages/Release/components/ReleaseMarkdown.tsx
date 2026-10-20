import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseCompleteMdTable, type MdTableRow } from '@/utils/markdownTable';
import './releaseMarkdown.css';

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: object;
  position?: { start: { offset?: number }; end: { offset?: number } };
};

/** 只转换 Markdown HTML 节点中的换行标签，不改写代码示例里的原文。 */
function transformBreakTags(tree: MarkdownNode, parse: (source: string) => MarkdownNode) {
  const shiftOffsets = (node: MarkdownNode, offset: number) => {
    for (const point of [node.position?.start, node.position?.end]) {
      if (point?.offset !== undefined) point.offset += offset;
    }
    node.children?.forEach((child) => shiftOffsets(child, offset));
  };
  const visit = (node: MarkdownNode) => {
    if (node.children) node.children = node.children.flatMap((child) => {
      const tag = child.type === 'html' && child.value?.match(/^<br\s*\/?>/i);
      if (tag) {
        const lineBreak = { type: 'break' };
        if (child.value === tag[0]) {
          return node.type === 'paragraph' ? [lineBreak] : [{ type: 'paragraph', children: [lineBreak] }];
        }
        // 行首 br 会把后续 Markdown 吞入 HTML 块，交回原解析器恢复其语义。
        const remainder = parse(child.value!.slice(tag[0].length));
        shiftOffsets(remainder, (child.position?.start.offset || 0) + tag[0].length);
        visit(remainder);
        const blocks = remainder.children || [];
        if (blocks[0]?.type === 'paragraph') blocks[0].children?.unshift(lineBreak);
        else blocks.unshift({ type: 'paragraph', children: [lineBreak] });
        return blocks;
      }
      visit(child);
      return [child];
    });
  };
  visit(tree);
}

function remarkBreakTags(this: { parse: (source: string) => MarkdownNode }) {
  return (tree: MarkdownNode) => transformBreakTags(tree, (source) => this.parse(source));
}

/** 恢复字段文本的物理换行和缩进，不改写转义、代码或 HTML 节点。 */
function restoreFieldWhitespace(tree: MarkdownNode, source: string) {
  const visit = (node: MarkdownNode) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (node.type === 'text' && start !== undefined && end !== undefined) {
      const raw = source.slice(start, end);
      if (raw.replace(/\s/g, '') === node.value?.replace(/\s/g, '')) node.value = raw;
    }
    node.children?.forEach(visit);
  };
  visit(tree);
}

/** 仅恢复生成器两列表格，整篇仍使用同一 Markdown 树和引用定义。 */
function remarkGeneratedTables(this: { parse: (source: string) => MarkdownNode }) {
  const parse = (source: string) => this.parse(source);
  return (tree: MarkdownNode, file: { value: unknown }) => {
    const source = String(file.value);
    let offset = 0;
    const lines = source.split('\n').map((raw) => {
      const line = { value: raw.replace(/\r$/, ''), start: offset, end: offset + raw.length };
      offset += raw.length + 1;
      return line;
    });
    const tables: { start: number; end: number; heading: string; rows: MdTableRow[] }[] = [];
    // 只考虑原解析器已经确认的顶层表格；围栏、缩进代码和引用中的示例不会进入此分支。
    for (const node of tree.children || []) {
      if (node.type !== 'table') continue;
      const index = lines.findIndex((line) => line.start === node.position?.start.offset);
      if (index < 0 || !/^\|\s*(?:项目|字段)\s*\|\s*内容\s*\|$/.test(lines[index].value)
        || !/^\|\s*[-:]+\s*\|\s*[-:]+\s*\|$/.test(lines[index + 1]?.value || '')) continue;
      let cursor = index + 2;
      let multiline = false;
      let valid = true;
      while (cursor < lines.length && lines[cursor].value.startsWith('|')) {
        const first = lines[cursor].value;
        const closed = /(?<!\\)\|[ \t]*$/.test(first) && (first.match(/(?<!\\)\|/g) || []).length === 3;
        if ((first.match(/(?<!\\)\|/g) || []).length !== (closed ? 3 : 2)) break;
        cursor++;
        if (closed) continue;
        multiline = true;
        let complete = false;
        while (cursor < lines.length) {
          const continuation = lines[cursor].value;
          const pipes = (continuation.match(/(?<!\\)\|/g) || []).length;
          if (pipes && (pipes !== 1 || !/(?<!\\)\|[ \t]*$/.test(continuation))) break;
          cursor++;
          if (pipes === 1) { complete = true; break; }
        }
        if (!complete) { valid = false; break; }
      }
      if (!valid || !multiline || cursor <= index + 2) continue;
      const block = lines.slice(index, cursor).map((line) => line.value).join('\n');
      const rows = parseCompleteMdTable(block);
      if (!rows.length) continue;
      tables.push({ start: lines[index].start, end: lines[cursor - 1].end, heading: lines[index].value.split('|')[1].trim(), rows });
    }
    if (!tables.length) return;

    // 引用必须在解析字段时已定义，且最终仍在同一文档树内解析；不能把前后文拆成多个 Markdown。
    const definitions: string[] = [];
    const collectDefinitions = (node: MarkdownNode) => {
      if (node.type === 'definition' || node.type === 'footnoteDefinition') {
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        if (start !== undefined && end !== undefined) definitions.push(source.slice(start, end));
      }
      node.children?.forEach(collectDefinitions);
    };
    collectDefinitions(tree);
    const element = (tag: string, children: MarkdownNode[]): MarkdownNode => ({
      type: 'releaseGeneratedElement', data: { hName: tag }, children,
    });
    const field = (value: string): MarkdownNode => {
      const parsed = parse(value + '\n\n' + definitions.join('\n\n'));
      parsed.children = parsed.children?.filter((node) => (node.position?.start.offset || 0) < value.length);
      transformBreakTags(parsed, parse);
      restoreFieldWhitespace(parsed, value);
      const prepareFieldNodes = (node: MarkdownNode) => {
        // 默认 text 转换还会修剪每行缩进；字段文本走安全的文本节点转换，保留已恢复的空白。
        if (node.type === 'text') node.type = 'releaseFieldText';
        delete node.position;
        node.children?.forEach(prepareFieldNodes);
      };
      prepareFieldNodes(parsed);
      const cell = element('td', parsed.children || []);
      cell.data = { ...cell.data, hProperties: { className: ['release-note-value'] } };
      return cell;
    };
    let marker = 'trace-ship-generated-table';
    while (source.includes(marker)) marker += '_';
    const placeholders = tables.map((_, index) => `<!--${marker}-${index}-->`);
    let prepared = source;
    for (let index = tables.length - 1; index >= 0; index--) {
      const table = tables[index];
      prepared = prepared.slice(0, table.start) + placeholders[index] + prepared.slice(table.end);
    }
    const restored = parse(prepared);
    const replace = (node: MarkdownNode) => {
      node.children = node.children?.map((child) => {
        const index = child.type === 'html' ? placeholders.indexOf(child.value || '') : -1;
        if (index >= 0) {
          return element('table', [
            element('thead', [element('tr', [tables[index].heading, '内容'].map((value) => element('th', [{ type: 'text', value }])))]),
            element('tbody', tables[index].rows.map((row) => element('tr', [
              element('td', [{ type: 'text', value: row.key }]), field(row.value),
            ]))),
          ]);
        }
        replace(child);
        return child;
      });
    };
    replace(restored);
    // 其余节点的位置来自同一份重解析源，字段局部位置已清除，避免空白恢复错误切片。
    file.value = prepared;
    return restored;
  };
}

/** 旧两列表格的续行缩进是字段内容，保留文本节点中被 Markdown 折叠的空白。 */
function rehypeFieldWhitespace() {
  return (tree: MarkdownNode, file: { value: unknown }) => {
    restoreFieldWhitespace(tree, String(file.value));
  };
}

/** 将保存的说明渲染为文档；宽表格在自身容器内滚动。 */
export function ReleaseMarkdown({ content, field = false }: { content: string; field?: boolean }) {
  return <div className="release-markdown">
    <Markdown remarkPlugins={[remarkGfm, remarkGeneratedTables, remarkBreakTags]} rehypePlugins={field ? [rehypeFieldWhitespace] : []} components={{
      table: ({ children }) => <div className="release-markdown-table" role="region" aria-label="发布说明表格" tabIndex={0}>
        <table>{children}</table>
      </div>,
      a: ({ href, children }) => <a href={href} target={href?.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer">{children}</a>,
    }}>{content}</Markdown>
  </div>;
}
