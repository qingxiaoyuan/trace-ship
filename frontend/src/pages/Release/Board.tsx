import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Loader, Plus, XCircle } from 'lucide-react';
import dayjs from 'dayjs';
import { releaseApi } from '@/api/release';
import { getAvatarColor } from '@/utils/avatar';
import { boardColumns, releaseTypeText, releaseTypeBadge } from './constants';
import type { Release, ReleaseType } from '@/types';

/** 看板卡片 */
function ReleaseCard({ release, onClick }: { release: Release; onClick: () => void }) {
  const type = release.release_type as ReleaseType;
  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-lg border border-slate-200 bg-white p-2.5 transition-all hover:-translate-y-0.5 hover:shadow-sm"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[12px] font-medium text-slate-800">{release.version}</span>
        {type ? (
          <span className={`rounded border px-1 py-0.5 text-[9px] font-medium ${releaseTypeBadge[type]}`}>
            {releaseTypeText[type]}
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 truncate text-[11px] text-slate-500">{release.project_name || '-'}</div>
      <div className="mt-2 flex items-center gap-1.5">
        <span
          className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-semibold text-white"
          style={{ background: getAvatarColor(release.publisher_name || release.publisher) }}
        >
          {(release.publisher_name || release.publisher || 'U').charAt(0)}
        </span>
        <span className="text-[10px] text-slate-400">
          {release.publisher_name || release.publisher || '-'} · {dayjs(release.created_at).format('MM-DD HH:mm')}
        </span>
      </div>
    </div>
  );
}

/** 发布看板（看板视图） */
export function ReleaseBoard() {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['release-board', 'kanban'],
    queryFn: () => releaseApi.getReleases({ page: 1, page_size: 100 }),
  });

  // 一次 groupBy 替代每列各自 filter 两次（items + count）
  const groupedReleases = useMemo(() => {
    const groups: Record<string, Release[]> = {};
    for (const r of data?.results || []) {
      const key = r.status || 'draft';
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }
    return groups;
  }, [data?.results]);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      {boardColumns.map((col) => {
        const items = (groupedReleases[col.key] || []).slice(0, 8);
        const count = groupedReleases[col.key]?.length ?? 0;
        return (
          <div key={col.key} className={`rounded-lg border p-3 ${col.tone}`}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${col.dot}`} />
                <span className="text-[12px] font-medium text-slate-600">{col.label}</span>
              </div>
              <span className={`text-[11px] font-medium ${col.countText}`}>
                {count}
              </span>
            </div>
            <div className="space-y-2">
              {isLoading ? (
                <div className="py-4 text-center text-[11px] text-slate-400">加载中…</div>
              ) : items.length === 0 ? (
                <div className="py-4 text-center text-[11px] text-slate-300">暂无</div>
              ) : (
                items.map((release) => (
                  <ReleaseCard
                    key={release.id}
                    release={release}
                    onClick={() => navigate(`/releases/${release.id}`)}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 发布列表视图 */
export function ReleaseList() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['release-board', 'list'],
    queryFn: () => releaseApi.getReleases({ page: 1, page_size: 50 }),
  });

  const releases = data?.results || [];

  return (
    <div className="tech-card overflow-hidden rounded-xl">
      <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
        <div className="col-span-2">版本</div>
        <div className="col-span-3">项目</div>
        <div className="col-span-2">类型</div>
        <div className="col-span-2">发布人</div>
        <div className="col-span-2">状态</div>
        <div className="col-span-1 text-right">时间</div>
      </div>
      <div className="divide-y divide-indigo-50/50">
        {isLoading ? (
          <div className="px-5 py-10 text-center text-[13px] text-slate-400">加载中…</div>
        ) : releases.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13px] text-slate-400">暂无发布</div>
        ) : (
          releases.map((release) => {
            const type = release.release_type as ReleaseType;
            const statusIcon =
              release.status === 'released' ? (
                <CheckCircle2 className="h-3 w-3 text-emerald-500" strokeWidth={1.5} />
              ) : release.status === 'rejected' ? (
                <XCircle className="h-3 w-3 text-rose-400" strokeWidth={1.5} />
              ) : release.status === 'pending' ? (
                <Loader className="h-3 w-3 text-amber-500" strokeWidth={1.5} />
              ) : null;
            return (
              <div
                key={release.id}
                onClick={() => navigate(`/releases/${release.id}`)}
                className="grid cursor-pointer grid-cols-12 items-center gap-3 px-5 py-3 transition-colors hover:bg-indigo-50/30"
              >
                <div className="col-span-12 font-mono text-[13px] font-medium text-slate-900 md:col-span-2">
                  {release.version}
                </div>
                <div className="col-span-6 truncate text-[12px] text-slate-600 md:col-span-3">
                  {release.project_name || '-'}
                </div>
                <div className="col-span-6 md:col-span-2">
                  {type ? (
                    <span className={`rounded border px-1 py-0.5 text-[10px] font-medium ${releaseTypeBadge[type]}`}>
                      {releaseTypeText[type]}
                    </span>
                  ) : (
                    '-'
                  )}
                </div>
                <div className="col-span-6 flex items-center gap-1.5 md:col-span-2">
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-semibold text-white"
                    style={{ background: getAvatarColor(release.publisher_name || release.publisher) }}
                  >
                    {(release.publisher_name || release.publisher || 'U').charAt(0)}
                  </span>
                  <span className="text-[12px] text-slate-600">
                    {release.publisher_name || release.publisher || '-'}
                  </span>
                </div>
                <div className="col-span-6 flex items-center gap-1.5 md:col-span-2">
                  {statusIcon}
                  <span className="text-[12px] text-slate-600">
                    {release.status === 'released' ? '已发布' : release.status === 'rejected' ? '已驳回' : release.status === 'pending' ? '待审批' : '草稿'}
                  </span>
                </div>
                <div className="col-span-6 text-right text-[11px] text-slate-400 md:col-span-1">
                  {dayjs(release.created_at).format('MM-DD')}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/** 发布看板页：看板 / 列表 视图切换 + 新建发布 */
export function ReleaseBoardPage() {
  const navigate = useNavigate();
  const [view, setView] = useState<'board' | 'list'>('board');

  return (
    <div className="space-y-5 ts-fade-in-up">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">发布看板</h1>
          <p className="mt-1 text-[13px] text-slate-500">跟踪发布全生命周期：草稿 → 审批 → 发布</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-indigo-100 bg-indigo-50/40 p-0.5">
            {([
              { key: 'board', label: '看板' },
              { key: 'list', label: '列表' },
            ] as const).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setView(opt.key)}
                className={
                  view === opt.key
                    ? 'rounded-md bg-white px-2.5 py-1 text-[12px] font-medium text-indigo-600 shadow-sm'
                    : 'rounded-md px-2.5 py-1 text-[12px] font-medium text-slate-500 transition-colors hover:text-slate-700'
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => navigate('/releases/create')}
            className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
            新建发布
          </button>
        </div>
      </div>
      {view === 'board' ? <ReleaseBoard /> : <ReleaseList />}
    </div>
  );
}

export default ReleaseBoardPage;
