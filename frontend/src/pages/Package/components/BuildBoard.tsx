import { memo, useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitBranch,
  Hammer,
  Layers3,
  Trash2,
} from 'lucide-react';
import type { PackageConfig, PackageTask } from '@/types';
import { groupTasksByRepository } from './boardData';
import { ProgressBar, StatusBadge, UserAvatar } from './Shared';
import {
  formatDuration,
  formatRelativeTime,
  getSvnPushWarning,
  isRunning,
  releaseTypeBadge,
  releaseTypeText,
  stageLabels,
  statusMeta,
  isBranchTask,
} from './utils';

interface BuildBoardProps {
  /** 运行中 + 已完成合并后的任务列表（按创建时间倒序） */
  tasks: PackageTask[];
  /** 全量打包配置，用于统计各仓库的配置数 */
  configs: PackageConfig[];
  loading: boolean;
  keyword: string;
  onKeywordChange: (value: string) => void;
  /** 已完成任务总数（超过加载数量时提示仅展示最近部分） */
  historyTotal: number;
  loadedHistoryCount: number;
  hasMoreHistory: boolean;
  loadingMoreHistory: boolean;
  onLoadMoreHistory: () => void;
  onOpen: (task: PackageTask) => void;
  canDelete?: boolean;
  onDelete?: (task: PackageTask) => void;
}

/** 构建列表：按仓库分组，运行中任务与已完成任务统一收纳 */
export const BuildBoard = memo(function BuildBoard({
  tasks,
  configs,
  loading,
  keyword,
  onKeywordChange,
  historyTotal,
  loadedHistoryCount,
  hasMoreHistory,
  loadingMoreHistory,
  onLoadMoreHistory,
  onOpen,
  canDelete,
  onDelete,
}: BuildBoardProps) {
  const [collapsedRepos, setCollapsedRepos] = useState<Set<string>>(new Set());

  const groups = useMemo(() => groupTasksByRepository(tasks, configs), [tasks, configs]);

  const toggleRepo = useCallback((repo: string) => {
    setCollapsedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(repo)) next.delete(repo);
      else next.add(repo);
      return next;
    });
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 px-1 text-[11px] text-slate-400">
          <Layers3 className="h-3.5 w-3.5 text-indigo-500" strokeWidth={1.5} />
          按仓库集合查看构建任务；运行中任务与已完成任务统一收纳
        </div>
        <div className="relative ml-auto">
          <Hammer className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" strokeWidth={1.5} />
          <input
            type="text"
            value={keyword}
            onChange={(e) => onKeywordChange(e.target.value)}
            placeholder="搜索任务名 / 版本 / 触发人"
            className="w-[220px] rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
      </div>

      {historyTotal > loadedHistoryCount && (
        <div className="px-1 text-[11px] text-slate-400">
          已完成任务共 {historyTotal} 条，当前展示最近 {loadedHistoryCount} 条
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-indigo-100 bg-white p-12 text-center text-[13px] text-slate-400">加载中…</div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-indigo-100 bg-white p-12 text-center">
          <Hammer className="mx-auto h-10 w-10 text-slate-300" strokeWidth={1.5} />
          <p className="mt-3 text-[13px] text-slate-400">{keyword ? '没有匹配的打包任务' : '暂无打包记录'}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => {
            const collapsed = collapsedRepos.has(group.repositoryId);
            return (
              <section key={group.repositoryId} className="overflow-hidden rounded-xl border border-[#E0E7FF] bg-white shadow-[0_10px_28px_-18px_rgba(15,23,42,0.25)]">
                <header
                  className="flex cursor-pointer flex-wrap items-center gap-3 border-b border-indigo-50 bg-[#FAFBFE] px-5 py-3"
                  onClick={() => toggleRepo(group.repositoryId)}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                    <GitBranch className="h-4 w-4" strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate font-mono text-[13px] font-semibold text-slate-800">{group.repositoryName}</h2>
                      <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-600">仓库集合</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {group.configCount} 个配置 · {group.tasks.length} 次构建
                      {group.latestActivity && ` · 最近活动 ${formatRelativeTime(group.latestActivity)}`}
                    </div>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {group.runningCount > 0 && (
                      <span className="text-[11px] font-medium text-emerald-600">{group.runningCount} 运行中</span>
                    )}
                    {collapsed ? (
                      <ChevronRight className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
                    )}
                  </div>
                </header>
                {!collapsed && (
                  <>
                    <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
                      <div className="col-span-4">任务 / 版本</div>
                      <div className="col-span-2">状态</div>
                      <div className="col-span-3">进度</div>
                      <div className="col-span-2">触发人 · 耗时</div>
                      <div className="col-span-1 text-right">操作</div>
                    </div>
                    <div className="divide-y divide-indigo-50/50 max-md:divide-y-0 max-md:space-y-3 max-md:p-3">
                      {group.tasks.map((task) => (
                        <BuildRow
                          key={task.id}
                          task={task}
                          onOpen={onOpen}
                          canDelete={canDelete}
                          onDelete={onDelete}
                        />
                      ))}
                    </div>
                  </>
                )}
              </section>
            );
          })}
        </div>
      )}

      {hasMoreHistory && !loading && (
        <div className="flex justify-center pt-1">
          <button
            type="button"
            disabled={loadingMoreHistory}
            onClick={onLoadMoreHistory}
            className="rounded-lg border border-indigo-100 bg-white px-4 py-2 text-[12px] font-medium text-indigo-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 disabled:cursor-wait disabled:opacity-60"
          >
            {loadingMoreHistory ? '正在加载…' : '加载更多历史任务'}
          </button>
        </div>
      )}
    </div>
  );
});

