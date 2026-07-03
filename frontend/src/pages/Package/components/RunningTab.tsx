import { memo, useCallback, useState } from 'react';
import { ExternalLink, Hammer } from 'lucide-react';
import type { PackageTask } from '@/types';
import { ProgressBar, UserAvatar } from './Shared';
import { formatDuration, isRunning, stageLabels, statusMeta } from './utils';

interface RunningTabProps {
  tasks: PackageTask[];
  onOpen: (task: PackageTask) => void;
}

export const RunningTab = memo(function RunningTab({ tasks, onOpen }: RunningTabProps) {
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
          <RunningRow key={task.id} task={task} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
});

interface RunningRowProps {
  task: PackageTask;
  onOpen: (task: PackageTask) => void;
}

const RunningRow = memo(function RunningRow({ task, onOpen }: RunningRowProps) {
  const running = isRunning(task.status);
  const [label] = useState(() => {
    if (!running) {
      return statusMeta[task.status]?.label || task.status;
    }
    const s = (task.stage_info as { stage?: string } | undefined)?.stage;
    return s ? (stageLabels[s] || s) : '打包中';
  });
  const meta = statusMeta[task.status];

  const handleClick = useCallback(() => {
    onOpen(task);
  }, [onOpen, task]);

  return (
    <div
      className="group grid grid-cols-12 gap-3 items-center px-5 py-3 hover:bg-indigo-50/30 cursor-pointer"
      onClick={handleClick}
    >
      <div className="col-span-12 md:col-span-4 flex items-center gap-2.5">
        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot} ${running ? 'pulse-dot' : ''} shrink-0`} />
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-slate-900 truncate">{task.name}</div>
          <div className="font-mono text-[10px] text-slate-400 truncate">{task.version} · {task.repository_name || '-'}</div>
        </div>
      </div>
      <div className="col-span-6 md:col-span-2">
        <span className={`inline-flex items-center gap-1.5 rounded-md border ${meta.border} ${meta.bg} px-1.5 py-0.5 text-[11px] font-medium ${meta.text}`}>
          <Hammer className="h-3 w-3" strokeWidth={1.5} />
          {label}
        </span>
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
      <div className="col-span-6 md:col-span-1 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
        <ExternalLink className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />
      </div>
    </div>
  );
});
