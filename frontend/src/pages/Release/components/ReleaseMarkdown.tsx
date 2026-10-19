import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './releaseMarkdown.css';

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

/** 只转换 Markdown HTML 节点中的换行标签，不改写代码示例里的原文。 */
function remarkBreakTags() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (node.children) node.children = node.children.flatMap((child) => {
        if (child.type === 'html' && /^<br\s*\/?>/i.test(child.value || '')) {
          const children = (child.value || '').split(/(<br\s*\/?>)/gi).filter(Boolean).map((part) =>
            /^<br\s*\/?>$/i.test(part) ? { type: 'break' } : { type: 'text', value: part });
          return node.type === 'paragraph' ? children : [{ type: 'paragraph', children }];
        }
        visit(child);
        return [child];
      });
    };
    visit(tree);
  };
}

/** 旧两列表格的续行缩进是字段内容，保留文本节点中被 Markdown 折叠的空白。 */
function rehypeFieldWhitespace() {
  return (tree: MarkdownNode, file: { value: unknown }) => {
    const source = String(file.value);
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
  };
}

/** 将保存的说明渲染为文档；宽表格在自身容器内滚动。 */
export function ReleaseMarkdown({ content, field = false }: { content: string; field?: boolean }) {
  return <div className="release-markdown">
    <Markdown remarkPlugins={[remarkGfm, remarkBreakTags]} rehypePlugins={field ? [rehypeFieldWhitespace] : []} components={{
      table: ({ children }) => <div className="release-markdown-table" role="region" aria-label="发布说明表格" tabIndex={0}>
        <table>{children}</table>
      </div>,
      a: ({ href, children }) => <a href={href} target={href?.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer">{children}</a>,
    }}>{content}</Markdown>
  </div>;
}
