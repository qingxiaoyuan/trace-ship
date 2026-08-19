import { memo, useCallback, useState } from 'react';
import type { PackageTask } from '@/types';
import { ArtifactRow } from './Artifacts';
import { formatDuration, formatRelativeTime, getSvnPushWarning, isRunning, stageLabels, isBranchTask } from './utils';
import { ProgressBar, StatusBadge } from './Shared';

interface BuildHistoryProps {
  builds: PackageTask[];
  activeBuildId?: string;
  onSelect: (taskId: string) => void;
  onCancel: (task: PackageTask) => void;
}

export const BuildHistory = memo(function BuildHistory({ builds, activeBuildId, onSelect, onCancel }: BuildHistoryProps) {
  return (
    <div className="lg:col-span-1 tech-card rounded-xl overflow-hidden flex flex-col min-w-0">
      <div className="flex items-center justify-between border-b border-indigo-50 px-3 py-2.5">
        <h3 className="text-[12px] font-semibold tracking-tight text-slate-900">构建历史</h3>
        <span className="text-[10px] text-slate-400 max-md:text-xs">{builds.length}</span>
      </div>
      <div className="divide-y divide-indigo-50/50 overflow-y-auto scrollbar-thin max-md:divide-y-0 max-md:space-y-3 max-md:p-3" style={{ maxHeight: 560 }}>
        {builds.length === 0 ? (
          <div className="px-3 py-8 text-center text-[12px] text-slate-400">暂无构建记录</div>
        ) : (
          builds.map((b) => (
            <BuildHistoryItem
              key={b.id}
              build={b}
              isActive={b.id === activeBuildId}
              onSelect={onSelect}
              onCancel={onCancel}
            />
          ))
        )}
      </div>
    </div>
  );
});

interface BuildHistoryItemProps {
  build: PackageTask;
  isActive: boolean;
  onSelect: (taskId: string) => void;
  onCancel: (task: PackageTask) => void;
}

const BuildHistoryItem = memo(function BuildHistoryItem({ build, isActive, onSelect, onCancel }: BuildHistoryItemProps) {
  const [stageLabel] = useState(() => {
    const stage = (build.stage_info as { stage?: string } | undefined)?.stage;
    return stage ? (stageLabels[stage] || stage) : '';
  });

  const handleClick = useCallback(() => {
    onSelect(build.id);
  }, [build.id, onSelect]);

  const handleCancel = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onCancel(build);
    },
    [build, onCancel]
  );
  const svnPushWarning = getSvnPushWarning(build);

  return (
    <div
      className={`cursor-pointer hover:bg-indigo-50/30 max-md:rounded-xl max-md:border max-md:border-indigo-100/70 max-md:p-3 ${isActive ? 'bg-indigo-50/40' : ''}`}
      onClick={handleClick}
    >
      {/* 桌面端紧凑行 */}
      <div className="hidden px-2.5 py-2 md:block">
        <div className="flex items-center gap-1.5">
          {isActive && <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0" />}
          <span className="flex items-center gap-1 min-w-0">
            <span className={`font-mono text-[12px] font-medium ${isActive ? 'text-indigo-700' : 'text-slate-900'}`}>{build.version}</span>
            {isBranchTask(build) && (
              <span className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-1 py-px text-[9px] font-medium text-emerald-700">分支</span>
            )}
          </span>
          <span className="text-[10px] text-slate-400 truncate max-md:text-xs">{build.triggered_by_name || '-'}</span>
          <span className="ml-auto text-[10px] text-slate-400 shrink-0 max-md:text-xs">{build.started_at ? formatDuration(build.duration) : '-'}</span>
        </div>
        {isRunning(build.status) ? (
          <div className="mt-1.5 space-y-1">
            <ProgressBar progress={build.progress || 0} status={build.status} />
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1 text-[10px] text-cyan-600 max-md:text-xs">
                <span className="h-1 w-1 rounded-full bg-cyan-500 pulse-dot" />
                {stageLabel || '打包中'}
              </span>
              <button
                className="inline-flex items-center gap-0.5 rounded border border-rose-200 bg-white px-1 py-0 text-[10px] font-medium text-rose-600 hover:bg-rose-50 max-md:px-2 max-md:py-1 max-md:text-xs"
                onClick={handleCancel}
              >
                停止
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-1.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <StatusBadge status={build.status} />
              {svnPushWarning && <span className="text-[10px] font-medium text-amber-600 max-md:text-xs" title={svnPushWarning}>SVN 未上传</span>}
            </div>
            <span className="text-[10px] text-slate-400 max-md:text-xs">{formatRelativeTime(build.finished_at || build.created_at)}</span>
          </div>
        )}
      </div>

      {/* 移动端卡片（参考 ui-design/mobile-release.html） */}
      <div className="md:hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {isActive && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />}
            <StatusBadge status={build.status} />
          </div>
          {isBranchTask(build) && (
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-600">分支</span>
          )}
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className={`truncate font-mono text-[15px] font-semibold tracking-tight ${isActive ? 'text-indigo-700' : 'text-slate-900'}`}>
            {build.version}
          </span>
          <span className="truncate text-[12px] text-slate-400">{build.triggered_by_name || '-'}</span>
        </div>
        {isRunning(build.status) ? (
          <>
            <div className="mt-2.5">
              <ProgressBar progress={build.progress || 0} status={build.status} />
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-indigo-50 pt-3">
              <span className="inline-flex items-center gap-1 text-[11px] text-cyan-600">
                <span className="h-1 w-1 rounded-full bg-cyan-500 pulse-dot" />
                {stageLabel || '打包中'}
              </span>
              <button
                className="inline-flex h-9 items-center rounded-md border border-rose-200 bg-white px-3 text-[12px] font-medium text-rose-600 hover:bg-rose-50"
                onClick={handleCancel}
              >
                停止
              </button>
            </div>
          </>
        ) : (
          <div className="mt-3 flex items-center justify-between border-t border-indigo-50 pt-3">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <span className="font-mono">{build.started_at ? formatDuration(build.duration) : '-'}</span>
              {svnPushWarning && (
                <span className="font-medium text-amber-600" title={svnPushWarning}>SVN 未上传</span>
              )}
            </div>
            <span className="text-[11px] text-slate-400">{formatRelativeTime(build.finished_at || build.created_at)}</span>
          </div>
        )}
      </div>
    </div>
  );
});

interface ArtifactListPanelProps {
  artifacts: PackageTask['artifact_info'];
  taskId: string;
}

export const ArtifactListPanel = memo(function ArtifactListPanel({ artifacts, taskId }: ArtifactListPanelProps) {
  const list = artifacts || [];
  return (
    <div className="p-4 space-y-3 scrollbar-thin" style={{ minHeight: 420, maxHeight: 560, overflowY: 'auto' }}>
      {list.length === 0 ? (
        <div className="text-center py-12 text-[13px] text-slate-400">暂无产物</div>
      ) : (
        list.map((a) => <ArtifactRow key={a.id} artifact={a} taskId={taskId} />)
      )}
    </div>
  );
});
