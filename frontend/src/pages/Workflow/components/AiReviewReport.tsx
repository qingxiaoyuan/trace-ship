import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { workflowApi } from '@/api/workflow';
import type { AiReviewData, AiReviewFinding } from '@/api/workflow';
import type { NormalizedError } from '@/api/request';
import { ReviewDiff } from './ReviewDiff';
import { useAuthStore } from '@/stores/authStore';
import { uniqueHistoryFindings } from './reviewFindings';

const statusText: Record<AiReviewData['status'], string> = {
  queued: '等待审查',
  running: '正在审查',
  completed: '审查完成，等待人工决定',
  failed: '审查失败',
  incomplete: '审查未完成',
  first_release: '首次发布，跳过 AI 审查',
  no_changes: '无代码变更',
  skipped: '管理员已跳过 AI 审查',
  canceled: '本轮审查已取消',
};

function RecoveryActions({ instanceId, nodeId }: { instanceId: string; nodeId: string }) {
  const client = useQueryClient();
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const action = useMutation({
    mutationFn: (kind: 'retry' | 'skip') => kind === 'retry'
      ? workflowApi.retryAiReview(instanceId, nodeId)
      : workflowApi.skipAiReview(instanceId, nodeId, reason.trim()),
    onSuccess: async () => {
      setError('');
      setReason('');
      setShowReason(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['ai-review', instanceId] }),
        client.invalidateQueries({ queryKey: ['workflow-instance-for-detail', instanceId] }),
      ]);
    },
    onError: (failure: NormalizedError) => setError(failure.friendlyMessage || failure.message || '操作失败，请重试'),
  });
  return <div className="space-y-2 border-t border-slate-200 pt-3">
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={action.isPending} onClick={() => { setError(''); action.mutate('retry'); }} className="rounded border border-indigo-300 px-3 py-1 text-indigo-700 disabled:opacity-50">重新审查</button>
      <button type="button" disabled={action.isPending} onClick={() => { setError(''); setShowReason(!showReason); }} className="rounded border border-amber-300 px-3 py-1 text-amber-800 disabled:opacity-50">留理由跳过</button>
    </div>
    {showReason ? <div className="space-y-2">
      <label className="block text-slate-700">跳过原因<textarea value={reason} maxLength={2000} onChange={(event) => setReason(event.target.value)} className="mt-1 block w-full rounded border border-slate-300 p-2" rows={3} /></label>
      <button type="button" disabled={action.isPending || !reason.trim()} onClick={() => { setError(''); action.mutate('skip'); }} className="rounded bg-amber-700 px-3 py-1 text-white disabled:opacity-50">确认跳过并交人工审批</button>
    </div> : null}
    {error ? <p role="alert" className="text-rose-700">{error}</p> : null}
  </div>;
}

function PagedPaths({ paths, emptyText = '无' }: { paths: string[]; emptyText?: string }) {
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const pages = Math.max(1, Math.ceil(paths.length / pageSize));
  const current = Math.min(page, pages - 1);
  if (!paths.length) return <p className="mt-2 text-xs text-slate-500">{emptyText}</p>;
  return <>
    <ul className="mt-2 list-inside list-disc break-all font-mono text-xs">{paths.slice(current * pageSize, (current + 1) * pageSize).map((path) => <li key={path}>{path}</li>)}</ul>
    {pages > 1 ? <div className="mt-2 flex items-center gap-2 text-xs"><button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>上一页</button><span>{current + 1} / {pages}</span><button type="button" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>下一页</button></div> : null}
  </>;
}

