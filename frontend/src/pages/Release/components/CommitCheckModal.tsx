import { useCallback, useMemo, useState } from 'react';
import { Checkbox, Modal } from 'antd';
import {
  CheckCircle2,
  GitCommitHorizontal,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useAppMessage } from '@/hooks/useAppMessage';
import type { ParsedUpdate, PreviewCommit } from '@/types';

interface CheckRow {
  hash: string;
  author: string;
  type: string;
  content: string;
  /** 打开弹窗时的原始内容，用于识别「已编辑但未勾选」的行 */
  initialContent: string;
  checked: boolean;
}

/** 已解析但超出自动填入上限的待勾选条目 */
interface PendingRow {
  type: string;
  content: string;
  source: 'commit' | 'mr';
  sourceRef: string;
  checked: boolean;
}

interface CommitCheckModalProps {
  lastTag: string | null;
  branch: string;
  commits: PreviewCommit[];
  /** 已解析但因超出自动填入上限未填入的条目（勾选后添加） */
  pendingUpdates?: ParsedUpdate[];
  /** 已加入更新内容的条目引用（`source:source_ref`），用于过滤已填入的未解析 Commit */
  existingRefs?: string[];
  /** 已加入更新内容的条目内容（`type:content`），用于过滤已填入的已解析条目（与 onAddUpdates 去重语义一致） */
  existingContents?: string[];
  open: boolean;
  onClose: () => void;
  onAddUpdates: (items: { type: string; content: string; source: 'commit' | 'mr'; source_ref: string }[]) => void;
}

/** 提取 commit message 的第一行作为标题 */
function firstLine(message: string): string {
  return message.split('\n').find((l) => l.trim())?.trim() || message.slice(0, 80);
}

function buildRows(commits: PreviewCommit[], existingRefs: Set<string>): CheckRow[] {
  return commits
    .filter((commit) => !commit.has_af)
    .filter((commit) => !existingRefs.has(`commit:${commit.hash.slice(0, 8)}`))
    .map((commit) => {
      const content = firstLine(commit.message);
      return {
        hash: commit.hash,
        author: commit.author,
        type: 'A',
        content,
        initialContent: content,
        checked: false,
      };
    });
}

function buildPendingRows(pendingUpdates: ParsedUpdate[], existingContents: Set<string>): PendingRow[] {
  return pendingUpdates
    .filter((u) => !existingContents.has(`${u.type || 'A'}:${(u.content || '').trim()}`))
    .map((u) => ({
      type: u.type || 'A',
      content: u.content || '',
      source: u.source || 'commit',
      sourceRef: u.source_ref || '',
      checked: false,
    }));
}

