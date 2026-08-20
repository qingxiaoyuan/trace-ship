import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Rocket, ChevronRight, Search, Tag } from 'lucide-react';
import dayjs from 'dayjs';
import { StatusTag, type StatusType } from '@/components/StatusTag';
import { releaseApi } from '@/api/release';
import { getAvatarColor } from '@/utils/avatar';

const typeDisplay: Record<string, { status: StatusType; text: string }> = {
  formal: { status: 'primary', text: '正式' },
  rc: { status: 'info', text: 'RC' },
  beta: { status: 'warning', text: 'Beta' },
};

/** 移动端发布类型软底色徽标 */
const mobileTypeBadge: Record<string, string> = {
  formal: 'bg-indigo-50 text-indigo-600',
  rc: 'bg-cyan-50 text-cyan-700',
  beta: 'bg-amber-50 text-amber-600',
};

interface ReleaseTabItem {
  id: string;
  version?: string;
  tag_name?: string;
  release_type?: string;
  publisher_name?: string;
  publisher?: string;
  released_at?: string;
}

interface ReleaseTabProps {
  /** 项目维度过滤（项目详情页使用） */
  projectId?: string;
  /** 仓库维度过滤（仓库详情页「发布版本」Tab 使用） */
  repositoryId?: string;
}

export function ReleaseTab({ projectId, repositoryId }: ReleaseTabProps) {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['release-tab', projectId || '', repositoryId || ''],
    queryFn: () =>
      releaseApi.getReleases({
        project: projectId || undefined,
        repository: repositoryId || undefined,
        status: 'released',
        page_size: 1000,
      }),
    enabled: !!(projectId || repositoryId),
  });

  const list = (data?.results || []) as ReleaseTabItem[];
  const filteredList = list.filter((item) => {
    if (!keyword) return true;
    const kw = keyword.toLowerCase();
    return (
      (item.version || '').toLowerCase().includes(kw) ||
      (item.tag_name || '').toLowerCase().includes(kw)
    );
  });

  return (
    <div className="tech-card overflow-hidden rounded-xl">
      <div className="flex flex-wrap items-center gap-2 border-b border-indigo-50 px-5 py-3">
        <div className="relative w-full sm:w-auto">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" strokeWidth={1.5} />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索版本号 / Tag"
            className="w-full sm:w-[200px] rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <div className="ml-auto text-[12px] text-slate-400">共 {filteredList.length} 个版本</div>
      </div>

      <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
        <div className="col-span-3">版本号</div>
        <div className="col-span-2">Tag</div>
        <div className="col-span-2">发布类型</div>
        <div className="col-span-2">发布人</div>
        <div className="col-span-2">发布时间</div>
        <div className="col-span-1 text-right">操作</div>
      </div>

      <div className="divide-y divide-indigo-50/50 max-md:divide-y-0 max-md:space-y-3 max-md:p-3 max-h-[calc(100vh-300px)] overflow-y-auto max-md:max-h-none">
        {isLoading ? (
          <div className="px-5 py-12 text-center text-[13px] text-slate-400">加载中…</div>
        ) : filteredList.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-5 py-16">
            <Rocket className="h-8 w-8 text-slate-300" strokeWidth={1.5} />
            <span className="text-[13px] text-slate-400">暂无已发布版本</span>
          </div>
        ) : (
          filteredList.map((item) => {
            const cfg = typeDisplay[item.release_type || ''] || {
              status: 'neutral' as StatusType,
              text: item.release_type || '-',
            };
            const publisherLabel = item.publisher_name || item.publisher || '-';
            return (
              <div
                key={item.id}
                onClick={() => navigate(`/releases/${item.id}`)}
                className="cursor-pointer transition-colors hover:bg-indigo-50/30 max-md:rounded-xl max-md:border max-md:border-indigo-100/70 max-md:bg-white max-md:p-4"
              >
                {/* 桌面端网格行 */}
                <div className="hidden grid-cols-12 items-center gap-3 px-5 py-3 md:grid">
                  <div className="col-span-3 flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg icon-indigo">
                      <Rocket className="h-4 w-4" strokeWidth={1.5} />
                    </div>
                    <span className="font-mono text-[13px] text-slate-900">{item.version || '-'}</span>
                  </div>
                  <div className="col-span-2 font-mono text-[12px] text-slate-600">
                    {item.tag_name || '-'}
                  </div>
                  <div className="col-span-2">
                    <StatusTag status={cfg.status}>{cfg.text}</StatusTag>
                  </div>
                  <div className="col-span-2 text-[13px] text-slate-700">
                    {publisherLabel}
                  </div>
                  <div className="col-span-2 text-[13px] text-slate-500">
                    {item.released_at ? dayjs(item.released_at).format('YYYY-MM-DD HH:mm') : '-'}
                  </div>
                  <div className="col-span-1 flex items-center justify-end">
                    <ChevronRight className="h-4 w-4 text-slate-300" strokeWidth={1.5} />
                  </div>
                </div>

                {/* 移动端卡片（参考 docs/ui/mobile/mobile-release.html） */}
                <div className="md:hidden">
                  <div className="flex items-center justify-between">
                    <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-600">
                      已发布
                    </span>
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${mobileTypeBadge[item.release_type || ''] || 'bg-slate-100 text-slate-500'}`}
                    >
                      {cfg.text}
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="font-mono text-[16px] font-semibold tracking-tight text-slate-900">
                      {item.version || '-'}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                    <Tag className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                    <span className="truncate font-mono">{item.tag_name || '-'}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-indigo-50 pt-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-semibold text-white"
                        style={{ background: getAvatarColor(publisherLabel) }}
                      >
                        {publisherLabel.charAt(0)}
                      </span>
                      <span className="text-[12px] text-slate-500">
                        {publisherLabel} · {item.released_at ? dayjs(item.released_at).format('MM-DD HH:mm') : '-'}
                      </span>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" strokeWidth={1.5} />
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
