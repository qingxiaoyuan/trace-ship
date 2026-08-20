import { ArrowRight } from 'lucide-react';
import type { Release } from '@/types';
import {
  releaseStatusText,
  releaseTypeClass,
  releaseTypeText,
  statusDotClass,
  statusTextClass,
} from '../constants';
import { formatRelative } from '../utils';
import { InitialAvatar, SmallTag } from './SmallTag';

/** 移动端状态软色徽标 */
const mobileStatusBadge: Record<string, string> = {
  released: 'bg-emerald-50 text-emerald-600',
  pending: 'bg-amber-50 text-amber-600',
  rejected: 'bg-rose-50 text-rose-600',
};

/** 最近发布列表面板 */
export function RecentReleasesPanel({
  releases,
  onViewAll,
}: {
  releases: Release[];
  onViewAll: () => void;
}) {
  return (
    <div className="tech-card rounded-xl lg:col-span-2">
      <div className="flex items-center justify-between border-b border-indigo-50 px-5 py-4">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">最近发布</h2>
          <p className="mt-0.5 text-[12px] text-slate-500">最近 10 条发布记录</p>
        </div>
        <button
          type="button"
          onClick={onViewAll}
          className="inline-flex items-center gap-1 text-[13px] font-medium text-indigo-600 transition-colors hover:text-indigo-500"
        >
          <span>查看全部</span>
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </div>

      <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 lg:grid">
        <div className="col-span-3">版本</div>
        <div className="col-span-3">项目 / 仓库</div>
        <div className="col-span-2">类型</div>
        <div className="col-span-2">发布人</div>
        <div className="col-span-2 text-right">状态</div>
      </div>

      <div className="divide-y divide-indigo-50/50">
        {releases.length > 0 ? (
          releases.map((release) => {
            const status = release.status as string;
            return (
              <div key={release.id}>
                {/* 桌面端网格行 */}
                <div className="hidden cursor-pointer grid-cols-12 items-center gap-3 px-5 py-3 transition-colors hover:bg-indigo-50/30 lg:grid">
                  <div className="col-span-3 flex items-center gap-2">
                    <span className="font-mono text-[13px] font-medium text-slate-900">{release.version}</span>
                  </div>
                  <div className="col-span-3 text-[13px] text-slate-600">
                    <div className="truncate">{release.project_name || '-'}</div>
                    {release.repository_name && (
                      <div className="truncate text-[11px] text-slate-400">{release.repository_name}</div>
                    )}
                  </div>
                  <div className="col-span-2">
                    <SmallTag className={releaseTypeClass[release.release_type]}>{releaseTypeText[release.release_type]}</SmallTag>
                  </div>
                  <div className="col-span-2 flex items-center gap-1.5">
                    <InitialAvatar name={release.publisher} size={16} />
                    <span className="text-[12px] text-slate-600">{release.publisher || '系统'}</span>
                  </div>
                  <div className="col-span-2 flex items-center justify-end gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass[status] || 'bg-slate-400'}`} />
                    <span className={`text-[12px] font-medium ${statusTextClass[status] || 'text-slate-500'}`}>
                      {releaseStatusText[status] || status}
                    </span>
                  </div>
                </div>

                {/* 移动端简列表行（参考 docs/ui/mobile/mobile-dashboard.html 最近发布） */}
                <div className="flex items-center gap-3 px-4 py-3 lg:hidden">
                  <span
                    className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${mobileStatusBadge[status] || 'bg-slate-100 text-slate-500'}`}
                  >
                    {releaseStatusText[status] || status}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-slate-800">
                      {release.project_name || '-'}{' '}
                      <span className="font-mono text-[12px] text-indigo-600">{release.version}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {release.publisher || '系统'} · {formatRelative(release.created_at)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="px-5 py-8 text-center text-[13px] text-slate-400">暂无发布记录</div>
        )}
      </div>
    </div>
  );
}
