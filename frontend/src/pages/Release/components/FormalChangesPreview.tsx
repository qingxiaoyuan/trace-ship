import { useQuery } from '@tanstack/react-query';
import { releaseApi } from '@/api/release';
import type { Release } from '@/types';

/** 只读区间预览；查询键绑定发布身份，避免重选后显示旧结果。 */
export function FormalChangesPreview({ release, active = true }: { release: Release; active?: boolean }) {
  const query = useQuery({
    queryKey: ['formal-changes', release.id, release.source_rc, release.version, release.base_git_hash, release.changes_initialized],
    queryFn: () => releaseApi.getFormalChanges(release.id),
    enabled: active && release.release_type === 'formal' && !!release.source_rc,
    retry: false,
  });
  if (release.release_type !== 'formal' || !release.source_rc) return null;
  const data = query.data;
  return <section className="space-y-2 rounded-lg border border-slate-200 p-3 text-left text-[13px]" aria-label="正式累计变更">
    <p className="font-medium">正式累计变更</p>
    {!release.changes_initialized ? <p className="text-slate-500">首次生成说明时固定基线；下方为当前预览。</p> : null}
    {query.isFetching ? <p>正在核验累计变更…</p> : null}
    {query.error ? <div role="alert" className="text-red-700">
      <p>{query.error.message || '获取变更失败，请重试'}</p>
      <button type="button" className="min-h-9 underline" onClick={() => void query.refetch()}>重试预览</button>
    </div> : data ? <>
      <p>正式基线：<span>{data.base_tag || '无'}</span></p>
      <p className="break-all font-mono text-xs">{data.base_git_hash || '无基线'} → {data.head_hash}</p>
      {data.first_release ? <p>首次正式发布：截至来源提交的全部可达历史</p> : null}
      {data.no_changes ? <p>无新增代码：来源提交与上一正式版相同</p> : null}
      {data.warnings.map((warning) => <p key={warning} className="text-amber-700">{warning}</p>)}
      <details>
        <summary className="min-h-9 cursor-pointer py-2">查看 {data.commits.length} 条提交和 {data.merge_requests.length} 条 MR</summary>
        <ul className="max-h-72 space-y-2 overflow-auto break-all">
          {data.commits.map((commit) => <li key={commit.hash}><code>{commit.hash.slice(0, 12)}</code> · {commit.message}</li>)}
          {data.merge_requests.map((mr) => <li key={`mr-${mr.number}`}>!{mr.number} · <span>{mr.title}</span></li>)}
        </ul>
      </details>
    </> : null}
  </section>;
}
