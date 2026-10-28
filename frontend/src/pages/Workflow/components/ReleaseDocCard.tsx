import { parseMdTable } from '@/utils/markdownTable';

interface ReleaseDocCardProps {
  doc?: string;
}

/** 审批详情：发布变更文档（发布说明）只读展示 */
export function ReleaseDocCard({ doc }: ReleaseDocCardProps) {
  const mdContent = doc || '';
  const rows = parseMdTable(mdContent);

  return (
    <section aria-label="变更文档">
      <h3 className="mb-4 text-[15px] font-semibold tracking-tight text-slate-900">变更文档</h3>
      {!mdContent.trim() ? (
        <div className="py-6 text-center text-[13px] text-slate-400">暂无变更文档</div>
      ) : rows.length > 0 ? (
        <div className="max-h-[480px] overflow-auto rounded-lg border border-slate-200">
          <table className="w-full table-fixed border-collapse">
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx} className="border-b border-slate-100 last:border-0">
                  <td className="w-[110px] bg-slate-50/60 px-3 py-2 align-top text-[12px] font-medium text-slate-500 sm:w-[160px] sm:px-4">
                    {row.key}
                  </td>
                  <td className="break-words px-3 py-2 text-[13px] text-slate-700 [overflow-wrap:anywhere]">
                    {row.value.split(/<br>|\n/).map((line, lineIdx) => (
                      <div key={lineIdx}>{line}</div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 p-4 font-mono text-[13px] text-slate-700">
          {mdContent}
        </pre>
      )}
    </section>
  );
}
