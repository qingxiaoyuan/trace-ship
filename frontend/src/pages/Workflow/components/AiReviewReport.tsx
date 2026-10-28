import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { workflowApi } from '@/api/workflow';
import type { AiReviewData, AiReviewFinding } from '@/api/workflow';
import type { NormalizedError } from '@/api/request';
import { ReviewDiff } from './ReviewDiff';
import { useAuthStore } from '@/stores/authStore';

const statusText: Record<AiReviewData['status'], string> = {
  queued: '等待审查',
  running: '正在审查',
  completed: '审查完成，等待人工决定',
  failed: '审查失败',
  incomplete: '审查未完成',
  first_release: '首次发布，跳过 AI 审查',
  no_changes: '无代码变更',
};

function location(finding: AiReviewFinding): string {
  if (!finding.path) return '整体意见';
  if (!finding.side || !finding.line_start) return `${finding.path} · 文件级意见`;
  const lines = finding.line_end && finding.line_end !== finding.line_start
    ? `${finding.line_start}–${finding.line_end}` : `${finding.line_start}`;
  return `${finding.path} · ${finding.side === 'old' ? '旧侧' : '新侧'} ${lines} 行`;
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
      <div className="text-slate-600">覆盖范围：{review.coverage?.total_files === undefined || review.coverage.reviewed_files === undefined ? '尚未统计' : `${review.coverage.reviewed_files} / ${review.coverage.total_files} 个文件`}</div>
      {review.coverage?.warnings?.length ? <ul className="list-inside list-disc text-amber-700">{review.coverage.warnings.map((warning, index) => <li key={`${index}:${warning}`} className="break-words">{warning}</li>)}</ul> : null}
      {review.coverage?.reviewed_paths ? <details className="rounded border border-slate-200 p-2">
        <summary className="cursor-pointer font-medium text-slate-700">已审查文件</summary>
        {review.coverage.reviewed_paths.length ? <ul className="mt-2 list-inside list-disc break-all font-mono text-xs text-slate-600">{review.coverage.reviewed_paths.map((path) => <li key={path}>{path}</li>)}</ul> : <p className="mt-2 text-xs text-slate-500">无</p>}
      </details> : null}
      {review.coverage?.unreviewed_paths ? <details open={review.coverage.unreviewed_paths.length > 0} className="rounded border border-amber-200 p-2">
        <summary className="cursor-pointer font-medium text-amber-800">未审查文件</summary>
        {review.coverage.unreviewed_paths.length ? <ul className="mt-2 list-inside list-disc break-all font-mono text-xs text-amber-800">{review.coverage.unreviewed_paths.map((path) => <li key={path}>{path}</li>)}</ul> : <p className="mt-2 text-xs text-slate-500">无</p>}
      </details> : null}
      {review.dimensions?.length ? <p className="break-words text-slate-600">实际审查维度：{review.dimensions.join('、')}</p> : null}
      {review.findings ? <div className="space-y-3"><h5 className="font-semibold text-slate-800">审查意见</h5>
        {review.findings.length === 0 ? <p className="text-slate-500">未报告意见，仍需人工判断。</p> : review.findings.map((finding, index) => <div key={finding.id || index} className="rounded-lg bg-slate-50 p-3">
          <div className="flex flex-wrap items-center gap-2"><span className="rounded bg-amber-100 px-1.5 text-xs font-semibold text-amber-800">{finding.severity}</span><strong className="break-words">{finding.title}</strong></div>
          <p className="mt-1 break-all font-mono text-xs text-slate-500">{location(finding)}</p>
          <div className="mt-2 whitespace-pre-wrap break-words [&_pre]:overflow-x-auto"><Markdown remarkPlugins={[remarkGfm]}>{finding.reason}</Markdown></div>
          {finding.suggestion ? <div className="mt-2 whitespace-pre-wrap break-words text-slate-600 [&_pre]:overflow-x-auto">建议：<Markdown remarkPlugins={[remarkGfm]}>{finding.suggestion}</Markdown></div> : null}
        </div>)}
      </div> : null}
    </article>)}
    <ReviewDiff instanceId={instanceId} reviews={query.data.reviews} />
  </section>;
}
