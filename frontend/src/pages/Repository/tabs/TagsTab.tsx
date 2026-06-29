import { useQuery } from '@tanstack/react-query';
import { Tag } from 'lucide-react';
import dayjs from 'dayjs';
import { repositoryApi } from '@/api/repository';

interface TagsTabProps {
  repoId: string;
  repoType: 'git' | 'svn';
}

/** 标签 Tab：Git 仓库展示标签列表，SVN 仓库提示不支持 */
export function TagsTab({ repoId, repoType }: TagsTabProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['repository-tags', repoId],
    queryFn: () => repositoryApi.getTags(repoId),
  });

  if (repoType === 'svn') {
    return (
      <div className="py-8 text-center text-[13px] text-slate-400">
        SVN 仓库不支持标签管理
      </div>
    );
  }

  const tags = data || [];

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {isLoading ? (
        <div className="col-span-full py-6 text-center text-[13px] text-slate-400">加载中…</div>
      ) : tags.length === 0 ? (
        <div className="col-span-full py-6 text-center text-[13px] text-slate-400">暂无标签</div>
      ) : (
        tags.map((t, idx) => {
          const iconClass = ['icon-emerald', 'icon-cyan', 'icon-amber', 'icon-indigo', 'icon-violet'][idx % 5];
          return (
            <div
              key={t.name}
              className="flex items-center gap-3 rounded-lg border border-indigo-100 bg-white p-3 transition-colors hover:border-indigo-300"
            >
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconClass}`}>
                <Tag className="h-4 w-4" strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <div className="font-mono text-[13px] font-medium text-slate-900">{t.name}</div>
                <div className="text-[11px] text-slate-400">
                  {t.commit_hash ? t.commit_hash.slice(0, 8) : '-'}
                  {t.created_at ? ` · ${dayjs(t.created_at).format('YYYY-MM-DD')}` : ''}
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
