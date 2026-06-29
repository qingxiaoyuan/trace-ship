import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { releaseApi } from '@/api/release';
import { getAvatarColor } from '@/utils/avatar';

/** 提交类型前缀提取（从 message 解析 conventional commits 前缀） */
function parsePrefix(message: string): { prefix: string; rest: string } | null {
  const match = message.match(/^(feat|fix|refactor|perf|docs|style|test|chore|build|ci)(\(.+\))?!?:\s*(.*)$/i);
  if (!match) return null;
  const type = match[1].toLowerCase();
  return { prefix: type, rest: match[3] };
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

/** 关联提交 Tab */
export function ReleaseCommits({ releaseId }: { releaseId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['release-commits', releaseId],
    queryFn: () => releaseApi.getCommits(releaseId, { page_size: 100 }),
  });

  const commits = data?.results || [];
  const passCount = commits.filter((c) => c.review_status === 'pass').length;
  const warningCount = commits.filter((c) => c.review_status === 'warning').length;

  return (
    <div>
      {/* 统计条 */}
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[12px] text-slate-500">共 {commits.length} 条提交</span>
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-600">
          {passCount} 合规 · {warningCount} 警告
        </span>
      </div>

      {/* 提交列表 */}
      <div className="divide-y divide-indigo-50/50">
        {isLoading ? (
          <div className="py-6 text-center text-[13px] text-slate-400">加载中…</div>
        ) : commits.length === 0 ? (
          <div className="py-6 text-center text-[13px] text-slate-400">暂无关联提交，请先生成发布说明</div>
        ) : (
          commits.map((c) => {
            const parsed = parsePrefix(c.message);
            const isWarning = c.review_status === 'warning' || c.review_status === 'illegal';
            return (
              <div
                key={c.id}
                className={`flex items-center gap-3 py-2.5 ${isWarning ? 'rounded bg-amber-50/20 px-2 -mx-2' : ''}`}
              >
                <span className="w-16 shrink-0 truncate font-mono text-[11px] text-indigo-500">
                  {c.commit_hash?.slice(0, 7)}
                </span>
                <span className="flex-1 truncate text-[13px] text-slate-700">
                  {parsed ? (
                    <>
                      <span className={`mr-1.5 rounded border px-1 py-0.5 text-[10px] font-medium ${prefixBadge[parsed.prefix] || 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                        {parsed.prefix}
                      </span>
                      {parsed.rest}
                    </>
                  ) : (
                    c.message
                  )}
                </span>
                <span
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-semibold text-white"
                  style={{ background: getAvatarColor(c.author) }}
                >
                  {(c.author || 'U').charAt(0)}
                </span>
                {isWarning ? (
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-400" strokeWidth={1.5} />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" strokeWidth={1.5} />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