function BatchProgress({ batches }: { batches: NonNullable<AiReviewData['coverage']['batches']> }) {
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const pages = Math.max(1, Math.ceil(batches.length / pageSize));
  const current = Math.min(page, pages - 1);
  const status: Record<string, string> = { completed: '已完成', failed: '失败', incomplete: '未完成', pending: '待审查' };
  return <details className="rounded border border-slate-200 p-2">
    <summary className="cursor-pointer font-medium text-slate-700">分批审查进度</summary>
    <ol className="mt-2 space-y-2">{batches.slice(current * pageSize, (current + 1) * pageSize).map((batch, index) => <li key={batch.id} className="min-w-0">
      <p>{`第 ${current * pageSize + index + 1} 批：${status[batch.status] || '未完成'}`}</p>
      <PagedPaths paths={batch.paths} />
      {batch.dimensions?.length ? <p className="break-words text-xs text-slate-500">实际维度：{batch.dimensions.join('、')}</p> : null}
    </li>)}</ol>
    {pages > 1 ? <div className="mt-2 flex items-center gap-2 text-xs"><button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>上一页</button><span>{current + 1} / {pages}</span><button type="button" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>下一页</button></div> : null}
  </details>;
}

function location(finding: AiReviewFinding): string {
  if (!finding.path) return '整体意见';
  if (!finding.side || !finding.line_start) return `${finding.path} · 文件级意见`;
  const lines = finding.line_end && finding.line_end !== finding.line_start
    ? `${finding.line_start}–${finding.line_end}` : `${finding.line_start}`;
  return `${finding.path} · ${finding.side === 'old' ? '旧侧' : '新侧'} ${lines} 行`;
}

function ReviewHistory({ review }: { review: AiReviewData }) {
  const findings = uniqueHistoryFindings(review);
  if (!review.history?.length) return null;
  return <details className="rounded border border-slate-200 p-2"><summary className="cursor-pointer font-medium text-slate-700">过往审查执行（{review.history.length}）</summary>
    {review.history.map((item, index) => <div key={item.token} className="mt-2 rounded bg-slate-50 p-2">
      <p>第 {index + 1} 次 · {statusText[item.status as AiReviewData['status']] || item.status} · {item.updated_at}</p>
      <p className="whitespace-pre-wrap break-words">{item.summary}</p>
      {item.coverage?.warnings?.map((warning, i) => <p key={i} className="break-words text-amber-800">{warning}</p>)}
      {item.coverage?.unreviewed_paths?.map((path) => <p key={path} className="break-all font-mono text-xs">未审查：{path}</p>)}
      {(findings.get(item.token) || []).map((finding, i) => <div key={finding.id || i} className="whitespace-pre-wrap break-words">
        <strong>{finding.title}</strong><span className="ml-2 break-all text-xs text-slate-500">{location(finding)}</span>
        <Markdown remarkPlugins={[remarkGfm]}>{finding.reason}</Markdown>
        {finding.suggestion ? <div>建议：<Markdown remarkPlugins={[remarkGfm]}>{finding.suggestion}</Markdown></div> : null}
      </div>)}
    </div>)}
  </details>;
}