export function CommitCheckModal({
  lastTag,
  branch,
  commits,
  pendingUpdates = [],
  existingRefs = [],
  existingContents = [],
  open,
  onClose,
  onAddUpdates,
}: CommitCheckModalProps) {
  const { modal } = useAppMessage();
  const existingRefsSet = useMemo(() => new Set(existingRefs), [existingRefs]);
  const existingContentsSet = useMemo(() => new Set(existingContents), [existingContents]);
  const [rows, setRows] = useState<CheckRow[]>(() => buildRows(commits, existingRefsSet));
  const [pendingRows, setPendingRows] = useState<PendingRow[]>(() => buildPendingRows(pendingUpdates, existingContentsSet));
  const unparsedCommits = useMemo(() => commits.filter((commit) => !commit.has_af), [commits]);

  const resetRows = useCallback(() => {
    setRows(buildRows(commits, existingRefsSet));
    setPendingRows(buildPendingRows(pendingUpdates, existingContentsSet));
  }, [commits, pendingUpdates, existingRefsSet, existingContentsSet]);

  const updatePendingRow = (idx: number, patch: Partial<PendingRow>) => {
    setPendingRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const updateRow = (idx: number, patch: Partial<CheckRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const removeRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleAddUpdates = () => {
    const pendingItems = pendingRows
      .filter((r) => r.checked && r.content.trim())
      .map((r) => ({
        type: r.type,
        content: r.content.trim(),
        source: r.source,
        source_ref: r.sourceRef,
      }));
    const editedItems = rows
      .filter((r) => r.checked && r.content.trim())
      .map((r) => ({
        type: r.type,
        content: r.content.trim(),
        source: 'commit' as const,
        source_ref: r.hash.slice(0, 8),
      }));
    const items = [...pendingItems, ...editedItems];
    if (items.length === 0) return;
    onAddUpdates(items);
    onClose();
  };

  const selectedPendingCount = pendingRows.filter((r) => r.checked && r.content.trim()).length;
  const selectedEditedCount = rows.filter((r) => r.checked && r.content.trim()).length;
  const validCount = selectedPendingCount + selectedEditedCount;

  // 已编辑但未勾选的行：关闭时提示避免误丢修改
  const editedUnchecked = rows.filter(
    (r) => !r.checked && r.content.trim() && r.content !== r.initialContent
  );

  const handleCancel = () => {
    if (editedUnchecked.length > 0) {
      modal.confirm({
        title: '有未勾选但已编辑的 Commit',
        content: `${editedUnchecked.length} 条未勾选的 Commit 修改将在关闭后丢弃，是否继续？`,
        okText: '确认关闭',
        cancelText: '继续编辑',
        onOk: onClose,
      });
      return;
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      title="检测 Commit 与待选变更"
      width={820}
      onCancel={handleCancel}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12px] text-slate-400">
            {validCount > 0
              ? `已勾选 ${validCount} 条可加入更新内容`
              : '请勾选需要加入的变更条目'}
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleCancel}
              className="rounded-lg border border-slate-200 px-4 py-1.5 text-[13px] font-medium text-slate-600 hover:bg-slate-50"
            >
              取消
            </button>
            <button
              onClick={handleAddUpdates}
              disabled={validCount === 0}
              className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              加入更新内容
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {/* 区间信息 + 重新检测 */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
            <GitCommitHorizontal className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />
            <span>
              区间：<span className="font-mono text-slate-600">{lastTag || '最新 Tag'}</span>
              {' -> '}
              <span className="font-mono text-slate-600">{branch || 'HEAD'}</span>
            </span>
            <span className="h-1 w-1 rounded-full bg-slate-300" />
            <span>共 {commits.length} 条</span>
            <span className="text-amber-600">未自动解析 {unparsedCommits.length} 条</span>
          </div>
          <button
            onClick={resetRows}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-50"
          >
            <RefreshCw className="h-3 w-3" strokeWidth={1.5} />
            重置候选
          </button>
        </div>

        {/* 已解析但超出自动填入上限的条目：勾选后加入 */}
        {pendingRows.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[12px] font-medium text-slate-600">
                <span>已解析未自动填入</span>
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600 border border-indigo-200 max-md:text-xs">
                  {pendingRows.length} 条
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPendingRows((prev) => prev.map((r) => ({ ...r, checked: true })))}
                  className="rounded-md border border-indigo-100 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500 hover:border-indigo-200 hover:text-indigo-600"
                >
                  全选
                </button>
                <button
                  onClick={() => setPendingRows((prev) => prev.map((r) => ({ ...r, checked: false })))}
                  className="rounded-md border border-indigo-100 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500 hover:border-indigo-200 hover:text-indigo-600"
                >
                  清空勾选
                </button>
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <div className="max-h-[260px] divide-y divide-slate-100 overflow-y-auto">
                {pendingRows.map((row, idx) => (
                  <div key={`${row.source}-${row.sourceRef}-${idx}`} className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={row.checked}
                        onChange={(e) => updatePendingRow(idx, { checked: e.target.checked })}
                      />
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold max-md:text-xs ${
                          row.type === 'A'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {row.type}
                      </span>
                      <input
                        value={row.content}
                        onChange={(e) => updatePendingRow(idx, { content: e.target.value })}
                        className="input-field min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-[12px] text-slate-700 outline-none focus:border-indigo-200 focus:bg-white"
                      />
                    </div>
                    <div className="mt-1 flex items-center gap-2 pl-[30px] text-[10px] text-slate-400 max-md:text-xs">
                      <span className="font-mono">
                        {row.source === 'mr' ? `MR !${row.sourceRef}` : row.sourceRef || '-'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {rows.length === 0 && pendingRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <CheckCircle2 className="h-8 w-8 text-emerald-400" strokeWidth={1.5} />
            <p className="mt-3 text-[13px] text-slate-500">没有需要人工录入或勾选的变更</p>
          </div>
        ) : (
          /* 未自动解析 Commit 编辑区 */
          rows.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[12px] font-medium text-slate-600">
                  <span>未自动解析 Commit（勾选后加入）</span>
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600 border border-amber-200 max-md:text-xs">
                    {rows.length} 条
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setRows((prev) => prev.map((r) => ({ ...r, checked: true })))}
                    className="rounded-md border border-amber-100 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500 hover:border-amber-200 hover:text-amber-600"
                  >
                    全选
                  </button>
                  <button
                    onClick={() => setRows((prev) => prev.map((r) => ({ ...r, checked: false })))}
                    className="rounded-md border border-amber-100 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500 hover:border-amber-200 hover:text-amber-600"
                  >
                    清空勾选
                  </button>
                </div>
              </div>
              <div className="overflow-hidden rounded-lg border border-slate-200">
            {/* 表头 */}
            <div className="grid grid-cols-[32px_56px_1fr_36px] gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-500">
              <span />
              <span>类型</span>
              <span>更新内容（可编辑，默认取 commit 标题）</span>
              <span />
            </div>
            {/* 数据行 */}
            <div className="max-h-[380px] divide-y divide-slate-100 overflow-y-auto">
              {rows.map((row, idx) => (
                <div key={`${row.hash}-${idx}`} className="px-3 py-2">
                  <div className="grid grid-cols-[32px_56px_1fr_36px] items-center gap-2">
                    {/* 勾选 */}
                    <Checkbox
                      checked={row.checked}
                      onChange={(e) => updateRow(idx, { checked: e.target.checked })}
                    />
                    {/* 类型选择 */}
                    <select
                      value={row.type}
                      onChange={(e) => updateRow(idx, { type: e.target.value })}
                      className={`rounded-md border bg-white px-2 py-1.5 text-[11px] font-mono font-medium outline-none ${
                        row.type === 'A'
                          ? 'border-emerald-200 text-emerald-700'
                          : 'border-amber-200 text-amber-700'
                      }`}
                    >
                      <option value="A">A</option>
                      <option value="F">F</option>
                    </select>
                    {/* 可编辑内容 */}
                    <input
                      value={row.content}
                      onChange={(e) => updateRow(idx, { content: e.target.value })}
                      placeholder="变更内容描述（A=新增功能，F=修复问题）"
                      className="input-field w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[12px] text-slate-700 outline-none focus:border-indigo-200 focus:bg-white"
                    />
                    {/* 删除 */}
                    <button
                      onClick={() => removeRow(idx)}
                      className="rounded-md p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500 max-md:p-2.5"
                      title="删除此行"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  </div>
                  {/* 元信息 */}
                  <div className="mt-1 flex items-center gap-2 pl-[30px] text-[10px] text-slate-400 max-md:text-xs sm:pl-[112px]">
                    <span className="font-mono">{row.hash.slice(0, 8)}</span>
                    <span>{row.author}</span>
                  </div>
                </div>
              ))}
              </div>
            </div>
            </div>
          ) : null
        )}
      </div>
    </Modal>
  );
}
