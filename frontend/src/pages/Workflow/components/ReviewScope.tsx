import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, FileText, GitBranch, GitCommitHorizontal } from 'lucide-react';
import { workflowApi } from '@/api/workflow';
import type { NormalizedError } from '@/api/request';
import { useAuthStore } from '@/stores/authStore';

const statusText = {
  first_release: '首次发布，跳过 AI 审查',
  no_changes: '无代码变更',
  incomplete: '范围未完整取得',
  ready: '固定范围已就绪',
};

/** 根据实例 ID 读取本轮快照，不跟随发布草稿后续变化。 */
export function ReviewScope({ instanceId }: { instanceId: string }) {
  const sessionVersion = useAuthStore((state) => state.sessionVersion);
  const scope = useQuery({
    queryKey: ['review-scope', instanceId, sessionVersion],
    queryFn: () => workflowApi.getReviewScope(instanceId),
    retry: false,
    gcTime: 0,
  });
  if (scope.isFetching) return <p className="text-sm text-slate-500">正在读取审查范围…</p>;
  if (scope.error) {
    const error = scope.error as unknown as NormalizedError;
    if (error.status === 404) return <p className="text-sm text-slate-500">当前没有可查看的审查范围。</p>;
    return <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
      审查范围读取失败：{error.friendlyMessage || error.message || '请稍后重试'}
      <button type="button" className="ml-2 underline" onClick={() => void scope.refetch()}>重试</button>
    </div>;
  }
  if (!scope.data) return null;
  const data = scope.data;
  const hasContext = data.context_is_requirement !== undefined || data.context !== undefined || data.documents !== undefined;
  const documents = Object.entries(data.documents || {});
  return <section aria-label="本轮审查范围" className="min-w-0 space-y-6 text-sm">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><GitBranch className="h-5 w-5" strokeWidth={1.5} /></span><div><h3 className="text-[16px] font-semibold text-slate-900">本轮审查范围</h3><p className="mt-1 text-xs leading-5 text-slate-500">使用提审时固定的提交快照，分支后续变化不会改变本轮范围。</p></div></div><span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium max-md:text-xs ${data.status === 'incomplete' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{statusText[data.status] ?? '审查范围状态未知'}</span></div>
    {data.warnings?.length ? <div className="flex gap-2 rounded-lg border border-amber-100 bg-amber-50/60 p-3 text-xs text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} /><ul className="min-w-0 space-y-1">{data.warnings.map((warning, index) => <li key={`${index}:${warning}`} className="break-words">{warning}</li>)}</ul></div> : null}
    <div><div className="mb-3 flex items-center justify-between gap-2"><h4 className="font-medium text-slate-800">提交范围</h4><span className="text-xs text-slate-400">固定快照</span></div>
      <div className="grid gap-3 sm:grid-cols-2"><div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/60 p-4"><div className="flex items-center gap-2 text-xs font-medium text-slate-500"><GitBranch className="h-4 w-4" strokeWidth={1.5} />起点 · 基线版本</div><dl className="mt-3 space-y-3"><div><dt className="text-xs text-slate-400">基线 Tag</dt><dd className="mt-1 break-all font-medium text-slate-800">{data.base_tag || (data.status === 'first_release' ? '首次发布，无基线' : '未提供')}</dd></div>{data.base_git_hash ? <div><dt className="text-xs text-slate-400">基线提交</dt><dd className="mt-1 break-all font-mono text-xs leading-5 text-slate-600">{data.base_git_hash}</dd></div> : null}</dl></div>
        <div className="min-w-0 rounded-xl border border-indigo-100 bg-indigo-50/30 p-4"><div className="flex items-center gap-2 text-xs font-medium text-indigo-600"><GitCommitHorizontal className="h-4 w-4" strokeWidth={1.5} />终点 · 本次发布</div><dl className="mt-3"><dt className="text-xs text-slate-400">目标提交</dt><dd className="mt-1 break-all font-mono text-xs leading-5 text-slate-700">{data.head_git_hash || '未提供'}</dd></dl></div></div>
    </div>
    {hasContext ? <section className="border-t border-slate-100 pt-5"><h4 className="font-medium text-slate-800">审查依据</h4><div className="mt-3 space-y-3">
      {data.context_is_requirement === true ? <p className="text-xs text-slate-600">本轮已标记包含真实需求依据</p> : data.context_is_requirement === false ? <p className="text-xs text-slate-500">本轮未标记真实需求依据</p> : null}
      {data.context !== undefined ? <div className="rounded-lg bg-slate-50 px-4 py-3"><h5 className="text-xs font-medium text-slate-500">补充审查说明</h5><p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-6 text-slate-700">{data.context || '未填写'}</p></div> : null}
      {data.documents !== undefined ? <div><div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-500"><FileText className="h-4 w-4" strokeWidth={1.5} />参考文档 <span className="font-normal text-slate-400">{documents.length} 份</span></div>{documents.length ? <div className="space-y-2">{documents.map(([path, content]) => <details key={path} className="group overflow-hidden rounded-lg border border-slate-200"><summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-3 [&::-webkit-details-marker]:hidden"><span className="min-w-0 flex-1 break-all font-mono text-xs text-slate-700">{path}</span><ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" strokeWidth={1.5} /></summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-slate-100 bg-slate-50/70 p-3 font-mono text-xs leading-5 text-slate-600">{content}</pre></details>)}</div> : <p className="rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-400">未提供参考文档</p>}</div> : null}
    </div></section> : null}
  </section>;
}
