import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** 意见正文保留 Markdown 语义；宽表格和代码块在各自容器内滚动。 */
export function ReviewMarkdown({ children }: { children: string }) {
  return <div className="min-w-0 space-y-2 whitespace-pre-wrap break-words leading-6 [&_code]:text-[0.9em] [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-slate-50 [&_pre]:p-2 [&_ul]:list-inside [&_ul]:list-disc [&_ol]:list-inside [&_ol]:list-decimal">
    <Markdown remarkPlugins={[remarkGfm]} components={{
      table: ({ children: cells }) => <div role="region" aria-label="审查意见表格" tabIndex={0} className="max-w-full overflow-x-auto rounded border border-slate-200">
        <table className="w-full whitespace-normal text-left text-xs [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2 [&_td]:border-b [&_td]:border-slate-100 [&_td]:px-3 [&_td]:py-2">{cells}</table>
      </div>,
    }}>{children}</Markdown>
  </div>;
}
