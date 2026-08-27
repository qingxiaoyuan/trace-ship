import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from 'antd';
import { ArrowRight, Check, ClipboardCheck, X } from 'lucide-react';
import { workflowApi } from '@/api/workflow';
import { useAppMessage } from '@/hooks/useAppMessage';
import type { TodoFilter, TodoItem } from '../types';

/** 我的待办列表面板：审批待办带通过/驳回快捷操作，打包待办跳打包看板 */
export function TodoPanel({
  items,
  total,
  filter,
  onFilterChange,
}: {
  items: TodoItem[];
  /** 未过滤的待办总数（角标展示） */
  total: number;
  filter: TodoFilter;
  onFilterChange: (filter: TodoFilter) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = useAppMessage();
  const [rejectTarget, setRejectTarget] = useState<TodoItem | null>(null);
  const [rejectComment, setRejectComment] = useState('');

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['workflow-todo'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-overview'] });
  };

  const approveMutation = useMutation({
    mutationFn: (taskId: string) => workflowApi.approveTask(taskId, {}),
    onSuccess: () => {
      message.success('审批通过');
      invalidate();
    },
    onError: () => message.error('操作失败，请稍后重试'),
  });
  const rejectMutation = useMutation({
    mutationFn: (vars: { taskId: string; comment: string }) =>
      workflowApi.rejectTask(vars.taskId, { comment: vars.comment }),
    onSuccess: () => {
      message.success('已驳回');
      setRejectTarget(null);
      setRejectComment('');
      invalidate();
    },
    onError: () => message.error('操作失败，请稍后重试'),
  });

  const renderActions = (item: TodoItem) => {
    if (item.kind === 'audit') {
      return (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setRejectComment('');
              setRejectTarget(item);
            }}
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-600 transition-colors hover:border-rose-300 hover:text-rose-500"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.5} />
            驳回
          </button>
          <button
            type="button"
            disabled={approveMutation.isPending}
            onClick={(e) => {
              e.stopPropagation();
              if (item.taskId) approveMutation.mutate(item.taskId);
            }}
            className="btn-glow inline-flex h-9 items-center gap-1 rounded-lg px-3 text-[12px] font-medium text-white disabled:opacity-60"
          >
            <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
            通过
          </button>
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          navigate(item.to);
        }}
        className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-600 transition-colors hover:border-indigo-300 hover:text-indigo-600"
      >
        {item.kind === 'build-failure' ? '查看日志' : '查看进度'}
        <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
    );
  };

  return (
    <div className="tech-card rounded-xl lg:col-span-2">
      <div className="flex items-center justify-between border-b border-indigo-50 px-5 py-4">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">我的待办</h2>
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-indigo-600">
            {total}
          </span>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-indigo-100 bg-indigo-50/40 p-0.5">
          {([
            { key: 'all', label: '全部' },
            { key: 'audit', label: '审批' },
            { key: 'build', label: '打包' },
          ] as const).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => onFilterChange(opt.key)}
              className={
                filter === opt.key
                  ? 'rounded-md bg-white px-2.5 py-1 text-[12px] font-medium text-indigo-600 shadow-sm'
                  : 'rounded-md px-2.5 py-1 text-[12px] font-medium text-slate-500 transition-colors hover:text-slate-700'
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="divide-y divide-indigo-50/50">
        {items.length > 0 ? (
          items.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.key}
                role="button"
                tabIndex={0}
                onClick={() => navigate(item.to)}
                onKeyDown={(e) => {
                  // 内部按钮（通过/驳回/查看日志）的按键不触发行跳转
                  if (e.target !== e.currentTarget) return;
                  if (e.key === ' ') e.preventDefault();
                  if (e.key === 'Enter' || e.key === ' ') navigate(item.to);
                }}
                className="group flex cursor-pointer items-center gap-3 px-5 py-3.5 transition-colors hover:bg-indigo-50/30 max-lg:flex-wrap"
              >
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${item.iconClass}`}>
                  <Icon className="h-4 w-4" strokeWidth={1.5} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-slate-800 group-hover:text-indigo-700">
                      {item.title}
                    </span>
                    {item.badge ? (
                      <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium max-lg:text-xs ${item.badgeClass || 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                        {item.badge}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-slate-400">{item.meta}</div>
                </div>
                <div className="shrink-0 max-lg:flex max-lg:w-full max-lg:justify-end">{renderActions(item)}</div>
              </div>
            );
          })
        ) : (
          <div className="flex flex-col items-center gap-2 px-5 py-10 text-slate-400">
            <ClipboardCheck className="h-8 w-8 text-slate-300" strokeWidth={1.5} />
            <span className="text-[13px]">暂无待办任务，一切井然有序</span>
          </div>
        )}
      </div>

      <Modal
        title="驳回发布"
        open={!!rejectTarget}
        onCancel={() => setRejectTarget(null)}
        onOk={() => {
          if (rejectTarget?.taskId) {
            rejectMutation.mutate({ taskId: rejectTarget.taskId, comment: rejectComment });
          }
        }}
        okText="确认驳回"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: rejectMutation.isPending }}
        destroyOnHidden
      >
        <p className="mb-2 text-[13px] text-slate-500">{rejectTarget?.title}</p>
        <textarea
          value={rejectComment}
          onChange={(e) => setRejectComment(e.target.value)}
          placeholder="请填写驳回原因（可选）"
          rows={3}
          className="w-full resize-none rounded-lg border border-indigo-100 bg-white px-3 py-2.5 text-[13px] text-slate-700 placeholder-slate-400 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
      </Modal>
    </div>
  );
}