const FINISHED_STATUSES = new Set(['success', 'failure', 'canceled']);

interface BuildRowProps {
  task: PackageTask;
  onOpen: (task: PackageTask) => void;
  canDelete?: boolean;
  onDelete?: (task: PackageTask) => void;
}

const BuildRow = memo(function BuildRow({ task, onOpen, canDelete, onDelete }: BuildRowProps) {
  const running = isRunning(task.status);
  const meta = statusMeta[task.status];
  const svnPushWarning = getSvnPushWarning(task);
  const canDeleteTask = canDelete && FINISHED_STATUSES.has(task.status);

  const stageInfo = task.stage_info as { stage?: string; running?: number; max_concurrency?: number } | undefined;
  const stageText = (() => {
    if (task.status === 'queued' && stageInfo?.stage === 'waiting_node') {
      return `等待节点 ${stageInfo.running ?? '-'}/${stageInfo.max_concurrency ?? '-'}`;
    }
    if (!running) return meta.label;
    const s = stageInfo?.stage;
    return s ? stageLabels[s] || s : '打包中';
  })();

  // 进度列副文案：运行中展示阶段 + 已耗时，已完成展示完成时间 + 总耗时
  const progressMeta = running
    ? `${stageText} · 运行 ${formatDuration(task.duration)}`
    : task.finished_at
      ? `${formatRelativeTime(task.finished_at)}完成 · ${formatDuration(task.duration)}`
      : '';

  const handleClick = useCallback(() => onOpen(task), [onOpen, task]);
  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDelete?.(task);
    },
    [onDelete, task],
  );

  return (
    <div
      className={`group cursor-pointer transition-colors max-md:rounded-xl max-md:border max-md:bg-white max-md:p-4 ${
        running ? 'bg-indigo-50/20 hover:bg-indigo-50/30' : 'hover:bg-indigo-50/30'
      }`}
      onClick={handleClick}
    >
      {/* 桌面端网格行 */}
      <div className="hidden grid-cols-12 items-center gap-3 px-5 py-3 md:grid">
        <div className="col-span-4 flex min-w-0 items-center gap-2.5">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-slate-900">{task.name}</div>
            <div className="flex items-center gap-1.5 font-mono text-[10px] text-slate-400">
              <span className="truncate">{task.version}</span>
              {task.release_type && (
                <span className={`shrink-0 rounded border px-1 py-px text-[9px] font-medium ${releaseTypeBadge[task.release_type] || 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                  {releaseTypeText[task.release_type] || task.release_type}
                </span>
              )}
              {isBranchTask(task) && (
                <span className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-1 py-px text-[9px] font-medium text-emerald-700">分支</span>
              )}
            </div>
          </div>
        </div>
        <div className="col-span-2">
          <StatusBadge status={task.status} />
          {svnPushWarning && (
            <span title={svnPushWarning} className="ml-1.5 inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              <AlertTriangle className="h-3 w-3" strokeWidth={1.5} />
              SVN 未上传
            </span>
          )}
        </div>
        <div className="col-span-3 min-w-0">
          <ProgressBar progress={task.progress || 0} status={task.status} />
          {progressMeta && <div className={`mt-1 truncate text-[10px] ${running ? 'text-cyan-600' : 'text-slate-400'}`}>{progressMeta}</div>}
        </div>
        <div className="col-span-2 flex items-center gap-1.5 text-[11px] text-slate-500">
          <UserAvatar name={task.triggered_by_name} size={16} />
          <span className="truncate">{task.triggered_by_name || '-'}</span>
          <span className="text-slate-300">·</span>
          <span className="font-mono">{task.started_at ? formatDuration(task.duration) : '-'}</span>
        </div>
        <div className="col-span-1 flex items-center justify-end gap-1">
          {canDeleteTask ? (
            <button
              onClick={handleDelete}
              title="删除任务"
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          ) : (
            <ExternalLink className="h-3.5 w-3.5 text-slate-400 opacity-0 transition group-hover:opacity-100" strokeWidth={1.5} />
          )}
        </div>
      </div>

      {/* 移动端卡片（参考 docs/ui/mobile/mobile-release.html） */}
      <div className="md:hidden">
        <div className="flex items-center justify-between">
          <StatusBadge status={task.status} />
          {task.release_type ? (
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${releaseTypeBadge[task.release_type] || 'bg-slate-100 text-slate-500'}`}>
              {releaseTypeText[task.release_type] || task.release_type}
            </span>
          ) : isBranchTask(task) ? (
            <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-600">分支</span>
          ) : null}
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="truncate text-[15px] font-semibold tracking-tight text-slate-900">{task.name}</span>
          <span className="shrink-0 truncate font-mono text-[12px] text-slate-400">{task.version}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
          <GitBranch className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
          <span className="truncate font-mono">{task.repository_name || '-'}</span>
        </div>
        <div className="mt-2.5">
          <ProgressBar progress={task.progress || 0} status={task.status} />
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-indigo-50 pt-3">
          <div className="flex items-center gap-2">
            <UserAvatar name={task.triggered_by_name} size={22} />
            <span className="text-[12px] text-slate-500">
              {task.triggered_by_name || '-'} · <span className="font-mono">{task.started_at ? formatDuration(task.duration) : '-'}</span>
            </span>
          </div>
          {canDeleteTask ? (
            <button
              onClick={handleDelete}
              title="删除任务"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.5} />
            </button>
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" strokeWidth={1.5} />
          )}
        </div>
      </div>
    </div>
  );
});
