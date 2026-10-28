import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from 'antd';
import { Link } from 'react-router-dom';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { workflowApi } from '@/api/workflow';
import type { AiReviewData, AiReviewFinding, RemediationAction, ReviewRemediation } from '@/api/workflow';
import type { NormalizedError } from '@/api/request';
import { useAuthStore } from '@/stores/authStore';
import { uniqueHistoryFindings } from './reviewFindings';

const statusText: Record<ReviewRemediation['status'], string> = {
  pending_fix: '已采纳，待修复', pending_review: '已提交修复说明，待复核', resolved: '已处理', dismissed: '不采纳',
};
const actionText: Record<string, string> = { adopt: '采纳', fix: '提交修复说明', resolve: '确认已处理', dismiss: '改为不采纳' };

function FindingContent({ finding }: { finding: AiReviewFinding }) {
  const side = finding.side === 'old' ? '旧侧' : '新侧';
  return <div className="min-w-0 space-y-1">
    <p className="font-semibold break-words"><span className="mr-2 text-xs text-amber-700">{finding.severity}</span>{finding.title}</p>
    <p className="break-all font-mono text-xs text-slate-500">{finding.path ? `${finding.path}${finding.side && finding.line_start ? ` · ${side} ${finding.line_start}${finding.line_end && finding.line_end !== finding.line_start ? `–${finding.line_end}` : ''} 行` : ' · 文件级意见'}` : '整体意见'}</p>
    <div className="whitespace-pre-wrap break-words [&_pre]:overflow-x-auto"><Markdown remarkPlugins={[remarkGfm]}>{finding.reason}</Markdown></div>
    {finding.suggestion ? <div className="whitespace-pre-wrap break-words text-slate-600 [&_pre]:overflow-x-auto">建议：<Markdown remarkPlugins={[remarkGfm]}>{finding.suggestion}</Markdown></div> : null}
  </div>;
}

function RemediationCard({ item, pending, onAction }: { item: ReviewRemediation; pending: boolean; onAction: (action: RemediationAction) => void }) {
  const [fix, setFix] = useState('');
  const [reason, setReason] = useState('');
  const [showDismiss, setShowDismiss] = useState(false);
  return <article className="min-w-0 space-y-3 rounded-lg border border-slate-200 p-3" aria-label={`整改项：${item.finding.title}`}>
    <FindingContent finding={item.finding} />
    <p className="break-all text-xs text-slate-500">来源轮次：<Link className="text-indigo-700 underline" to={`/workflows/${item.instance_id}`}>{item.instance_id}</Link> · 节点：{item.node_id}</p>
    {item.source_git_hash || item.source_token ? <p className="break-all font-mono text-xs text-slate-500">原提交：{item.source_git_hash || '未知'} · 执行：{item.source_token || '未知'}</p> : null}
    <p className="font-medium text-indigo-700">{statusText[item.status] || '状态未知'}</p>
    {item.fix_note ? <p className="whitespace-pre-wrap break-words">修复说明：{item.fix_note}</p> : null}
    {item.can_fix && (item.status === 'pending_fix' || item.status === 'pending_review') ? <div className="space-y-2">
      <label className="block">修复说明<textarea value={fix} maxLength={4000} onChange={(event) => setFix(event.target.value)} rows={3} className="mt-1 block w-full rounded-lg border border-indigo-100 bg-white px-3 py-2.5 text-[13px] text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" /></label>
      <Button type="primary" disabled={pending || !fix.trim()} onClick={() => onAction({ action: 'fix', id: item.id, comment: fix })}>提交修复说明</Button>
    </div> : null}
    {item.can_review && (item.status === 'pending_fix' || item.status === 'pending_review') ? <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {item.status === 'pending_review' ? <Button type="primary" disabled={pending} onClick={() => onAction({ action: 'resolve', id: item.id, comment: '' })}>确认已处理</Button> : null}
        <Button disabled={pending} onClick={() => setShowDismiss(!showDismiss)}>改为不采纳</Button>
      </div>
      {showDismiss ? <div className="space-y-2">
        <label className="block">不采纳理由<textarea value={reason} maxLength={4000} onChange={(event) => setReason(event.target.value)} rows={3} className="mt-1 block w-full rounded-lg border border-indigo-100 bg-white px-3 py-2.5 text-[13px] text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" /></label>
        <Button type="primary" disabled={pending || !reason.trim()} onClick={() => onAction({ action: 'dismiss', id: item.id, comment: reason })}>确认不采纳</Button>
      </div> : null}
    </div> : null}
    {item.history?.length ? <details><summary className="cursor-pointer text-slate-600">处置历史</summary><ol className="mt-2 space-y-1 text-xs text-slate-600">
      {item.history.map((entry, index) => <li key={`${entry.at}:${index}`} className="whitespace-pre-wrap break-words">{actionText[entry.action] || entry.action} · {entry.actor_name || '已删除用户'} · {entry.at}{entry.comment ? `：${entry.comment}` : ''}{entry.instance_id ? ` · 轮次：${entry.instance_id}` : ''}{entry.node_id ? ` · 节点：${entry.node_id}` : ''}{entry.git_hash ? ` · 提交：${entry.git_hash}` : ''}</li>)}
    </ol></details> : null}
  </article>;
}

