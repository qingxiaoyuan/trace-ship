import { ReviewMarkdown } from './ReviewMarkdown';
import { useState } from 'react';
import { Button } from 'antd';
import { ChevronDown, Clock3, FileCheck2, History, ListChecks } from 'lucide-react';
import dayjs from 'dayjs';
import { Link } from 'react-router-dom';
import type { AiReviewData, AiReviewFinding, RemediationAction, ReviewRemediation } from '@/api/workflow';
import type { NormalizedError } from '@/api/request';
import { uniqueHistoryFindings } from './reviewFindings';

import { ReviewRemediations } from './ReviewRemediations';
import { useReviewRemediations, REMEDIATION_PAGE_SIZE, remediationStatusText as statusText } from './useReviewRemediations';

const actionText: Record<string, string> = { adopt: '采纳', fix: '提交修复说明', resolve: '确认已处理', dismiss: '改为不采纳' };

function FindingLocation({ finding }: { finding: AiReviewFinding }) {
  return <p className="break-all font-mono text-[11px] leading-5 text-slate-400">{finding.path ? `${finding.path}${finding.side && finding.line_start ? ` · ${finding.side === 'old' ? '旧侧' : '新侧'} ${finding.line_start}${finding.line_end && finding.line_end !== finding.line_start ? `–${finding.line_end}` : ''} 行` : ' · 文件级意见'}` : '整体意见'}</p>;
}

function FindingDescription({ finding }: { finding: AiReviewFinding }) {
  return <div className="min-w-0 space-y-3 text-[13px] leading-6 text-slate-600">
    <div className="whitespace-pre-wrap break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto"><ReviewMarkdown>{finding.reason}</ReviewMarkdown></div>
    {finding.suggestion ? <div className="rounded-lg bg-slate-50 px-3 py-2.5"><p className="mb-1 text-[11px] font-medium text-slate-400">修改建议</p><div className="whitespace-pre-wrap break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto"><ReviewMarkdown>{finding.suggestion}</ReviewMarkdown></div></div> : null}
  </div>;
}

function FindingContent({ finding }: { finding: AiReviewFinding }) {
  return <div className="min-w-0 space-y-2"><p className="break-words font-semibold text-slate-800"><span className="mr-2 text-xs text-amber-700">{finding.severity}</span>{finding.title}</p><FindingLocation finding={finding} /><FindingDescription finding={finding} /></div>;
}

const statusTone: Record<ReviewRemediation['status'], string> = {
  pending_fix: 'border-amber-200 bg-amber-50 text-amber-800', pending_review: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  resolved: 'border-emerald-200 bg-emerald-50 text-emerald-700', dismissed: 'border-slate-200 bg-slate-100 text-slate-500',
};

