import { useQuery } from '@tanstack/react-query';
import { GitBranch } from 'lucide-react';
import { repositoryApi } from '@/api/repository';

/** 分支 Tab */
export function BranchesTab({ repoId }: { repoId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['repository-branches', repoId],
    queryFn: () => repositoryApi.getBranches(repoId),
  });

  const branches = data || [];

  return (
    <div className="divide-y divide-indigo-50/50 rounded-lg border border-indigo-100">
      {isLoading ? (
        <div className="px-4 py-6 text-center text-[13px] text-slate-400">加载中…</div>
      ) : branches.length === 0 ? (
        <div className="px-4 py-6 text-center text-[13px] text-slate-400">暂无分支数据</div>
      ) : (
        branches.map((b) => (
          <div key={b.name} className="flex items-center gap-3 px-4 py-3">
            <GitBranch
              className={`h-4 w-4 ${b.is_default ? 'text-indigo-400' : 'text-slate-400'}`}
              strokeWidth={1.5}
            />
            <span className={`font-mono text-[13px] font-medium ${b.is_default ? 'text-slate-900' : 'text-slate-700'}`}>
              {b.name}
            </span>
            {b.is_default ? (
              <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
                默认
              </span>
            ) : null}
            <span className="ml-auto text-[11px] text-slate-400">
              {b.last_commit_hash ? b.last_commit_hash.slice(0, 8) : '-'}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
