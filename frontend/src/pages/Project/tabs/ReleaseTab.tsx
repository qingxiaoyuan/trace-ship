import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Rocket, ChevronRight, Search } from 'lucide-react';
import dayjs from 'dayjs';
import { StatusTag, type StatusType } from '@/components/StatusTag';
import { releaseApi } from '@/api/release';

const typeDisplay: Record<string, { status: StatusType; text: string }> = {
  formal: { status: 'primary', text: '正式' },
  rc: { status: 'info', text: 'RC' },
  beta: { status: 'warning', text: 'Beta' },
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

export function ReleaseTab({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['project-releases', projectId],
    queryFn: () =>
      releaseApi.getReleases({
        project: projectId,
        status: 'released',
        page_size: 1000,
      }),
    enabled: !!projectId,
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
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" strokeWidth={1.5} />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索版本号 / Tag"
            className="w-[200px] rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
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

      <div className="divide-y divide-indigo-50/50 max-h-[calc(100vh-300px)] overflow-y-auto">
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
            return (
              <div
                key={item.id}
                onClick={() => navigate(`/releases/${item.id}`)}
                className="grid grid-cols-12 cursor-pointer items-center gap-3 px-5 py-3 transition-colors hover:bg-indigo-50/30"
              >
                <div className="col-span-12 flex items-center gap-2 md:col-span-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg icon-indigo">
                    <Rocket className="h-4 w-4" strokeWidth={1.5} />
                  </div>
                  <span className="font-mono text-[13px] text-slate-900">{item.version || '-'}</span>
                </div>
                <div className="col-span-6 font-mono text-[12px] text-slate-600 md:col-span-2">
                  {item.tag_name || '-'}
                </div>
                <div className="col-span-6 md:col-span-2">
                  <StatusTag status={cfg.status}>{cfg.text}</StatusTag>
                </div>
                <div className="col-span-6 text-[13px] text-slate-700 md:col-span-2">
                  {item.publisher_name || item.publisher || '-'}
                </div>
                <div className="col-span-6 text-[13px] text-slate-500 md:col-span-2">
                  {item.released_at ? dayjs(item.released_at).format('YYYY-MM-DD HH:mm') : '-'}
                </div>
                <div className="col-span-6 flex items-center justify-end md:col-span-1">
                  <ChevronRight className="h-4 w-4 text-slate-300" strokeWidth={1.5} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
