import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Pagination } from 'antd';
import dayjs from 'dayjs';
import { workflowApi } from '@/api/workflow';
import { instanceStatusMap } from '@/pages/Workflow/constants';

/** 当前申请的可见审批轮次，由服务端限制项目及审批人范围。 */
export function WorkflowHistory({ releaseId }: { releaseId: string }) {
  return <WorkflowHistoryList key={releaseId} releaseId={releaseId} />;
}

function WorkflowHistoryList({ releaseId }: { releaseId: string }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['workflow-history', releaseId, page],
    queryFn: () => workflowApi.getInstances({ biz_type: 'release', biz_id: releaseId, page, page_size: 10 }),
  });
  return (
    <section className="tech-card rounded-xl p-5" aria-label="审批记录">
      <h3 className="mb-3 text-[15px] font-semibold text-slate-900">审批记录</h3>
      {isLoading ? <p>加载中…</p> : isError ? (
        <button type="button" className="text-indigo-600" onClick={() => void refetch()}>加载失败，点击重试</button>
      ) : !data?.results?.length ? <p className="text-sm text-slate-500">暂无审批记录</p> : (
        <>
          <ul className="space-y-2">
            {data.results.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <Link className="text-indigo-600" to={`/workflows/${item.id}`}>
                  {item.is_current ? '当前审批' : '历史审批'} · {dayjs(item.created_at).format('YYYY-MM-DD HH:mm')}
                </Link>
                <span className="text-slate-500">{instanceStatusMap[item.status]?.text || item.status}</span>
              </li>
            ))}
          </ul>
          {data.total > 10 ? <Pagination className="mt-3" current={page} pageSize={10} total={data.total} onChange={setPage} showSizeChanger={false} /> : null}
        </>
      )}
    </section>
  );
}
