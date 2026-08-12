import { CheckCircle2, Loader, XCircle } from 'lucide-react';
import type { Release } from '@/types';
import type { PipelineStatus } from '../types';
import { releaseStatusText, releaseTypeClass, releaseTypeText, statusDotClass } from '../constants';
import { formatRelative } from '../utils';
import { SmallTag } from './SmallTag';

/** 发布流水线中的单条发布卡片 */
export function PipelineCard({
  release,
  status,
  cardBorder,
}: {
  release: Release;
  status: PipelineStatus;
  cardBorder: string;
}) {
  const statusLabel = releaseStatusText[release.status as string] || releaseStatusText[status];

  return (
    <button
      type="button"
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
        {status === 'building' ? (
          <Loader className="spin-slow h-3 w-3 text-cyan-500" strokeWidth={2} />
        ) : status === 'released' ? (
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
      {status === 'building' ? (
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-cyan-100">
          <div className="h-full w-[65%] rounded-full bg-gradient-to-r from-cyan-400 to-indigo-400" />
        </div>
      ) : null}
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