/** 账号变化时卸载旧表单和查询，防止旧账号数据留在界面。 */
export function RemediationPanel({ instanceId, reviews }: { instanceId: string; reviews: AiReviewData[] }) {
  const sessionVersion = useAuthStore((state) => state.sessionVersion);
  return <RemediationPanelContent key={`${instanceId}:${sessionVersion}`} instanceId={instanceId} reviews={reviews} sessionVersion={sessionVersion} />;
}

function RemediationPanelContent({ instanceId, reviews, sessionVersion }: { instanceId: string; reviews: AiReviewData[]; sessionVersion: number }) {
  const client = useQueryClient();
  const [error, setError] = useState('');
  const [itemPage, setItemPage] = useState(0);
  const [candidatePage, setCandidatePage] = useState(0);
  const query = useQuery({ queryKey: ['review-remediations', instanceId, sessionVersion], queryFn: () => workflowApi.getRemediations(instanceId), retry: false, gcTime: 0 });
  const mutation = useMutation({
    mutationFn: (data: RemediationAction) => workflowApi.actOnRemediation(instanceId, data),
    onSuccess: async () => {
      setError('');
      await Promise.all([
        client.invalidateQueries({ queryKey: ['review-remediations', instanceId] }),
        client.invalidateQueries({ queryKey: ['workflow-instance-for-detail', instanceId] }),
      ]);
    },
    onError: (failure: NormalizedError) => setError(failure.friendlyMessage || failure.message || '操作失败，请重试'),
  });
  if (query.isLoading || (query.isFetching && !query.isFetchedAfterMount)) return <p className="text-slate-500">正在读取整改项…</p>;
  if (query.error) {
    const failure = query.error as unknown as NormalizedError;
    if (failure.status === 403 || failure.status === 404) return null;
    return <div role="alert" className="rounded bg-rose-50 p-3 text-rose-700">整改项读取失败：{failure.friendlyMessage || failure.message || '请稍后重试'} <button type="button" className="underline" onClick={() => void query.refetch()}>重试</button></div>;
  }
  if (!query.data) return null;
  const { items, can_adopt: canAdopt } = query.data;
  const adopted = new Set(items.filter((item) => item.instance_id === instanceId).map((item) => `${item.node_id}:${item.finding_id}`));
  const candidates = reviews.flatMap((review) => {
    const history = uniqueHistoryFindings(review);
    const findings = [...(review.findings || []), ...(review.history || []).flatMap((attempt) => history.get(attempt.token) || [])];
    return findings.filter((finding) => finding.id && !adopted.has(`${review.node_id}:${finding.id}`))
      .map((finding) => ({ nodeId: review.node_id, finding }));
  });
  if (!items.length && (!canAdopt || !candidates.length)) return null;
  const submit = (action: RemediationAction) => { setError(''); mutation.mutate(action); };
  const pageSize = 20;
  const itemLastPage = Math.max(0, Math.ceil(items.length / pageSize) - 1);
  const candidateLastPage = Math.max(0, Math.ceil(candidates.length / pageSize) - 1);
  const safeItemPage = Math.min(itemPage, itemLastPage);
  const safeCandidatePage = Math.min(candidatePage, candidateLastPage);
  return <section aria-label="代码审查整改" className="space-y-3 border-t border-slate-200 pt-4">
    <h4 className="font-semibold text-slate-800">代码审查整改</h4>
    <p className="text-xs text-slate-500">采纳后须提交修复说明并经审批人复核；未完成复核的整改项会阻止批准。</p>
    {error ? <p role="alert" className="rounded bg-rose-50 p-2 text-rose-700">{error}</p> : null}
    {items.slice(safeItemPage * pageSize, (safeItemPage + 1) * pageSize).map((item) => <RemediationCard key={item.id} item={item} pending={mutation.isPending} onAction={submit} />)}
    {itemLastPage > 0 ? <div className="flex items-center gap-2 text-xs text-slate-600"><button type="button" disabled={safeItemPage === 0} onClick={() => setItemPage(safeItemPage - 1)} className="underline disabled:opacity-40">整改上一页</button><span>{safeItemPage + 1} / {itemLastPage + 1}</span><button type="button" disabled={safeItemPage === itemLastPage} onClick={() => setItemPage(safeItemPage + 1)} className="underline disabled:opacity-40">整改下一页</button></div> : null}
    {canAdopt && candidates.length ? <details><summary className="cursor-pointer text-indigo-700">采纳审查意见</summary><div className="mt-2 space-y-2">
      {candidates.slice(safeCandidatePage * pageSize, (safeCandidatePage + 1) * pageSize).map(({ nodeId, finding }) => <div key={`${nodeId}:${finding.id}`} className="space-y-2 rounded border border-slate-200 p-3">
        <FindingContent finding={finding} />
        <Button aria-label={`采纳：${finding.title}`} disabled={mutation.isPending} onClick={() => submit({ action: 'adopt', node_id: nodeId, finding_id: finding.id! })}>采纳并标记待修复</Button>
      </div>)}
      {candidateLastPage > 0 ? <div className="flex items-center gap-2 text-xs text-slate-600"><button type="button" disabled={safeCandidatePage === 0} onClick={() => setCandidatePage(safeCandidatePage - 1)} className="underline disabled:opacity-40">待采纳上一页</button><span>{safeCandidatePage + 1} / {candidateLastPage + 1}</span><button type="button" disabled={safeCandidatePage === candidateLastPage} onClick={() => setCandidatePage(safeCandidatePage + 1)} className="underline disabled:opacity-40">待采纳下一页</button></div> : null}
    </div></details> : null}
  </section>;
}
