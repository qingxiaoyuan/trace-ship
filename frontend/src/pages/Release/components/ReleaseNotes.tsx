import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from 'antd';
import { FileDown, FileText, FileCode } from 'lucide-react';
import { releaseApi } from '@/api/release';
import { useAppMessage } from '@/hooks/useAppMessage';
import { parseMdTable } from '@/utils/markdownTable';
import type { Release } from '@/types';

interface ReleaseNotesProps {
  release: Release;
}

/** 下载 Blob */
function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

/** 发布说明 Tab：渲染 Markdown 表格 + 导出 */
export function ReleaseNotes({ release }: ReleaseNotesProps) {
  const queryClient = useQueryClient();
  const { message } = useAppMessage();

  const mdContent = release.release_doc || '';
  const hasDoc = !!mdContent.trim();
  const rows = parseMdTable(mdContent);

  const generateMutation = useMutation({
    mutationFn: () => releaseApi.generateDoc(release.id),
    onSuccess: () => {
      message.success('发布说明已生成');
      queryClient.invalidateQueries({ queryKey: ['release', release.id] });
    },
    onError: () => message.error('生成失败'),
  });

  const handleExportPdf = async () => {
    try {
      const blob = await releaseApi.exportPdf(release.id);
      downloadBlob(blob, `${release.version}_发布单.pdf`);
      message.success('PDF 导出成功');
    } catch {
      message.error('PDF 导出失败');
    }
  };

  const handleExportWord = async () => {
    try {
      const blob = await releaseApi.exportWord(release.id);
      downloadBlob(blob, `${release.version}_发布单.docx`);
      message.success('Word 导出成功');
    } catch {
      message.error('Word 导出失败');
    }
  };

  const handleExportMd = async () => {
    try {
      const blob = await releaseApi.exportMd(release.id);
      downloadBlob(blob, `${release.version}_发布单.md`);
      message.success('Markdown 导出成功');
    } catch {
      message.error('Markdown 导出失败');
    }
  };

  if (!hasDoc) {
    return (
      <div className="py-8 text-center">
        <p className="text-[13px] text-slate-400">尚未生成发布说明</p>
        <Button
          type="primary"
          className="mt-3"
          loading={generateMutation.isPending}
          onClick={() => generateMutation.mutate()}
        >
          生成发布说明
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-indigo-100 bg-slate-50/50 p-4">
        {rows.length > 0 ? (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-indigo-100">
                <th className="w-[140px] py-2 pr-3 text-left text-[12px] font-medium text-slate-400">项目</th>
                <th className="py-2 text-left text-[12px] font-medium text-slate-400">内容</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-3 text-[12px] font-medium text-slate-500 align-top">{row.key}</td>
                  <td className="py-2 text-[13px] text-slate-700">
                    {row.value.split('<br>').map((line, lineIdx) => (
                      <div key={lineIdx}>{line}</div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <pre className="whitespace-pre-wrap font-mono text-[12px] text-slate-600">{mdContent}</pre>
        )}
      </div>

      {/* 操作 */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-50"
        >
          重新生成
        </button>
        <button
          type="button"
          onClick={handleExportPdf}
          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
        >
          <FileDown className="h-3.5 w-3.5" strokeWidth={1.5} />
          导出 PDF
        </button>
        <button
          type="button"
          onClick={handleExportWord}
          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
        >
          <FileText className="h-3.5 w-3.5" strokeWidth={1.5} />
          导出 Word
        </button>
        <button
          type="button"
          onClick={handleExportMd}
          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
        >
          <FileCode className="h-3.5 w-3.5" strokeWidth={1.5} />
          导出 MD
        </button>
      </div>
    </div>
  );
}
