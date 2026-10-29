import { ReviewMarkdown } from './ReviewMarkdown';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ChevronDown, ClipboardList, Clock3, LoaderCircle, RefreshCw, SkipForward, Sparkles } from 'lucide-react';
import { Button } from 'antd';
import dayjs from 'dayjs';
import { workflowApi } from '@/api/workflow';
import type { AiReviewData, AiReviewFinding } from '@/api/workflow';
import type { NormalizedError } from '@/api/request';
import { ReviewDiff } from './ReviewDiff';
import { ReviewFileDirectory, UnreviewedFileDirectory } from './ReviewFileDirectory';
import { RemediationPanel } from './RemediationPanel';
import { ReviewRemediations } from './ReviewRemediations';
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
      <Button type="primary" icon={<RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />} disabled={action.isPending} onClick={() => { setError(''); action.mutate('retry'); }}>重新审查</Button>
      <Button icon={<SkipForward className="h-3.5 w-3.5" strokeWidth={1.5} />} disabled={action.isPending} onClick={() => { setError(''); setShowReason(!showReason); }}>留理由跳过</Button>
    </div>
    {showReason ? <div className="space-y-2">
      <label className="block text-slate-700">跳过原因<textarea value={reason} maxLength={2000} onChange={(event) => setReason(event.target.value)} className="mt-2 block w-full resize-y rounded-lg border border-indigo-100 bg-white px-3 py-2.5 text-[13px] text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" rows={3} /></label>
      <Button type="primary" disabled={action.isPending || !reason.trim()} onClick={() => { setError(''); action.mutate('skip'); }}>确认跳过并交人工审批</Button>
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
  return <section className="border-t border-slate-100 pt-4">
    <h5 className="text-[13px] font-medium text-slate-800">分批审查进度 <span className="ml-1 text-xs font-normal text-slate-400">{batches.length} 批</span></h5>
    <ol className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-100">{batches.slice(current * pageSize, (current + 1) * pageSize).map((batch, index) => <li key={batch.id} className="min-w-0 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[13px] font-medium text-slate-700">{`第 ${current * pageSize + index + 1} 批：${status[batch.status] || '未完成'}`}</p><span className="text-xs text-slate-400">{batch.paths.length} 个文件</span></div>
      {batch.dimensions?.length ? <p className="mt-1 break-words text-xs text-slate-500">实际维度：{batch.dimensions.join('、')}</p> : null}
      {batch.paths.length ? <details className="mt-2"><summary className="cursor-pointer text-xs text-indigo-600 hover:text-indigo-800">查看本批文件</summary><PagedPaths paths={batch.paths} /></details> : null}
    </li>)}</ol>
    {pages > 1 ? <div className="mt-3 flex items-center gap-2 text-xs"><button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="text-indigo-600 disabled:text-slate-300">上一页</button><span className="text-slate-400">{current + 1} / {pages}</span><button type="button" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)} className="text-indigo-600 disabled:text-slate-300">下一页</button></div> : null}
  </section>;
}

function location(finding: AiReviewFinding): string {
  if (!finding.path) return '整体意见';
  if (!finding.side || !finding.line_start) return `${finding.path} · 文件级意见`;
  const lines = finding.line_end && finding.line_end !== finding.line_start
    ? `${finding.line_start}–${finding.line_end}` : `${finding.line_start}`;
  return `${finding.path} · ${finding.side === 'old' ? '旧侧' : '新侧'} ${lines} 行`;
}

function PagedFindings({ findings, historical = false }: { findings: AiReviewFinding[]; historical?: boolean }) {
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const pages = Math.max(1, Math.ceil(findings.length / pageSize));
  const current = Math.min(page, pages - 1);
  if (!findings.length) return historical ? null : <p className="text-slate-500">未报告意见，仍需人工判断。</p>;
  return <>
    {findings.slice(current * pageSize, (current + 1) * pageSize).map((finding, index) => <div key={finding.id || index} className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2"><span className="rounded bg-amber-100 px-1.5 text-xs font-semibold text-amber-800">{finding.severity}</span><strong className="break-words">{finding.title}</strong></div>
      <p className="mt-1 break-all font-mono text-xs text-slate-500">{location(finding)}</p>
      <div className="mt-2 whitespace-pre-wrap break-words [&_pre]:overflow-x-auto"><ReviewMarkdown>{finding.reason}</ReviewMarkdown></div>
      {finding.suggestion ? <div className="mt-2 whitespace-pre-wrap break-words text-slate-600 [&_pre]:overflow-x-auto">建议：<ReviewMarkdown>{finding.suggestion}</ReviewMarkdown></div> : null}
    </div>)}
    {pages > 1 ? <div className="flex items-center gap-2 text-xs"><button type="button" aria-label="意见上一页" disabled={current === 0} onClick={() => setPage(current - 1)}>上一页</button><span>{current + 1} / {pages}</span><button type="button" aria-label="意见下一页" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>下一页</button></div> : null}
  </>;
}

