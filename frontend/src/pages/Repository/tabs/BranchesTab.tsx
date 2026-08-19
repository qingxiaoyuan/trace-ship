import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { GitBranch, GitCommitHorizontal, RefreshCw } from 'lucide-react';
import { App } from 'antd';
import { repositoryApi } from '@/api/repository';
import { getAvatarColor } from '@/utils/avatar';

interface BranchesTabProps {
  repoId: string;
  repoType: 'git' | 'svn';
}

/** 分支 Tab：展示分支列表及最后提交人/时间，支持同步分支 */
export function BranchesTab({ repoId, repoType }: BranchesTabProps) {
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  const { data, isLoading } = useQuery({
    queryKey: ['repository-branches', repoId],
    queryFn: () => repositoryApi.getBranches(repoId),
  });

  const syncMutation = useMutation({
    mutationFn: () => repositoryApi.syncBranches(repoId),
    onSuccess: (data) => {
      message.success(data.detail ? data.detail : `同步成功，共 ${data.synced_count} 个分支`);
      queryClient.invalidateQueries({ queryKey: ['repository-branches', repoId] });
    },
  });

  if (repoType === 'svn') {
    return (
      <div className="py-8 text-center text-[13px] text-slate-400">
        SVN 仓库不支持分支同步
      </div>
    );
  }

  const branches = data || [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-[12px] text-slate-400">
          共 {branches.length} 个分支
        </div>
        <button
          type="button"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${syncMutation.isPending ? 'animate-spin' : ''}`}
            strokeWidth={1.5}
          />
          同步分支
        </button>
      </div>
      <div className="divide-y divide-indigo-50/50 rounded-lg border border-indigo-100 max-md:divide-y-0 max-md:space-y-3 max-md:border-0">
        {isLoading ? (
          <div className="px-4 py-6 text-center text-[13px] text-slate-400">加载中…</div>
        ) : branches.length === 0 ? (
          <div className="px-4 py-6 text-center text-[13px] text-slate-400">
            暂无分支数据，请点击右上角「同步分支」按钮同步
          </div>
        ) : (
          branches.map((b) => {
            const firstLine = (b.last_commit_message || '').split('\n', 1)[0];
            return (
              <div key={b.name} className="max-md:rounded-xl max-md:border max-md:border-indigo-100/70 max-md:bg-white max-md:p-4">
                {/* 桌面端行 */}
                <div className="hidden items-center gap-3 px-4 py-3 md:flex">
                  <GitBranch
                    className={`h-4 w-4 shrink-0 ${b.is_default ? 'text-indigo-400' : 'text-slate-400'}`}
                    strokeWidth={1.5}
                  />
                  <span
                    className={`font-mono text-[13px] font-medium ${b.is_default ? 'text-slate-900' : 'text-slate-700'}`}
                  >
                    {b.name}
                  </span>
                  {b.is_default ? (
                    <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
                      默认
                    </span>
                  ) : null}
                  {firstLine ? (
                    <span className="min-w-0 flex-1 truncate text-[12px] text-slate-500">
                      {firstLine}
                    </span>
                  ) : (
                    <span className="flex-1" />
                  )}
                  {b.last_commit_author ? (
                    <>
                      <span className="shrink-0 text-[11px] text-slate-500">{b.last_commit_author}</span>
                      <span className="h-1 w-1 shrink-0 rounded-full bg-slate-300" />
                    </>
                  ) : null}
                  <span className="shrink-0 text-[11px] text-slate-400">
                    {b.last_commit_at ? dayjs(b.last_commit_at).format('YYYY-MM-DD HH:mm') : '-'}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-slate-400">
                    {b.last_commit_hash ? b.last_commit_hash.slice(0, 8) : '-'}
                  </span>
                </div>

                {/* 移动端卡片（无状态字段：强调分支名 + 弱化最后提交信息） */}
                <div className="md:hidden">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <GitBranch
                        className={`h-4 w-4 shrink-0 ${b.is_default ? 'text-indigo-400' : 'text-slate-400'}`}
                        strokeWidth={1.5}
                      />
                      <span
                        className={`truncate font-mono text-[15px] font-semibold tracking-tight ${b.is_default ? 'text-slate-900' : 'text-slate-700'}`}
                      >
                        {b.name}
                      </span>
                    </div>
                    {b.is_default ? (
                      <span className="shrink-0 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-600">
                        默认
                      </span>
                    ) : null}
                  </div>
                  {firstLine ? (
                    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                      <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                      <span className="min-w-0 truncate">{firstLine}</span>
                    </div>
                  ) : null}
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-indigo-50 pt-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold text-white"
                        style={{ background: getAvatarColor(b.last_commit_author || 'U') }}
                      >
                        {(b.last_commit_author || 'U').charAt(0)}
                      </span>
                      <span className="truncate text-[12px] text-slate-500">
                        {b.last_commit_author || '-'} · {b.last_commit_at ? dayjs(b.last_commit_at).format('MM-DD HH:mm') : '-'}
                      </span>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] text-slate-400">
                      {b.last_commit_hash ? b.last_commit_hash.slice(0, 8) : ''}
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
