import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pagination } from 'antd';
import { ChevronDown, ChevronUp, Clock, GitCommitHorizontal, GitCompareArrows } from 'lucide-react';
import dayjs from 'dayjs';
import { releaseApi } from '@/api/release';
import type { Release, ReviewStatus } from '@/types';

const PAGE_SIZE = 20;
/** 提交信息超过该字符数视为超长，可展开查看全文 */
const EXPAND_THRESHOLD = 60;

/** 提交审查状态徽标 */
const reviewBadge: Record<ReviewStatus, { text: string; cls: string }> = {
  pass: { text: '规范', cls: 'border-emerald-200 bg-emerald-50 text-emerald-600' },
  warning: { text: '警告', cls: 'border-amber-200 bg-amber-50 text-amber-600' },
  illegal: { text: '非法', cls: 'border-rose-200 bg-rose-50 text-rose-600' },
  unreviewed: { text: '未审查', cls: 'border-slate-200 bg-slate-50 text-slate-500' },
};

/**
 * 提交记录 Tab：展示「上一 tag -> 本次发布 tag」区间内已保存的提交快照
 *
 * 数据来源为发布时生成的 release_commits 快照，不依赖实时拉取；
 * 未生成过发布说明的发布无快照，显示空态。
 */
export function ReleaseCommits({ release, maintainerMobile = false }: { release: Release; maintainerMobile?: boolean }) {
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['release-commits', release.id, page],
    queryFn: () => releaseApi.getCommits(release.id, { page, page_size: PAGE_SIZE }),
  });

  const commits = data?.results || [];
  const base = release.base_tag?.trim() || '首个版本';

  if (maintainerMobile) return <div>
    <div className="mb-[14px] flex min-h-[30px] items-center justify-between gap-3 px-2 text-[#76869f]">
      <span className="min-w-0 break-words font-mono text-[12px] [overflow-wrap:anywhere]">{base} → {release.tag_name || '-'}</span>
      <span className="shrink-0 text-[11px]">{data?.total ?? 0} 条快照</span>
    </div>
    {isLoading ? <p className="py-8 text-center text-[13px] text-[#76869f]">加载中…</p> : !commits.length ? (
      <p className="py-10 text-center text-[13px] text-[#76869f]">该发布暂无提交记录快照（未生成过发布说明）</p>
    ) : <div className="overflow-hidden rounded-2xl border border-[#e9edf5] bg-white pl-[37px] pr-[17px]">
      {commits.map((commit) => {
        const badge = reviewBadge[commit.review_status] || reviewBadge.unreviewed;
        return <article key={commit.id} className="relative min-h-[140px] border-b border-[#e9edf5] py-[14px] last:border-0">
          <span aria-hidden className="absolute -left-5 top-6 h-1.5 w-1.5 rounded-full bg-[#9da4f6]" />
          <div className="flex min-h-[25px] items-center justify-between gap-3">
            <span className="font-mono text-[12px] font-medium text-[#4f46e5]">{commit.commit_hash.slice(0, 8)}</span>
            <span className="min-w-0 break-words text-right text-[12px] text-[#76869f]">{commit.author}</span>
          </div>
          <p className="mb-[11px] mt-[13px] min-h-[42px] whitespace-pre-wrap break-words text-[14px] font-medium leading-[21px] text-[#24324b] [overflow-wrap:anywhere]">{commit.message}</p>
          <div className="flex min-h-[23px] flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-[#76869f]">{commit.committed_at ? dayjs(commit.committed_at).format('MM-DD HH:mm') : '-'}</span>
            <div className="flex flex-wrap gap-1">
              {commit.review_status !== 'unreviewed' && <span className={`rounded-md px-[11px] py-1 text-[11px] leading-[14px] ${commit.review_status === 'pass' ? 'bg-[#eff8f4] text-[#238264]' : badge.cls}`}>{badge.text}</span>}
              {commit.is_included === false && <span className="rounded-md bg-[#f0f3f8] px-[11px] py-1 text-[11px] leading-[14px] text-[#76869f]">未纳入说明</span>}
            </div>
          </div>
        </article>;
      })}
    </div>}
    {data && data.total > PAGE_SIZE && <div className="mt-4 flex justify-end">
      <Pagination current={page} pageSize={PAGE_SIZE} total={data.total} showSizeChanger={false} onChange={setPage} />
    </div>}
  </div>;

  return (
    <div className="space-y-3">
      {/* 区间标题 */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-2 text-[12px] text-indigo-700">
        <GitCompareArrows className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        <span>
          提交区间：
          <span className="font-mono font-semibold">{base}</span>
          {' -> '}
          <span className="font-mono font-semibold">{release.tag_name || '-'}</span>
        </span>
        <span className="ml-auto text-slate-400">共 {data?.total ?? 0} 条提交快照</span>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-[13px] text-slate-400">加载中…</div>
      ) : commits.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10">
          <GitCommitHorizontal className="h-8 w-8 text-slate-300" strokeWidth={1.5} />
          <p className="mt-3 text-[13px] text-slate-400">
            该发布暂无提交记录快照（未生成过发布说明）
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <div className="divide-y divide-slate-100 max-md:space-y-2 max-md:divide-y-0 max-md:p-2">
              {commits.map((c) => {
                const badge = reviewBadge[c.review_status] || reviewBadge.unreviewed;
                const isLong = c.message.length > EXPAND_THRESHOLD;
                const expanded = expandedId === c.id;
                return (
                  <div key={c.id} className="px-3 py-1.5 max-md:rounded-xl max-md:border max-md:border-slate-200/70 max-md:bg-white max-md:p-3">
                    {/* 桌面端行 */}
                    <div className="hidden items-center gap-2 md:flex">
                      <GitCommitHorizontal
                        className="h-3.5 w-3.5 shrink-0 text-slate-400"
                        strokeWidth={1.5}
                      />
                      <span className="shrink-0 font-mono text-[11px] font-semibold text-slate-600">
                        {c.commit_hash.slice(0, 8)}
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-500">{c.author}</span>
                      {c.review_status !== 'unreviewed' && (
                        <span className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] ${badge.cls}`}>
                          {badge.text}
                        </span>
                      )}
                      {c.is_included === false && (
                        <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-px text-[10px] text-slate-400">
                          未纳入说明
                        </span>
                      )}
                      <span
                        className="min-w-0 flex-1 truncate text-[12px] text-slate-600"
                        title={c.message}
                      >
                        {c.message}
                      </span>
                      {isLong && (
                        <button
                          type="button"
                          onClick={() => setExpandedId(expanded ? null : c.id)}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-300 transition-colors hover:bg-indigo-50 hover:text-indigo-500"
                          title={expanded ? '收起' : '展开'}
                        >
                          {expanded ? (
                            <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.5} />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
                          )}
                        </button>
                      )}
                      <span className="shrink-0 text-[10px] text-slate-400">
                        {c.committed_at ? dayjs(c.committed_at).format('MM-DD HH:mm') : '-'}
                      </span>
                    </div>

                    {/* 移动端卡片（参考 docs/ui/mobile/mobile-release.html） */}
                    <div className="md:hidden">
                      {/* 顶行徽标：与桌面端一致，未审查时不显示审查徽标 */}
                      {(c.review_status !== 'unreviewed' || c.is_included === false) && (
                        <div className="flex items-center justify-between">
                          {c.review_status !== 'unreviewed' ? (
                            <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${badge.cls}`}>
                              {badge.text}
                            </span>
                          ) : (
                            <span />
                          )}
                          {c.is_included === false && (
                            <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-400">
                              未纳入说明
                            </span>
                          )}
                        </div>
                      )}
                      <div className="mt-2 flex items-baseline gap-2">
                        <span className="font-mono text-[15px] font-semibold tracking-tight text-slate-900">
                          {c.commit_hash.slice(0, 8)}
                        </span>
                        <span className="truncate text-[12px] text-slate-400">{c.author}</span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <span
                          className="min-w-0 flex-1 truncate text-[12px] text-slate-500"
                          title={c.message}
                        >
                          {c.message}
                        </span>
                        {isLong && (
                          <button
                            type="button"
                            onClick={() => setExpandedId(expanded ? null : c.id)}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-500"
                            title={expanded ? '收起' : '展开'}
                          >
                            {expanded ? (
                              <ChevronUp className="h-4 w-4" strokeWidth={1.5} />
                            ) : (
                              <ChevronDown className="h-4 w-4" strokeWidth={1.5} />
                            )}
                          </button>
                        )}
                      </div>
                      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
                        <Clock className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                        {c.committed_at ? dayjs(c.committed_at).format('MM-DD HH:mm') : '-'}
                      </div>
                    </div>
                    {expanded && (
                      <pre className="mt-1 ml-5 whitespace-pre-wrap rounded-md bg-slate-50 px-2.5 py-2 text-[12px] leading-5 text-slate-600 max-md:ml-0 max-md:mt-2">
                        {c.message}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {data && data.total > PAGE_SIZE && (
            <div className="flex justify-end">
              <Pagination
                current={page}
                pageSize={PAGE_SIZE}
                total={data.total}
                showSizeChanger={false}
                onChange={setPage}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
