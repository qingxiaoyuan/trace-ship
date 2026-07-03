import { memo, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Button } from 'antd';
import { ChevronRight, Loader, Package as PackageIcon, Square, Terminal, Upload } from 'lucide-react';
import dayjs from 'dayjs';
import type { PackageTask } from '@/types';
import { packageApi } from '@/api/package';
import { ArtifactPanel } from './Artifacts';
import { TerminalLog } from './TerminalLog';
import { canPushSvn, formatDuration, isRunning, stageLabels } from './utils';
import { StatusBadge } from './Shared';

interface BuildViewProps {
  task: PackageTask;
  logText: string;
  onBack: () => void;
  onCancel: (task: PackageTask) => void;
}

export const BuildView = memo(function BuildView({ task, logText, onBack, onCancel }: BuildViewProps) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const artifacts = task.artifact_info || [];
  const stageLabel = useMemo(() => {
    const stage = (task.stage_info as { stage?: string } | undefined)?.stage;
    return stage ? (stageLabels[stage] || stage) : '打包中';
  }, [task.stage_info]);
  const running = isRunning(task.status);
  const [pushing, setPushing] = useState(false);

  const pushSvnMutation = useMutation({
    mutationFn: () => packageApi.pushSvn(task.id),
    onSuccess: () => {
      message.success('已推送到 SVN');
      queryClient.invalidateQueries({ queryKey: ['package-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['package-task', task.id] });
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message || '推送 SVN 失败';
      message.error(msg);
    },
    onSettled: () => setPushing(false),
  });

  const handlePushSvn = () => {
    setPushing(true);
    pushSvnMutation.mutate();
  };

  return (
    <div className="space-y-5 page-fade-in">
      <div className="flex items-center gap-2 text-[13px]">
        <button onClick={onBack} className="text-slate-400 hover:text-indigo-600 cursor-pointer">打包看板</button>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" strokeWidth={1.5} />
        <span className="font-medium text-slate-800">{task.version} · {task.name}</span>
      </div>

      <div className="tech-card rounded-xl p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl icon-cyan">
              {running ? <Loader className="h-5 w-5 spin-slow" strokeWidth={1.5} /> : <PackageIcon className="h-5 w-5" strokeWidth={1.5} />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[20px] font-semibold tracking-tight text-slate-900">{task.version}</h1>
                <StatusBadge status={task.status} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
                <span className="font-mono">{task.name}</span>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span className="font-mono">{task.tag_name}</span>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span>{task.triggered_by_name || '-'}</span>
                {task.started_at && (
                  <>
                    <span className="h-1 w-1 rounded-full bg-slate-300" />
                    <span>{dayjs(task.started_at).format('YYYY-MM-DD HH:mm')}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          {running && (
            <Button danger icon={<Square className="h-3.5 w-3.5" strokeWidth={1.5} />} onClick={() => onCancel(task)}>
              停止构建
            </Button>
          )}
        </div>
        {running && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-[12px] text-slate-500 mb-1.5">
              <span>{stageLabel} · {task.progress || 0}%</span>
              <span className="font-mono text-cyan-600">{formatDuration(task.duration)}</span>
            </div>
            <div className="h-2 w-full rounded-full bg-indigo-50 overflow-hidden">
              <div className="h-full rounded-full stage-line" style={{ width: `${task.progress || 0}%` }} />
            </div>
          </div>
        )}
        {task.error_message && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] text-rose-700">
            {task.error_message}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3 tech-card rounded-xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between border-b border-indigo-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-indigo-400" strokeWidth={1.5} />
              <h3 className="text-[13px] font-semibold tracking-tight text-slate-900">构建日志</h3>
            </div>
          </div>
          <TerminalLog text={logText} />
        </div>

        <div className="lg:col-span-2 tech-card rounded-xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between border-b border-indigo-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <PackageIcon className="h-4 w-4 text-indigo-400" strokeWidth={1.5} />
              <h3 className="text-[13px] font-semibold tracking-tight text-slate-900">打包产物</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400">{artifacts.length} 个</span>
              {canPushSvn(task) && (
                <Button
                  size="small"
                  icon={<Upload className="h-3 w-3" strokeWidth={1.5} />}
                  loading={pushing}
                  onClick={handlePushSvn}
                >
                  推送 SVN
                </Button>
              )}
            </div>
          </div>
          <ArtifactPanel artifacts={artifacts} taskId={task.id} />
        </div>
      </div>
    </div>
  );
});
