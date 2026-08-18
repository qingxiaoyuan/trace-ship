import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pagination } from 'antd';
import { ChevronDown, ChevronUp, GitCommitHorizontal, GitCompareArrows } from 'lucide-react';
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
export function ReleaseCommits({ release }: { release: Release }) {
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['release-commits', release.id, page],
    queryFn: () => releaseApi.getCommits(release.id, { page, page_size: PAGE_SIZE }),
  });

  const commits = data?.results || [];
  const base = release.base_tag?.trim() || '首个版本';

  return (
    <div className="space-y-3">
      {/* 区间标题 */}
      <div className="flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-2 text-[12px] text-indigo-700">
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
            <div className="divide-y divide-slate-100">
              {commits.map((c) => {
                const badge = reviewBadge[c.review_status] || reviewBadge.unreviewed;
                const isLong = c.message.length > EXPAND_THRESHOLD;
                const expanded = expandedId === c.id;
                return (
                  <div key={c.id} className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
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
                    {expanded && (
                      <pre className="mt-1 ml-5 whitespace-pre-wrap rounded-md bg-slate-50 px-2.5 py-2 text-[12px] leading-5 text-slate-600">
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