function RemediationCard({ item, pending, onAction }: { item: ReviewRemediation; pending: boolean; onAction: (action: RemediationAction) => void }) {
  const [fix, setFix] = useState('');
  const [reason, setReason] = useState('');
  const [showDismiss, setShowDismiss] = useState(false);
  const open = item.status === 'pending_fix' || item.status === 'pending_review';
  const severityTone = item.finding.severity === 'P0' || item.finding.severity === 'P1' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700';
  return <article id={`remediation-${item.id}`} className="scroll-mt-20 min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white" aria-label={`整改项：${item.finding.title}`}>
    <header className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
      <div className="min-w-0 flex-1 space-y-2 max-sm:basis-full"><div className="flex items-start gap-2"><span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${severityTone}`}>{item.finding.severity}</span><h5 className="break-words text-sm font-semibold leading-6 text-slate-900">{item.finding.title}</h5></div><FindingLocation finding={item.finding} /></div>
      <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusTone[item.status]}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{statusText[item.status] || '状态未知'}</span>
    </header>
    <div className="space-y-4 px-4 py-4 sm:px-5">
      <FindingDescription finding={item.finding} />
      {item.fix_note ? <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-3"><p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-indigo-700"><FileCheck2 className="h-3.5 w-3.5" strokeWidth={1.5} />已提交的修复说明</p><p className="whitespace-pre-wrap break-words text-[13px] leading-6 text-slate-700">{item.fix_note}</p></div> : null}
    </div>
    {open ? <div className="space-y-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:px-5">
      <p className="flex items-start gap-2 text-xs leading-5 text-slate-500"><Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />{item.status === 'pending_review' ? '修复说明已提交，等待审批人核对代码并确认。' : item.can_fix ? '完成代码修改后，提交修复说明供审批人复核。' : '等待开发者提交修复说明，随后由审批人复核。'}</p>
      {item.can_fix ? <div className="space-y-2">
        <label className="block text-xs font-medium text-slate-600">修复说明<textarea value={fix} maxLength={4000} onChange={(event) => setFix(event.target.value)} rows={3} placeholder="说明修改内容及验证结果，便于审批人复核" className="mt-2 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[13px] font-normal text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" /></label>
        <Button type="primary" className="max-md:min-h-9" disabled={pending || !fix.trim()} onClick={() => onAction({ action: 'fix', id: item.id, comment: fix })}>提交修复说明</Button>
      </div> : null}
      {item.can_review ? <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {item.status === 'pending_review' ? <Button type="primary" className="max-md:min-h-9" disabled={pending} onClick={() => onAction({ action: 'resolve', id: item.id, comment: '' })}>确认已处理</Button> : null}
          <Button className="max-md:min-h-9" disabled={pending} onClick={() => setShowDismiss(!showDismiss)}>改为不采纳</Button>
        </div>
        {showDismiss ? <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
          <label className="block text-xs font-medium text-slate-600">不采纳理由<textarea value={reason} maxLength={4000} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="请说明误报、已有保护或其他不采纳原因" className="mt-2 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[13px] font-normal text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" /></label>
          <Button type="primary" className="max-md:min-h-9" disabled={pending || !reason.trim()} onClick={() => onAction({ action: 'dismiss', id: item.id, comment: reason })}>确认不采纳</Button>
        </div> : null}
      </div> : null}
    </div> : null}
    <details className="group border-t border-slate-100 px-4 sm:px-5">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-2 text-xs text-slate-400 transition-colors hover:text-indigo-600 [&::-webkit-details-marker]:hidden"><History className="h-3.5 w-3.5" strokeWidth={1.5} /><span>来源与处置记录</span><span className="ml-auto flex items-center gap-2">{item.history?.length ? `${item.history.length} 条记录` : '查看来源'}<ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" strokeWidth={1.5} /></span></summary>
      <div className="space-y-4 pb-4">
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-lg bg-slate-50 p-3 text-[11px] leading-5 text-slate-500">
          <dt className="text-slate-400">来源审批</dt><dd><Link className="inline-flex min-h-9 items-center text-indigo-600 underline underline-offset-2" to={`/workflows/${item.instance_id}`}>查看原审批记录</Link></dd>
          <dt className="text-slate-400">审查提交</dt><dd className="select-all break-all font-mono">{item.source_git_hash || '未记录'}</dd>
          <dt className="text-slate-400">节点标识</dt><dd className="break-all font-mono">{item.node_id}</dd>
          {item.source_token ? <><dt className="text-slate-400">执行标识</dt><dd className="break-all font-mono">{item.source_token}</dd></> : null}
          <dt className="text-slate-400">审批标识</dt><dd className="break-all font-mono">{item.instance_id}</dd>
        </dl>
        {item.history?.length ? <div><p className="mb-3 text-xs font-medium text-slate-500">处置历史</p><ol className="ml-1.5 border-l border-slate-200 pl-4">
          {item.history.map((entry, index) => <li key={`${entry.at}:${index}`} className="relative pb-4 last:pb-0"><span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full border-2 border-white bg-indigo-300 ring-1 ring-slate-200" />
            <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="text-xs font-medium text-slate-700">{actionText[entry.action] || entry.action} · {entry.actor_name || '已删除用户'}</p><time dateTime={entry.at} title={entry.at} className="text-[11px] text-slate-400">{dayjs(entry.at).isValid() ? dayjs(entry.at).format('YYYY-MM-DD HH:mm') : entry.at}</time></div>
            {entry.comment ? <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-6 text-slate-600">{entry.comment}</p> : null}
            {entry.instance_id || entry.node_id || entry.git_hash ? <p className="mt-1.5 break-all font-mono text-[10px] leading-5 text-slate-400">{entry.instance_id ? `轮次：${entry.instance_id}` : ''}{entry.node_id ? ` · 节点：${entry.node_id}` : ''}{entry.git_hash ? ` · 提交：${entry.git_hash}` : ''}</p> : null}
          </li>)}
        </ol></div> : null}
      </div>
    </details>
  </article>;
}

/** 独立页面与行内评论共用整改状态；旧轮无 AI 节点时仍可复核跨轮整改。 */
export function RemediationPanel({ instanceId, reviews, showCandidates = true }: { instanceId: string; reviews: AiReviewData[]; showCandidates?: boolean }) {
  const state = useReviewRemediations();
  if (!state) return <ReviewRemediations instanceId={instanceId}><RemediationPanelContent reviews={reviews} showCandidates={showCandidates} /></ReviewRemediations>;
  return <RemediationPanelContent reviews={reviews} showCandidates={showCandidates} />;
}

function RemediationPanelContent({ reviews, showCandidates }: { reviews: AiReviewData[]; showCandidates: boolean }) {
  const { instanceId, query, error, pending, submit, itemPage, setItemPage } = useReviewRemediations()!;
  const [candidatePage, setCandidatePage] = useState(0);
  if (query.isLoading || (query.isFetching && !query.isFetchedAfterMount)) return <p className="text-slate-500">正在读取整改项…</p>;
  if (query.error) {
    const failure = query.error as unknown as NormalizedError;
    if (failure.status === 403 || failure.status === 404) return null;
    return <div role="alert" className="rounded bg-rose-50 p-3 text-rose-700">整改项读取失败：{failure.friendlyMessage || failure.message || '请稍后重试'} <button type="button" className="underline" onClick={() => void query.refetch()}>重试</button></div>;
  }
  if (!query.data) return null;
  const { items, can_adopt: canAdopt } = query.data;
  const adopted = new Set(items.filter((item) => item.instance_id === instanceId).map((item) => `${item.node_id}:${item.finding_id}`));
  const candidates = (showCandidates ? reviews : []).flatMap((review) => {
    const history = uniqueHistoryFindings(review);
    const findings = [...(review.findings || []), ...(review.history || []).flatMap((attempt) => history.get(attempt.token) || [])];
    return findings.filter((finding) => finding.id && !adopted.has(`${review.node_id}:${finding.id}`))
      .map((finding) => ({ nodeId: review.node_id, finding }));
  });
  if (!items.length && (!canAdopt || !candidates.length) && !error) return null;
  const pageSize = REMEDIATION_PAGE_SIZE;
  const itemLastPage = Math.max(0, Math.ceil(items.length / pageSize) - 1);
  const candidateLastPage = Math.max(0, Math.ceil(candidates.length / pageSize) - 1);
  const safeItemPage = Math.min(itemPage, itemLastPage);
  const safeCandidatePage = Math.min(candidatePage, candidateLastPage);
  return <section aria-label="代码审查整改" className="space-y-3 border-t border-slate-200 pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="flex items-center gap-2 font-semibold text-slate-800"><ListChecks className="h-4 w-4 text-slate-400" strokeWidth={1.5} />代码审查整改</h4>{items.length ? <span className="text-xs text-slate-400">{items.length} 项 · {items.filter(item => item.status === 'pending_fix' || item.status === 'pending_review').length} 项待处理</span> : null}</div>
    <p className="text-xs text-slate-500">采纳后须提交修复说明并经审批人复核；未完成复核的整改项会阻止批准。</p>
    {error ? <p role="alert" className="rounded bg-rose-50 p-2 text-rose-700">{error}</p> : null}
    {items.slice(safeItemPage * pageSize, (safeItemPage + 1) * pageSize).map((item) => <RemediationCard key={item.id} item={item} pending={pending} onAction={submit} />)}
    {itemLastPage > 0 ? <div className="flex items-center gap-2 text-xs text-slate-600"><button type="button" disabled={safeItemPage === 0} onClick={() => setItemPage(safeItemPage - 1)} className="min-h-9 px-2 underline disabled:opacity-40">整改上一页</button><span>{safeItemPage + 1} / {itemLastPage + 1}</span><button type="button" disabled={safeItemPage === itemLastPage} onClick={() => setItemPage(safeItemPage + 1)} className="min-h-9 px-2 underline disabled:opacity-40">整改下一页</button></div> : null}
    {canAdopt && candidates.length ? <details><summary className="cursor-pointer text-indigo-700">采纳审查意见</summary><div className="mt-2 space-y-2">
      {candidates.slice(safeCandidatePage * pageSize, (safeCandidatePage + 1) * pageSize).map(({ nodeId, finding }) => <div key={`${nodeId}:${finding.id}`} className="space-y-2 rounded border border-slate-200 p-3">
        <FindingContent finding={finding} />
        <Button aria-label={`采纳：${finding.title}`} disabled={pending} onClick={() => submit({ action: 'adopt', node_id: nodeId, finding_id: finding.id! })}>采纳并标记待修复</Button>
      </div>)}
      {candidateLastPage > 0 ? <div className="flex items-center gap-2 text-xs text-slate-600"><button type="button" disabled={safeCandidatePage === 0} onClick={() => setCandidatePage(safeCandidatePage - 1)} className="min-h-9 px-2 underline disabled:opacity-40">待采纳上一页</button><span>{safeCandidatePage + 1} / {candidateLastPage + 1}</span><button type="button" disabled={safeCandidatePage === candidateLastPage} onClick={() => setCandidatePage(safeCandidatePage + 1)} className="min-h-9 px-2 underline disabled:opacity-40">待采纳下一页</button></div> : null}
    </div></details> : null}
  </section>;
}