function ReviewHistory({ review, showFindings = false }: { review: AiReviewData; showFindings?: boolean }) {
  const findings = uniqueHistoryFindings(review, review.status !== 'queued' && review.status !== 'running');
  if (!review.history?.length) return null;
  return <section className="border-t border-slate-100 pt-4"><h5 className="text-[13px] font-medium text-slate-800">过往审查执行（{review.history.length}）</h5>
    <ol className="mt-3 space-y-2">{review.history.map((item, index) => <li key={item.token} className="rounded-lg bg-slate-50/80 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[13px] font-medium text-slate-700">第 {index + 1} 次 · {statusText[item.status as AiReviewData['status']] || item.status}</span><time dateTime={item.updated_at} className="break-all text-xs text-slate-400">{dayjs(item.updated_at).isValid() ? dayjs(item.updated_at).format('YYYY-MM-DD HH:mm') : item.updated_at}</time></div>
      {item.summary ? <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-slate-500">{item.summary}</p> : null}
      {item.coverage?.warnings?.length ? <div className="mt-2 text-xs text-amber-700"><PagedPaths paths={item.coverage.warnings} /></div> : null}
      {item.coverage?.unreviewed_paths?.length ? <details className="mt-2"><summary className="cursor-pointer text-xs text-indigo-600">未审查文件（{item.coverage.unreviewed_paths.length}）</summary><PagedPaths paths={item.coverage.unreviewed_paths} /></details> : null}
      {showFindings && (findings.get(item.token) || []).length ? <div className="mt-3 space-y-2"><PagedFindings findings={findings.get(item.token) || []} historical /></div> : null}
    </li>)}</ol>
  </section>;
}

/** 以实例为单位读取服务端授权后的报告，执行期间自动刷新。 */
export function AiReviewReport({ instanceId, active = true }: { instanceId: string; active?: boolean }) {
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
    if (error.status === 404) return <p className="text-sm text-slate-500">当前没有可查看的 AI 审查。</p>;
    return <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
      AI 审查读取失败：{error.friendlyMessage || error.message || '请稍后重试'}
      <button type="button" className="ml-2 underline" onClick={() => void query.refetch()}>重试</button>
    </div>;
  }
  if (query.data && !Array.isArray(query.data.reviews)) return <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">AI 审查结果格式错误，请稍后重试。
    <button type="button" className="ml-2 underline" onClick={() => void query.refetch()}>重试</button>
  </div>;
  if (!query.data?.reviews.length) return <div className="space-y-4"><p className="text-sm text-slate-500">当前没有可查看的 AI 审查。</p><RemediationPanel instanceId={instanceId} reviews={[]} /></div>;
  const resultReviews = query.data.reviews.filter((review) => !['queued', 'running'].includes(review.status));
  const canViewFullReport = query.data.reviews.some((review) => review.findings !== undefined || review.history !== undefined);
  const content = <section aria-label="AI 代码审查" className="min-w-0 space-y-5 text-sm">
    <div className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><Sparkles className="h-5 w-5" strokeWidth={1.5} /></span><div><h3 className="text-[16px] font-semibold text-slate-900">AI 代码审查</h3><p className="mt-1 text-xs text-slate-500">审查结果供参考，发布仍由人工决定</p></div></div>
    {query.data.reviews.map((review) => {
      const isQueued = review.status === 'queued';
      const isRunning = review.status === 'running';
      const isCompleted = review.status === 'completed';
      const isProblem = review.status === 'failed' || review.status === 'incomplete';
      const showResults = !isQueued && !isRunning;
      const Icon = isRunning ? LoaderCircle : isQueued ? Clock3 : isCompleted ? CheckCircle2 : AlertTriangle;
      const tone = isCompleted ? 'bg-emerald-50 text-emerald-700' : isProblem ? 'bg-amber-50 text-amber-800' : 'bg-indigo-50 text-indigo-700';
      const canViewFiles = review.findings !== undefined || review.history !== undefined;
      return <article key={review.node_id} className="space-y-4 rounded-xl border border-slate-200 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone}`}><Icon className={`h-4 w-4 ${isRunning ? 'animate-spin motion-reduce:animate-none' : ''}`} strokeWidth={1.5} /></span><div><h4 className="font-semibold text-slate-800">{review.node_name ? `${review.node_name} · ` : ''}{statusText[review.status] || '审查状态未知'}</h4><p className="mt-1 text-xs text-slate-500">{isQueued ? '审查开始前，可先查看本轮待审查文件。' : isRunning ? '正在检查本轮固定的代码变更，请稍候。' : isCompleted ? '请结合变更和审查意见进行人工判断。' : isProblem ? '本轮审查未完整结束，请查看提示并处理。' : '本轮状态已记录，后续以审批流程为准。'}</p></div></div>
        </div>
        {isQueued ? <ReviewFileDirectory instanceId={instanceId} canViewFiles={canViewFiles} active={active} /> : null}
        {isRunning ? <div className="rounded-lg bg-slate-50 px-4 py-3"><p className="text-sm font-medium text-slate-700">审查进行中</p><p className="mt-1 text-xs text-slate-500">{review.coverage?.total_files === undefined || review.coverage.reviewed_files === undefined ? '正在准备审查范围…' : `已审查 ${review.coverage.reviewed_files} / ${review.coverage.total_files} 个文件${review.coverage.manifest_complete === false ? '（完整清单未知）' : ''}`}</p></div> : null}
        {showResults && review.summary ? <div className="rounded-lg bg-slate-50 px-4 py-3"><p className="text-xs font-medium text-slate-500">审查摘要</p><p className="mt-2 whitespace-pre-wrap break-words leading-6 text-slate-700">{review.summary}</p></div> : null}
        {review.status === 'skipped' && review.skip_reason ? <p className="whitespace-pre-wrap break-words text-amber-800">跳过原因：{review.skip_reason}；操作者：{review.skipped_by_name || '已删除用户'}；时间：{review.skipped_at || '未知'}</p> : null}
        {isProblem && review.coverage?.warnings?.length ? <div className="rounded-lg bg-amber-50/70 p-3 text-amber-800"><PagedPaths paths={review.coverage.warnings} /></div> : null}
        {isProblem && review.coverage?.unreviewed_paths ? <UnreviewedFileDirectory paths={review.coverage.unreviewed_paths} incomplete={review.coverage.manifest_complete === false} /> : null}
        {review.can_recover ? <RecoveryActions instanceId={instanceId} nodeId={review.node_id} /> : null}
        {!showResults && review.history?.length ? <details className="group border-t border-slate-100 pt-4"><summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] font-medium text-slate-600 hover:text-indigo-600 [&::-webkit-details-marker]:hidden"><ClipboardList className="h-4 w-4 text-slate-400" strokeWidth={1.5} />过往审查记录<ChevronDown className="ml-auto h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" strokeWidth={1.5} /></summary><ReviewHistory review={review} showFindings /></details> : null}
        {showResults ? <details className="group border-t border-slate-100 pt-4"><summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] font-medium text-slate-600 hover:text-indigo-600 [&::-webkit-details-marker]:hidden"><ClipboardList className="h-4 w-4 text-slate-400" strokeWidth={1.5} />执行详情<ChevronDown className="ml-auto h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" strokeWidth={1.5} /></summary><div className="mt-4 space-y-4">
          <section><h5 className="text-[13px] font-medium text-slate-800">覆盖情况</h5><div className="mt-2 rounded-lg bg-slate-50 px-3 py-3"><p className="text-[13px] text-slate-700">覆盖范围：{review.coverage?.total_files === undefined || review.coverage.reviewed_files === undefined ? '尚未统计' : review.coverage.manifest_complete === false ? `已知 ${review.coverage.reviewed_files} / ${review.coverage.total_files} 个文件（完整清单未知）` : `${review.coverage.reviewed_files} / ${review.coverage.total_files} 个文件`}</p>{review.dimensions?.length ? <p className="mt-1 break-words text-xs text-slate-500">已完成批次共同维度：{review.dimensions.join('、')}</p> : null}</div>
          {!isProblem && review.coverage?.warnings?.length ? <div className="mt-2 text-xs text-amber-700"><PagedPaths paths={review.coverage.warnings} /></div> : null}
          {review.coverage?.reviewed_paths ? <details className="mt-3"><summary className="cursor-pointer text-xs text-indigo-600">已审查文件</summary><PagedPaths paths={review.coverage.reviewed_paths} /></details> : null}
          {!isProblem && review.coverage?.unreviewed_paths ? <details className="mt-2"><summary className="cursor-pointer text-xs text-amber-700">未审查文件</summary><PagedPaths paths={review.coverage.unreviewed_paths} /></details> : null}</section>
          {review.coverage?.batches?.length ? <BatchProgress batches={review.coverage.batches} /> : null}
          {review.configuration ? <section className="border-t border-slate-100 pt-4"><h5 className="text-[13px] font-medium text-slate-800">本轮审查配置</h5><div className="mt-2 grid gap-x-6 gap-y-2 rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-600 sm:grid-cols-2"><p className="break-all">模型：{review.configuration.model}（{review.configuration.protocol}）</p><p className="break-all">配置版本：{review.configuration.version_id}</p><p className="break-all">技能：{review.configuration.skill.name} · {review.configuration.skill.revision}</p>{review.configuration.skill.source ? <a href={review.configuration.skill.source} target="_blank" rel="noreferrer" className="break-all text-indigo-600 underline">查看技能来源</a> : <p>技能来源：管理员上传</p>}</div></section> : null}
          <ReviewHistory review={review} />
        </div></details> : null}
      </article>;
    })}
    {resultReviews.length ? <ReviewDiff instanceId={instanceId} reviews={resultReviews} active={active} /> : null}
    {canViewFullReport ? <RemediationPanel instanceId={instanceId} reviews={query.data.reviews} showCandidates={false} /> : null}
  </section>;
  return canViewFullReport ? <ReviewRemediations instanceId={instanceId}>{content}</ReviewRemediations> : content;
}
