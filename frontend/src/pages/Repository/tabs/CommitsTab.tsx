import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { GitBranch } from 'lucide-react';
import { Select } from 'antd';
import { repositoryApi } from '@/api/repository';
import { getAvatarColor } from '@/utils/avatar';

/** 提交类型前缀提取 */
function parsePrefix(message: string): { prefix: string; rest: string } | null {
  const match = message.match(/^(feat|fix|refactor|perf|docs|style|test|chore|build|ci)(\(.+\))?!?:\s*(.*)$/i);
  if (!match) return null;
  return { prefix: match[1].toLowerCase(), rest: match[3] };
}

const prefixBadge: Record<string, string> = {
  feat: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  fix: 'bg-blue-50 border-blue-200 text-blue-700',
  refactor: 'bg-violet-50 border-violet-200 text-violet-700',
  perf: 'bg-amber-50 border-amber-200 text-amber-700',
  docs: 'bg-slate-50 border-slate-200 text-slate-600',
  style: 'bg-slate-50 border-slate-200 text-slate-600',
  test: 'bg-slate-50 border-slate-200 text-slate-600',
  chore: 'bg-slate-50 border-slate-200 text-slate-600',
  build: 'bg-slate-50 border-slate-200 text-slate-600',
  ci: 'bg-slate-50 border-slate-200 text-slate-600',
};

/** 最近提交 Tab */
export function CommitsTab({ repoId }: { repoId: string }) {
  const [branch, setBranch] = useState<string | undefined>(undefined);

  const { data: branches } = useQuery({
    queryKey: ['repository-branches', repoId],
    queryFn: () => repositoryApi.getBranches(repoId),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['repository-commits', repoId, branch],
    queryFn: () =>
      repositoryApi.getRepositoryCommits(repoId, {
        page: 1,
        page_size: 50,
        branch,
      }),
  });

  const commits = data?.results || [];

  const branchOptions = useMemo(() => {
    const list = branches || [];
    return [
      { value: '', label: '全部分支' },
      ...list.map((b) => ({ value: b.name, label: b.name })),
    ];
  }, [branches]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-[12px] text-slate-400">最近 {commits.length} 条提交</div>
        <Select
          value={branch || ''}
          options={branchOptions}
          onChange={(value) => setBranch(value || undefined)}
          placeholder="选择分支"
          className="min-w-[140px]"
          size="small"
        />
      </div>
      <div className="divide-y divide-indigo-50/50 max-md:divide-y-0 max-md:space-y-3">
        {isLoading ? (
          <div className="py-6 text-center text-[13px] text-slate-400">加载中…</div>
        ) : commits.length === 0 ? (
          <div className="py-6 text-center text-[13px] text-slate-400">
            暂无提交记录，请先同步提交
          </div>
        ) : (
          commits.map((c) => {
            const parsed = parsePrefix(c.message);
            return (
              <div key={c.id} className="max-md:rounded-xl max-md:border max-md:border-indigo-100/70 max-md:bg-white max-md:p-4">
                {/* 桌面端行 */}
                <div className="hidden items-start gap-3 py-3 md:flex">
                  <span
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                    style={{ background: getAvatarColor(c.author) }}
                  >
                    {(c.author || 'U').charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {parsed ? (
                        <>
                          <span className={`rounded border px-1 py-0.5 text-[10px] font-medium ${prefixBadge[parsed.prefix] || 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                            {parsed.prefix}
                          </span>
                          <span className="truncate text-[13px] text-slate-800">{parsed.rest}</span>
                        </>
                      ) : (
                        <span className="truncate text-[13px] text-slate-800">{c.message}</span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                      <span className="font-mono text-indigo-500">{c.commit_hash?.slice(0, 7)}</span>
                      <span>{c.author}</span>
                      <span className="h-1 w-1 rounded-full bg-slate-300" />
                      <span>{c.committed_at ? dayjs(c.committed_at).format('MM-DD HH:mm') : '-'}</span>
                      {c.branch && (
                        <>
                          <span className="h-1 w-1 rounded-full bg-slate-300" />
                          <span className="inline-flex items-center gap-1 rounded border border-indigo-100 bg-indigo-50/50 px-1.5 py-0.5 text-[10px] text-indigo-600">
                            <GitBranch className="h-3 w-3" strokeWidth={1.5} />
                            {c.branch}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className="font-mono text-[10px] text-slate-400">{c.commit_hash?.slice(0, 10)}</span>
                </div>

                {/* 移动端卡片（参考 ui-design/mobile-release.html） */}
                <div className="md:hidden">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-indigo-600">
                      {c.commit_hash?.slice(0, 7)}
                    </span>
                    {c.branch ? (
                      <span className="inline-flex min-w-0 items-center gap-1 rounded bg-indigo-50/60 px-1.5 py-0.5 text-[11px] font-medium text-indigo-600">
                        <GitBranch className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                        <span className="truncate">{c.branch}</span>
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    {parsed ? (
                      <>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${prefixBadge[parsed.prefix] || 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                          {parsed.prefix}
                        </span>
                        <span className="min-w-0 truncate text-[14px] font-medium text-slate-800">{parsed.rest}</span>
                      </>
                    ) : (
                      <span className="min-w-0 truncate text-[14px] font-medium text-slate-800">{c.message}</span>
                    )}
                  </div>
                  <div className="mt-3 flex items-center gap-2 border-t border-indigo-50 pt-3">
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold text-white"
                      style={{ background: getAvatarColor(c.author) }}
                    >
                      {(c.author || 'U').charAt(0)}
                    </span>
                    <span className="truncate text-[12px] text-slate-500">
                      {c.author} · {c.committed_at ? dayjs(c.committed_at).format('MM-DD HH:mm') : '-'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
