import { CheckCircle2, XCircle, Loader } from 'lucide-react';
import dayjs from 'dayjs';
import type { Release, ReleaseBuildDetail } from '@/types';

interface ReleaseBuildProps {
  release: Release;
}

/** 构建状态展示 */
const buildStatusMap: Record<string, { text: string; cls: string; icon: typeof CheckCircle2 }> = {
  success: { text: '成功', cls: 'icon-emerald', icon: CheckCircle2 },
  failure: { text: '失败', cls: 'icon-rose', icon: XCircle },
  aborted: { text: '中止', cls: 'icon-rose', icon: XCircle },
  running: { text: '构建中', cls: 'icon-cyan', icon: Loader },
  queue: { text: '排队中', cls: 'icon-cyan', icon: Loader },
};

/** 计算耗时（秒） */
function duration(start?: string | null, end?: string | null): string {
  if (!start || !end) return '-';
  const seconds = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m${String(s).padStart(2, '0')}s`;
}

/** 构建信息 Tab：基于 release.build_detail 渲染 */
export function ReleaseBuild({ release }: ReleaseBuildProps) {
  const build = release.build_detail as ReleaseBuildDetail | null | undefined;

  if (!build) {
    return <div className="py-8 text-center text-[13px] text-slate-400">该发布尚未触发 Jenkins 构建</div>;
  }

  const statusInfo = buildStatusMap[build.status] || buildStatusMap.queue;
  const Icon = statusInfo.icon;

  return (
    <div className="space-y-3">
      {/* 构建状态概要 */}
      <div className="flex items-center gap-3 rounded-lg border border-indigo-100 bg-slate-50/50 p-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${statusInfo.cls}`}>
          <Icon className={`h-[18px] w-[18px] ${build.status === 'running' || build.status === 'queue' ? 'animate-spin' : ''}`} strokeWidth={1.5} />
        </div>
        <div className="flex-1">
          <div className="text-[13px] font-medium text-slate-900">
            构建 #{build.build_number ?? '-'} · {statusInfo.text}
          </div>
          <div className="text-[11px] text-slate-500">
            {build.job_name || '-'} · 耗时 {duration(build.started_at, build.finished_at)}
          </div>
        </div>
        {build.started_at ? (
          <span className="font-mono text-[11px] text-slate-400">
            {dayjs(build.started_at).format('MM-DD HH:mm')}
          </span>
        ) : null}
      </div>

      {/* 构建详情字段 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-indigo-100 bg-white p-3">
          <div className="text-[11px] text-slate-400">构建任务</div>
          <div className="mt-1 text-[13px] font-medium text-slate-800">{build.job_name || '-'}</div>
        </div>
        <div className="rounded-lg border border-indigo-100 bg-white p-3">
          <div className="text-[11px] text-slate-400">构建号</div>
          <div className="mt-1 font-mono text-[13px] font-medium text-slate-800">
            {build.build_number ? `#${build.build_number}` : '-'}
          </div>
        </div>
        <div className="rounded-lg border border-indigo-100 bg-white p-3">
          <div className="text-[11px] text-slate-400">开始时间</div>
          <div className="mt-1 text-[13px] text-slate-800">
            {build.started_at ? dayjs(build.started_at).format('HH:mm:ss') : '-'}
          </div>
        </div>
        <div className="rounded-lg border border-indigo-100 bg-white p-3">
          <div className="text-[11px] text-slate-400">耗时</div>
          <div className="mt-1 font-mono text-[13px] text-slate-800">
            {duration(build.started_at, build.finished_at)}
          </div>
        </div>
      </div>
    </div>
  );
}
