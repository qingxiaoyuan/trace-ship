import { memo, useCallback } from 'react';
import { AlertTriangle, ExternalLink, Hammer, Trash2 } from 'lucide-react';
import type { PackageTask } from '@/types';
import { ProgressBar, UserAvatar } from './Shared';
import { formatDuration, getSvnPushWarning, isRunning, releaseTypeBadge, releaseTypeText, stageLabels, statusMeta, isBranchTask } from './utils';

interface RunningTabProps {
  tasks: PackageTask[];
  onOpen: (task: PackageTask) => void;
  canDelete?: boolean;
  onDelete?: (task: PackageTask) => void;
}

export const RunningTab = memo(function RunningTab({ tasks, onOpen, canDelete, onDelete }: RunningTabProps) {
  if (tasks.length === 0) {
    return (
      <div className="tech-card rounded-xl p-12 text-center">
        <Hammer className="mx-auto h-10 w-10 text-slate-300" strokeWidth={1.5} />
        <p className="mt-3 text-[13px] text-slate-400">暂无打包记录</p>
      </div>
    );
  }
  return (
    <div className="tech-card rounded-xl overflow-hidden">
      <div className="hidden md:grid grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        <div className="col-span-4">任务 / 版本</div>
        <div className="col-span-2">状态</div>
        <div className="col-span-3">进度</div>
        <div className="col-span-2">触发人 · 耗时</div>
        <div className="col-span-1 text-right">操作</div>
      </div>
      <div className="divide-y divide-indigo-50/50">
        {tasks.map((task) => (
          <RunningRow key={task.id} task={task} onOpen={onOpen} canDelete={canDelete} onDelete={onDelete} />
        ))}
      </div>
    </div>
  );
});

interface RunningRowProps {
  task: PackageTask;
  onOpen: (task: PackageTask) => void;
  canDelete?: boolean;
  onDelete?: (task: PackageTask) => void;
}

const FINISHED_STATUSES = new Set(['success', 'failure', 'canceled']);

const RunningRow = memo(function RunningRow({ task, onOpen, canDelete, onDelete }: RunningRowProps) {
  const running = isRunning(task.status);
  const stageInfo = task.stage_info as
    | { stage?: string; running?: number; max_concurrency?: number }
    | undefined;
  const label = (() => {
    // 节点并发占满排队中：展示等待节点与占用情况
    if (task.status === 'queued' && stageInfo?.stage === 'waiting_node') {
      return `等待节点 ${stageInfo.running ?? '-'}/${stageInfo.max_concurrency ?? '-'}`;
    }
    if (!running) {
      return statusMeta[task.status]?.label || task.status;
    }
    const s = stageInfo?.stage;
    return s ? (stageLabels[s] || s) : '打包中';
  })();
  const meta = statusMeta[task.status];
  const svnPushWarning = getSvnPushWarning(task);
  const canDeleteTask = canDelete && FINISHED_STATUSES.has(task.status);

  const handleClick = useCallback(() => {
    onOpen(task);
  }, [onOpen, task]);

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDelete?.(task);
    },
    [onDelete, task],
  );

  return (
    <div
      className="group grid grid-cols-12 gap-3 items-center px-5 py-3 hover:bg-indigo-50/30 cursor-pointer"
      onClick={handleClick}
    >
      <div className="col-span-12 md:col-span-4 flex items-center gap-2.5">
        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot} ${running ? 'pulse-dot' : ''} shrink-0`} />
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-slate-900 truncate">{task.name}</div>
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-slate-400">
            <span className="flex items-center gap-1.5 truncate">
              <span className="truncate">{task.version} · {task.repository_name || '-'}</span>
              {isBranchTask(task) && (
                <span className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-1 py-px text-[9px] font-medium text-emerald-700">分支</span>
              )}
            </span>
            {task.release_type && (
              <span className={`shrink-0 rounded border px-1 py-px text-[9px] font-medium ${releaseTypeBadge[task.release_type] || 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                {releaseTypeText[task.release_type] || task.release_type}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="col-span-6 md:col-span-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`inline-flex items-center gap-1.5 rounded-md border ${meta.border} ${meta.bg} px-1.5 py-0.5 text-[11px] font-medium ${meta.text}`}>
            <Hammer className="h-3 w-3" strokeWidth={1.5} />
            {label}
          </span>
          {svnPushWarning && (
            <span title={svnPushWarning} className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              <AlertTriangle className="h-3 w-3" strokeWidth={1.5} />
              SVN 未上传
            </span>
          )}
        </div>
      </div>
      <div className="col-span-6 md:col-span-3">
        <ProgressBar progress={task.progress || 0} status={task.status} />
      </div>
      <div className="col-span-6 md:col-span-2 flex items-center gap-1.5 text-[11px] text-slate-500">
        <UserAvatar name={task.triggered_by_name} size={16} />
        <span>{task.triggered_by_name || '-'}</span>
        <span className="text-slate-300">·</span>
        <span className="font-mono">{task.started_at ? formatDuration(task.duration) : '-'}</span>
      </div>
      <div className="col-span-6 md:col-span-1 flex items-center justify-end gap-1.5">
        {canDeleteTask ? (
          <button
            onClick={handleDelete}
            title="删除任务"
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        ) : (
          <ExternalLink className="h-3.5 w-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition" strokeWidth={1.5} />
        )}
      </div>
    </div>
  );
});
