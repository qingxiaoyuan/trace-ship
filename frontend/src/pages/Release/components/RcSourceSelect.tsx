import { useState } from 'react';
import { Button, Input, Radio, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { releaseApi } from '@/api/release';

interface Props {
  project?: string;
  repository?: string;
  value?: string;
  disabled?: boolean;
  onChange?: (id: string) => void;
}

/** 候选查询按上下文隔离，分页和搜索不会使用上一个请求的结果。 */
export function RcSourceSelect({ project, repository, value, onChange, disabled }: Props) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data, isFetching, error } = useQuery({
    queryKey: ['rc-candidates', project, repository, search, page],
    queryFn: () => releaseApi.getRcCandidates({ project, repository, search, page, page_size: 5 }),
    enabled: !!project && !!repository,
    retry: false,
  });
  if (!project || !repository) return <p className="text-slate-500">请先选择项目和仓库</p>;
  return <div className="min-w-0 space-y-3">
    <Input disabled={disabled} aria-label="搜索 RC 版本或 Tag" placeholder="搜索 RC 版本或 Tag" value={search}
      onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
    {error ? <p role="alert">{error.message || '查询 RC 失败，请检查仓库凭证与连通性'}</p> : null}
    {isFetching ? <Spin size="small" /> : null}
    {!isFetching && !error && data?.total === 0 ? <p>没有可用的已发布 RC，请先发布 RC 或调整搜索条件</p> : null}
    <Radio.Group aria-label="来源 RC" value={value} onChange={(e) => onChange?.(e.target.value)} className="!flex flex-col gap-2">
      {(data?.results || []).map((rc) => <Radio key={rc.id} value={rc.id} disabled={disabled || !rc.available || isFetching}
        className="!m-0 min-h-9 rounded-lg border border-slate-200 p-3">
        <span className="block break-all font-medium">{rc.version} · {rc.tag_name}</span>
        <span className="block text-xs text-slate-500">{rc.released_at ? dayjs(rc.released_at).format('YYYY-MM-DD HH:mm') : '发布时间未记录'} · {rc.branch}</span>
        <span className="block break-all font-mono text-xs">{rc.git_hash || '无提交快照'}</span>
        <span className={`block text-xs ${rc.available ? 'text-emerald-700' : 'text-red-600'}`}>
          {rc.available ? 'RC Tag 与提交一致' : rc.unavailable_reason}
        </span>
      </Radio>)}
    </Radio.Group>
    <div className="flex items-center gap-3">
      <Button disabled={disabled || page === 1 || isFetching} onClick={() => setPage(page - 1)}>上一页</Button>
      <span className="text-xs">第 {page} 页 · 共 {data?.total ?? 0} 条</span>
      <Button disabled={disabled || !data || page * 5 >= data.total || isFetching} onClick={() => setPage(page + 1)}>下一页</Button>
    </div>
  </div>;
}
