import { ArrowRight } from 'lucide-react';
import type { Release } from '@/types';
import {
  releaseStatusText,
  releaseTypeClass,
  releaseTypeText,
  statusDotClass,
  statusTextClass,
} from '../constants';
import { InitialAvatar, SmallTag } from './SmallTag';

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

      <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
        <div className="col-span-3">版本</div>
        <div className="col-span-3">项目</div>
        <div className="col-span-2">类型</div>
        <div className="col-span-2">发布人</div>
        <div className="col-span-2 text-right">状态</div>
      </div>

      <div className="divide-y divide-indigo-50/50">
        {releases.length > 0 ? (
          releases.map((release) => {
            const status = release.status as string;
            return (
              <div
                key={release.id}
                className="grid cursor-pointer grid-cols-12 items-center gap-3 px-5 py-3 transition-colors hover:bg-indigo-50/30"
              >
                <div className="col-span-12 flex items-center gap-2 md:col-span-3">
                  <span className="font-mono text-[13px] font-medium text-slate-900">{release.version}</span>
                </div>
                <div className="col-span-6 text-[13px] text-slate-600 md:col-span-3">{release.project_name || '-'}</div>
                <div className="col-span-6 md:col-span-2">
                  <SmallTag className={releaseTypeClass[release.release_type]}>{releaseTypeText[release.release_type]}</SmallTag>
                </div>
                <div className="col-span-6 flex items-center gap-1.5 md:col-span-2">
                  <InitialAvatar name={release.publisher} size={16} />
                  <span className="text-[12px] text-slate-600">{release.publisher || '系统'}</span>
                </div>
                <div className="col-span-6 flex items-center justify-end gap-1.5 md:col-span-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass[status] || 'bg-slate-400'}`} />
                  <span className={`text-[12px] font-medium ${statusTextClass[status] || 'text-slate-500'}`}>
                    {releaseStatusText[status] || status}
                  </span>
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
