import { useQuery } from '@tanstack/react-query';
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
  return <section aria-label="本轮审查范围" className="space-y-4 text-sm">
    <div><h3 className="text-[16px] font-semibold text-slate-900">本轮审查范围</h3><p className="mt-1 text-xs leading-5 text-slate-500">基于提审时固定的提交快照，分支后续变化不会改变本轮范围。</p></div>
    <p className="text-slate-700">{statusText[data.status] ?? '审查范围状态未知'}</p>
    <dl className="grid gap-3 rounded-lg border border-slate-100 bg-slate-50/70 p-4 sm:grid-cols-3">
      <div><dt className="text-slate-500">基线 Tag</dt><dd className="break-all font-mono">{data.base_tag || '首次发布，无基线'}</dd></div>
      {data.base_git_hash ? <div><dt className="text-slate-500">基线提交</dt><dd className="break-all font-mono">{data.base_git_hash}</dd></div> : null}
      <div><dt className="text-slate-500">目标提交</dt><dd className="break-all font-mono">{data.head_git_hash || '未提供'}</dd></div>
    </dl>
    {data.warnings?.length ? <ul className="list-inside list-disc text-amber-700">{data.warnings.map((warning, index) => <li key={`${index}:${warning}`}>{warning}</li>)}</ul> : null}
    {data.context_is_requirement === true ? <p className="text-slate-600">本轮已标记包含真实需求依据</p> : data.context_is_requirement === false ? <p className="text-slate-600">本轮未标记真实需求依据</p> : null}
    {data.context ? <div><h4 className="font-medium">补充审查说明</h4><p className="mt-1 whitespace-pre-wrap break-words">{data.context}</p></div> : null}
    {data.documents && Object.entries(data.documents).map(([path, content]) => <details key={path} className="rounded-lg border border-slate-200 p-3">
      <summary className="cursor-pointer break-all font-mono">{path}</summary>
      <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{content}</pre>
    </details>)}
  </section>;
}