/** 以实例为单位读取服务端授权后的报告，执行期间自动刷新。 */
export function AiReviewReport({ instanceId }: { instanceId: string }) {
  const client = useQueryClient();
  const sessionVersion = useAuthStore((state) => state.sessionVersion);
  const query = useQuery({
    queryKey: ['ai-review', instanceId, sessionVersion],
    queryFn: () => workflowApi.getAiReview(instanceId),
    retry: false,
    gcTime: 0,
    refetchInterval: (state) => state.state.data?.reviews?.some((review) => review.status === 'queued' || review.status === 'running') ? 3000 : false,
  });
  const states = query.data?.reviews?.map((review) => `${review.node_id}:${review.status}`).join('|') || '';
  useEffect(() => {
    if (states) {
      void client.invalidateQueries({ queryKey: ['workflow-instance-for-detail', instanceId] });
    }
  }, [client, instanceId, states]);

  if (query.isLoading || (query.isFetching && !query.isFetchedAfterMount)) return <p className="text-sm text-slate-500">正在读取 AI 审查…</p>;
  if (query.error) {
    const error = query.error as unknown as NormalizedError;
    if (error.status === 404) return null;
    return <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
      AI 审查读取失败：{error.friendlyMessage || error.message || '请稍后重试'}
      <button type="button" className="ml-2 underline" onClick={() => void query.refetch()}>重试</button>
    </div>;
  }
  if (query.data && !Array.isArray(query.data.reviews)) return <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">AI 审查结果格式错误，请稍后重试。
    <button type="button" className="ml-2 underline" onClick={() => void query.refetch()}>重试</button>
  </div>;
  if (!query.data?.reviews.length) return null;
  return <section aria-label="AI 代码审查" className="tech-card space-y-4 rounded-xl p-5 text-sm">
    <h3 className="text-[15px] font-semibold text-slate-900">AI 代码审查</h3>
    {query.data.reviews.map((review) => <article key={review.node_id} className="space-y-3 rounded-lg border border-slate-200 p-4">
      <h4 className="font-semibold text-slate-800">{review.node_name ? `${review.node_name} · ` : ''}{statusText[review.status] || '审查状态未知'}</h4>
      {review.summary ? <p className="whitespace-pre-wrap break-words text-slate-700">{review.summary}</p> : null}
      {review.status === 'skipped' && review.skip_reason ? <p className="whitespace-pre-wrap break-words text-amber-800">跳过原因：{review.skip_reason}；操作者：{review.skipped_by_name || '已删除用户'}；时间：{review.skipped_at || '未知'}</p> : null}
      <div className="text-slate-600">覆盖范围：{review.coverage?.total_files === undefined || review.coverage.reviewed_files === undefined ? '尚未统计' : review.coverage.manifest_complete === false ? `已知 ${review.coverage.reviewed_files} / ${review.coverage.total_files} 个文件（完整清单未知）` : `${review.coverage.reviewed_files} / ${review.coverage.total_files} 个文件`}</div>
      {review.coverage?.warnings?.length ? <ul className="list-inside list-disc text-amber-700">{review.coverage.warnings.map((warning, index) => <li key={`${index}:${warning}`} className="break-words">{warning}</li>)}</ul> : null}
      {review.coverage?.reviewed_paths ? <details className="rounded border border-slate-200 p-2">
        <summary className="cursor-pointer font-medium text-slate-700">已审查文件</summary>
        <PagedPaths paths={review.coverage.reviewed_paths} />
      </details> : null}
      {review.coverage?.unreviewed_paths ? <details open={review.coverage.unreviewed_paths.length > 0} className="rounded border border-amber-200 p-2">
        <summary className="cursor-pointer font-medium text-amber-800">未审查文件</summary>
        <PagedPaths paths={review.coverage.unreviewed_paths} />
      </details> : null}
      {review.coverage?.batches?.length ? <BatchProgress batches={review.coverage.batches} /> : null}
      {review.dimensions?.length ? <p className="break-words text-slate-600">实际审查维度：{review.dimensions.join('、')}</p> : null}
      <ReviewHistory review={review} />
      {review.findings ? <div className="space-y-3"><h5 className="font-semibold text-slate-800">审查意见</h5>
        {review.findings.length === 0 ? <p className="text-slate-500">未报告意见，仍需人工判断。</p> : review.findings.map((finding, index) => <div key={finding.id || index} className="rounded-lg bg-slate-50 p-3">
          <div className="flex flex-wrap items-center gap-2"><span className="rounded bg-amber-100 px-1.5 text-xs font-semibold text-amber-800">{finding.severity}</span><strong className="break-words">{finding.title}</strong></div>
          <p className="mt-1 break-all font-mono text-xs text-slate-500">{location(finding)}</p>
          <div className="mt-2 whitespace-pre-wrap break-words [&_pre]:overflow-x-auto"><Markdown remarkPlugins={[remarkGfm]}>{finding.reason}</Markdown></div>
          {finding.suggestion ? <div className="mt-2 whitespace-pre-wrap break-words text-slate-600 [&_pre]:overflow-x-auto">建议：<Markdown remarkPlugins={[remarkGfm]}>{finding.suggestion}</Markdown></div> : null}
        </div>)}
      </div> : null}
      {review.can_recover ? <RecoveryActions instanceId={instanceId} nodeId={review.node_id} /> : null}
    </article>)}
    <ReviewDiff instanceId={instanceId} reviews={query.data.reviews} />
  </section>;
}
