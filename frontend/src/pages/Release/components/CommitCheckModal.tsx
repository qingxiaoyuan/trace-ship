import { useState } from 'react';
import { Modal } from 'antd';
import {
  AlertTriangle,
  CheckCircle2,
  GitCommitHorizontal,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { repositoryApi } from '@/api/repository';
import type { ReviewRangeResult } from '@/types';

interface CheckRow {
  hash: string;
  author: string;
  message: string;
  reviewReason: string;
  type: string;
  content: string;
}

interface CommitCheckModalProps {
  repoId: string;
  lastTag: string | null;
  open: boolean;
  onClose: () => void;
  onAddUpdates: (items: { type: string; content: string; source: 'commit'; source_ref: string }[]) => void;
}

/** 提取 commit message 的第一行作为标题 */
function firstLine(message: string): string {
  return message.split('\n').find((l) => l.trim())?.trim() || message.slice(0, 80);
}

export function CommitCheckModal({ repoId, lastTag, open, onClose, onAddUpdates }: CommitCheckModalProps) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<CheckRow[]>([]);
  const [stats, setStats] = useState<{ total: number; nonCompliant: number } | null>(null);

  const doFetch = async () => {
    if (!repoId) return;
    setLoading(true);
    setRows([]);
    setStats(null);
    try {
      const result: ReviewRangeResult = await repositoryApi.reviewRange(
        repoId,
        lastTag || undefined,
        undefined,
      );
      const nonCompliant = result.commits.filter(
        (c) => c.review_status === 'warning' || c.review_status === 'illegal',
      );
      setRows(
        nonCompliant.map((c) => ({
          hash: c.hash || '',
          author: c.author,
          message: c.message,
          reviewReason: c.review_reason,
          type: 'A',
          content: firstLine(c.message),
        })),
      );
      setStats({ total: result.commits.length, nonCompliant: nonCompliant.length });
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  // 打开时自动检测
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen && repoId) {
      doFetch();
    } else if (!isOpen) {
      // 关闭时不清空数据，避免闪烁
    }
  };

  const updateRow = (idx: number, patch: Partial<CheckRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const removeRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleAddUpdates = () => {
    const items = rows
      .filter((r) => r.content.trim())
      .map((r) => ({
        type: r.type,
        content: r.content.trim(),
        source: 'commit' as const,
        source_ref: r.hash.slice(0, 8),
      }));
    if (items.length === 0) return;
    onAddUpdates(items);
    setRows([]);
    setStats(null);
    onClose();
  };

  const validCount = rows.filter((r) => r.content.trim()).length;

  return (
    <Modal
      open={open}
      title="检测不合规 Commit"
      width={820}
      onCancel={onClose}
      afterOpenChange={handleOpenChange}
      destroyOnHidden
      footer={
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-slate-400">
            {rows.length > 0
              ? `已编辑 ${validCount} 条可加入更新内容`
              : '自动检测上一个 Tag 到分支 HEAD 之间的不合规 commit'}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
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
        <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2">
          <div className="flex items-center gap-2 text-[12px] text-slate-500">
            <GitCommitHorizontal className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />
            <span>
              区间：<span className="font-mono text-slate-600">{lastTag || '最新 Tag'}</span>
              {' -> '}
              <span className="font-mono text-slate-600">HEAD</span>
            </span>
            {stats && (
              <>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span>共 {stats.total} 条</span>
                <span className="text-rose-500">不合规 {stats.nonCompliant} 条</span>
              </>
            )}
          </div>
          <button
            onClick={doFetch}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.5} />
            重新检测
          </button>
        </div>

        {/* 加载中 */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-7 w-7 animate-spin text-indigo-500" strokeWidth={1.5} />
            <p className="mt-3 text-[13px] text-slate-500">正在拉取并审查 commit…</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <CheckCircle2 className="h-8 w-8 text-emerald-400" strokeWidth={1.5} />
            <p className="mt-3 text-[13px] text-slate-500">无不合规 commit，全部已通过</p>
          </div>
        ) : (
          /* 表格 */
          <div className="overflow-hidden rounded-lg border border-slate-200">
            {/* 表头 */}
            <div className="grid grid-cols-[56px_1fr_36px] gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-500">
              <span>类型</span>
              <span>更新内容（可编辑，默认取 commit 标题）</span>
              <span />
            </div>
            {/* 数据行 */}
            <div className="max-h-[380px] divide-y divide-slate-100 overflow-y-auto">
              {rows.map((row, idx) => (
                <div key={`${row.hash}-${idx}`} className="px-3 py-2">
                  <div className="grid grid-cols-[56px_1fr_36px] items-center gap-2">
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
                      className="rounded-md p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500"
                      title="删除此行"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  </div>
                  {/* 元信息 */}
                  <div className="mt-1 flex items-center gap-2 pl-[64px] text-[10px] text-slate-400">
                    <span className="font-mono">{row.hash.slice(0, 8)}</span>
                    <span>{row.author}</span>
                    {row.reviewReason && (
                      <span className="flex items-center gap-0.5 text-amber-500">
                        <AlertTriangle className="h-2.5 w-2.5" strokeWidth={1.5} />
                        {row.reviewReason}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
