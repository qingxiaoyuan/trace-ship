import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from 'antd';
import { FileDown, FileText } from 'lucide-react';
import { releaseApi } from '@/api/release';
import { useAppMessage } from '@/hooks/useAppMessage';
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

/** A 类/F 类更新条目分组渲染 */
function UpdatesSection({ updates }: { updates: { type?: string; content?: string }[] }) {
  if (!updates.length) return null;
  // 按 type 分组
  const groups: Record<string, string[]> = {};
  updates.forEach((u) => {
    const key = u.type || '其他';
    if (!groups[key]) groups[key] = [];
    if (u.content) groups[key].push(u.content);
  });

  const groupLabel: Record<string, string> = {
    A: '变更内容',
    F: '修复内容',
  };

  return (
    <div className="space-y-3">
      {Object.entries(groups).map(([type, items]) => (
        <div key={type}>
          <div className="mb-1 text-[12px] font-medium text-indigo-700">{groupLabel[type] || type}</div>
          <ul className="space-y-1 pl-3">
            {items.map((item, idx) => (
              <li key={idx} className="text-[12px] leading-relaxed text-slate-600">
                · {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** 发布说明 Tab：渲染结构化 release_doc + 导出 */
export function ReleaseNotes({ release }: ReleaseNotesProps) {
  const queryClient = useQueryClient();
  const { message } = useAppMessage();

  const doc = (release.release_doc || {}) as Record<string, unknown>;
  const hasDoc = release.release_doc && Object.keys(doc).length > 0;

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

  const updates = (doc.updates as { type?: string; content?: string }[]) || [];
  const configChanges = (doc.config_changes as Record<string, Record<string, string>>) || {};
  const relatedChanges = (doc.related_changes as Record<string, string>) || {};

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-indigo-100 bg-slate-50/50 p-4">
        {/* 变更类型 */}
        <div className="mb-3 flex items-center gap-2 text-[12px] text-slate-500">
          <span>变更类型：</span>
          <span className="font-medium text-slate-700">{(doc.change_type as string) || '-'}</span>
          {doc.test_status ? (
            <>
              <span className="ml-3">测试状态：</span>
              <span className="font-medium text-emerald-600">{doc.test_status as string}</span>
            </>
          ) : null}
        </div>

        {/* 更新条目 */}
        <UpdatesSection updates={updates} />

        {/* 配置变更 */}
        {Object.keys(configChanges).length > 0 ? (
          <div className="mt-4 border-t border-indigo-100 pt-3">
            <div className="mb-1 text-[12px] font-medium text-indigo-700">配置变更</div>
            <div className="space-y-1 pl-3 text-[12px] text-slate-600">
              {Object.entries(configChanges).map(([section, kv]) =>
                Object.entries(kv).map(([k, v]) => (
                  <div key={`${section}-${k}`}>
                    · {section} / {k}: {v}
                  </div>
                )),
              )}
            </div>
          </div>
        ) : null}

        {/* 关联变更 */}
        {Object.keys(relatedChanges).length > 0 ? (
          <div className="mt-4 border-t border-indigo-100 pt-3">
            <div className="mb-1 text-[12px] font-medium text-indigo-700">关联变更</div>
            <div className="space-y-1 pl-3 text-[12px] text-slate-600">
              {Object.entries(relatedChanges).map(([k, v]) => (
                <div key={k}>
                  · {k}: {v}
                </div>
              ))}
            </div>
          </div>
        ) : null}
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
      </div>
    </div>
  );
}
