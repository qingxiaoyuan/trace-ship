import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal } from 'antd';
import { FileDown, FileText, FileCode, Pencil } from 'lucide-react';
import { releaseApi } from '@/api/release';
import { projectApi } from '@/api/project';
import { useAppMessage } from '@/hooks/useAppMessage';
import { useProjectRole } from '@/hooks/useProjectRole';
import { parseMdTable, buildMdTable } from '@/utils/markdownTable';
import { isCheckboxField, applyCheckboxChange, type MdTableRow } from './releaseDocUtils';
import { CheckboxField, AutoResizeTextarea } from './ReleaseDocField';
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
  const [editOpen, setEditOpen] = useState(false);
  const [docRows, setDocRows] = useState<MdTableRow[]>([]);
  const [editContent, setEditContent] = useState('');
  const [docSaved, setDocSaved] = useState(true);
  const [tableEditMode, setTableEditMode] = useState(true);

  const mdContent = release.release_doc || '';
  const hasDoc = !!mdContent.trim();
  const rows = parseMdTable(mdContent);

  // 生成/修改发布说明需 developer 及以上项目角色
  const { data: project } = useQuery({
    queryKey: ['project', release.project_id],
    queryFn: () => projectApi.getProject(release.project_id),
    enabled: !!release.project_id,
  });
  const { canDevelop } = useProjectRole(project);

  const generateMutation = useMutation({
    mutationFn: () => releaseApi.generateDoc(release.id),
    onSuccess: () => {
      message.success('发布说明已生成');
      queryClient.invalidateQueries({ queryKey: ['release', release.id] });
    },
  });

  const updateDocMutation = useMutation({
    mutationFn: (doc: string) => releaseApi.updateDoc(release.id, doc),
    onSuccess: () => {
      message.success('文档已保存');
      queryClient.invalidateQueries({ queryKey: ['release', release.id] });
      setDocSaved(true);
      setEditOpen(false);
    },
  });

  const openEdit = () => {
    const parsed = parseMdTable(mdContent);
    setDocRows(parsed);
    setEditContent(mdContent);
    setTableEditMode(parsed.length > 0);
    setDocSaved(true);
    setEditOpen(true);
  };

  const handleRowChange = (idx: number, value: string) => {
    setDocRows((prev) => prev.map((r, i) => (i === idx ? { ...r, value } : r)));
    setDocSaved(false);
  };

  const handleCheckboxChange = (idx: number, value: string) => {
    setDocRows((prev) => applyCheckboxChange(prev, idx, value));
    setDocSaved(false);
  };

  const handleSaveDoc = () => {
    updateDocMutation.mutate(tableEditMode ? buildMdTable(docRows) : editContent);
  };

  const handleCloseEdit = () => {
    if (!docSaved) {
      const ok = window.confirm('有未保存的修改，确定要放弃吗？');
      if (!ok) return;
    }
    setEditOpen(false);
  };

  const handleExportPdf = async () => {
    try {
      const blob = await releaseApi.exportPdf(release.id);
      downloadBlob(blob, `${release.version}_发布单.pdf`);
      message.success('PDF 导出成功');
    } catch {
      // 导出失败由全局拦截器统一提示
    }
  };

  const handleExportWord = async () => {
    try {
      const blob = await releaseApi.exportWord(release.id);
      downloadBlob(blob, `${release.version}_发布单.docx`);
      message.success('Word 导出成功');
    } catch {
      // 导出失败由全局拦截器统一提示
    }
  };

  const handleExportMd = async () => {
    try {
      const blob = await releaseApi.exportMd(release.id);
      downloadBlob(blob, `${release.version}_发布单.md`);
      message.success('Markdown 导出成功');
    } catch {
      // 导出失败由全局拦截器统一提示
    }
  };

  if (!hasDoc) {
    return (
      <div className="py-8 text-center">
        <p className="text-[13px] text-slate-400">尚未生成发布说明</p>
        {canDevelop ? (
          <div className="mt-3 flex items-center justify-center gap-2">
            <Button
              type="primary"
              loading={generateMutation.isPending}
              onClick={() => generateMutation.mutate()}
            >
              生成发布说明
            </Button>
            <Button icon={<Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />} onClick={openEdit}>
              修改文档
            </Button>
          </div>
        ) : (
          <p className="mt-3 text-[12px] text-slate-400">仅项目开发或管理员可生成发布说明</p>
        )}
        <Modal
          title="修改发布说明"
          open={editOpen}
          onCancel={handleCloseEdit}
          onOk={handleSaveDoc}
          confirmLoading={updateDocMutation.isPending}
          width={720}
          destroyOnHidden
        >
          {tableEditMode ? (
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full border-collapse">
                <tbody>
                  {docRows.map((row, idx) => (
                    <tr key={idx} className="border-b border-slate-100 last:border-0">
                      <td className="w-[160px] shrink-0 bg-slate-50/60 px-4 py-2 align-middle text-[12px] font-medium leading-[1.375] text-slate-500">
                        {row.key}
                      </td>
                      <td className="px-3 py-2 align-middle">
                        {isCheckboxField(row.key) ? (
                          <CheckboxField
                            value={row.value}
                            fieldKey={row.key}
                            onChange={(value) => handleCheckboxChange(idx, value)}
                          />
                        ) : (
                          <AutoResizeTextarea
                            value={row.value}
                            onChange={(value) => handleRowChange(idx, value)}
                            className="block w-full resize-none bg-transparent border-0 p-0 text-[13px] leading-[1.375] text-slate-700 outline-none focus:bg-white"
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Input.TextArea
              value={editContent}
              onChange={(e) => {
                setEditContent(e.target.value);
                setDocSaved(false);
              }}
              rows={20}
              placeholder="请输入 Markdown 格式的发布说明"
              className="font-mono text-[13px]"
            />
          )}
          {tableEditMode && (
            <p className="mt-2 text-[11px] text-slate-400">
              左列标题只读，右列内容可编辑；保存后将序列化为 Markdown 表格
            </p>
          )}
        </Modal>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-slate-200">
        {rows.length > 0 ? (
          <table className="w-full border-collapse">
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx} className="border-b border-slate-100 last:border-0">
                  <td className="w-[160px] shrink-0 bg-slate-50/60 px-4 py-2 align-top text-[12px] font-medium text-slate-500">
                    {row.key}
                  </td>
                  <td className="px-3 py-2 text-[13px] text-slate-700">
                    {isCheckboxField(row.key) ? (
                      <CheckboxField value={row.value} fieldKey={row.key} disabled />
                    ) : (
                      row.value.split('<br>').map((line, lineIdx) => (
                        <div key={lineIdx}>{line}</div>
                      ))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <pre className="whitespace-pre-wrap p-4 font-mono text-[13px] text-slate-700">{mdContent}</pre>
        )}
      </div>

      {/* 操作 */}
      <div className="flex items-center gap-2">
        {canDevelop && (
          <button
            type="button"
            onClick={openEdit}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
            修改文档
          </button>
        )}
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

      <Modal
        title="修改发布说明"
        open={editOpen}
        onCancel={handleCloseEdit}
        onOk={handleSaveDoc}
        confirmLoading={updateDocMutation.isPending}
        width={720}
        destroyOnHidden
      >
        {tableEditMode ? (
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full border-collapse">
              <tbody>
                {docRows.map((row, idx) => (
                  <tr key={idx} className="border-b border-slate-100 last:border-0">
                    <td className="w-[160px] shrink-0 bg-slate-50/60 px-4 py-2 align-middle text-[12px] font-medium leading-[1.375] text-slate-500">
                      {row.key}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      {isCheckboxField(row.key) ? (
                        <CheckboxField
                          value={row.value}
                          fieldKey={row.key}
                          onChange={(value) => handleCheckboxChange(idx, value)}
                        />
                      ) : (
                        <AutoResizeTextarea
                          value={row.value}
                          onChange={(value) => handleRowChange(idx, value)}
                          className="block w-full resize-none bg-transparent border-0 p-0 text-[13px] leading-[1.375] text-slate-700 outline-none focus:bg-white"
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Input.TextArea
            value={editContent}
            onChange={(e) => {
              setEditContent(e.target.value);
              setDocSaved(false);
            }}
            rows={20}
            placeholder="请输入 Markdown 格式的发布说明"
            className="font-mono text-[13px]"
          />
        )}
        {tableEditMode && (
          <p className="mt-2 text-[11px] text-slate-400">
            左列标题只读，右列内容可编辑；保存后将序列化为 Markdown 表格
          </p>
        )}
      </Modal>
    </div>
  );
}
