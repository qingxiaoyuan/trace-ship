import { CheckCircle2, Loader, XCircle } from 'lucide-react';
import type { PackageTask, Release } from '@/types';
import type { PipelineStatus } from '../types';
import { releaseStatusText, releaseTypeClass, releaseTypeText, statusDotClass } from '../constants';
import { formatDurationSeconds, formatRelative, getRunningElapsedSeconds } from '../utils';
import { SmallTag } from './SmallTag';

/** 发布流水线中的单条发布卡片，点击跳发布详情 */
export function PipelineCard({
  release,
  status,
  cardBorder,
  onClick,
}: {
  release: Release;
  status: PipelineStatus;
  cardBorder: string;
  onClick?: () => void;
}) {
  const statusLabel = releaseStatusText[release.status as string] || releaseStatusText[status];

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className={`w-full rounded-lg border bg-white p-2.5 text-left transition-colors hover:shadow-sm ${cardBorder}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[12px] font-medium text-slate-800">{release.version}</span>
        <SmallTag className={releaseTypeClass[release.release_type]}>{releaseTypeText[release.release_type]}</SmallTag>
      </div>
      <div className="mt-1.5 truncate text-[11px] text-slate-500">
        {release.repository_name ? `${release.project_name || '-'} / ${release.repository_name}` : release.project_name || '-'}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        {status === 'released' ? (
          <CheckCircle2 className="h-3 w-3 text-emerald-500" strokeWidth={1.5} />
        ) : status === 'rejected' ? (
          <XCircle className="h-3 w-3 text-rose-400" strokeWidth={1.5} />
        ) : (
          <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass[status]}`} />
        )}
        <span className="truncate text-[10px] text-slate-400">
          {release.publisher || '系统'} · {statusLabel} · {formatRelative(release.created_at)}
        </span>
      </div>
    </button>
  );
}

/** 打包中列的运行任务卡片，点击跳打包看板 */
export function BuildPipelineCard({
  task,
  cardBorder,
  onClick,
}: {
  task: PackageTask;
  cardBorder: string;
  onClick?: () => void;
}) {
  const elapsed = getRunningElapsedSeconds(task);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className={`w-full rounded-lg border bg-white p-2.5 text-left transition-colors hover:shadow-sm ${cardBorder}`}
    >
      <div className="flex items-center justify-between">
        <span className="truncate font-mono text-[12px] font-medium text-slate-800">{task.name}</span>
        <Loader className="spin-slow h-3 w-3 shrink-0 text-cyan-500" strokeWidth={2} />
      </div>
      <div className="mt-1.5 truncate text-[11px] text-slate-500">{task.project_name || '-'}</div>
      <div className="mt-2 truncate text-[10px] text-slate-400">
        {task.version || '当前版本'} ·{' '}
        {task.status === 'queued' ? '排队中' : `已运行 ${formatDurationSeconds(elapsed)}`}
      </div>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-cyan-100">
        <div className="h-full w-[65%] rounded-full bg-gradient-to-r from-cyan-400 to-indigo-400" />
      </div>
    </button>
  );
}

/** 发布流水线空状态卡片 */
export function EmptyPipelineCard() {
  return (
    <div className="rounded-lg border border-dashed border-white/80 bg-white/50 p-2.5 text-[11px] text-slate-400">
      暂无记录
    </div>
  );
}
