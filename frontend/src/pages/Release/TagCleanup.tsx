import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { projectApi } from '@/api/project';
import { releaseApi, type CleanupResult } from '@/api/release';

const statusLabel: Record<string, string> = {
  success: '清理成功', already_cleaned: '已清理', external_missing: '远端已缺失',
  reconciled_missing: '对账确认缺失', blocked: '已阻止', failure: '失败',
};
const successful = (status: string) => ['success', 'already_cleaned', 'external_missing', 'reconciled_missing'].includes(status);

export default function TagCleanup() {
  const [params] = useSearchParams();
  const [project, setProject] = useState(params.get('project') || '');
  const [repository, setRepository] = useState(params.get('repository') || '');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<{ id: string; tag_name: string }[] | null>(null);
  const [results, setResults] = useState<CleanupResult[]>([]);
  const projects = useQuery({queryKey: ['projects', 'cleanup'], queryFn: () => projectApi.getProjects({page_size: 1000})});
  const components = useQuery({queryKey: ['project-components', project], queryFn: () => projectApi.getComponents(project), enabled: !!project});
  const candidates = useQuery({queryKey: ['cleanup-candidates', project, repository, page],
    queryFn: () => releaseApi.getCleanupCandidates({project, repository, page, page_size: 20}), enabled: !!project && !!repository, retry: false});
  const rows = candidates.data?.results || [];
  const clean = useMutation({mutationFn: releaseApi.cleanupTags, onSuccess: (response, submitted) => {
    const data = response.map(item => ({...item, tag_name: item.tag_name || submitted.find(input => input.id === item.id)?.tag_name}));
    setResults(previous => [...previous.filter(old => !data.some(item => item.id === old.id)), ...data]);
    setConfirmation(null); setSelected([]); void candidates.refetch();
  }});
  const resetSelection = () => { setPage(1); setSelected([]); setResults([]); setConfirmation(null); };
  return <div className="mx-auto max-w-5xl space-y-4 pb-28">
    <Link to="/releases" className="text-sm text-indigo-600">返回发布看板</Link>
    <h1 className="text-xl font-semibold">RC Tag 清理</h1>
    <p className="text-sm text-slate-500">保留发布历史、说明、审批和打包记录。仅有有效正式引用保护的 RC 可清理。</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="min-w-0 text-sm">项目<select aria-label="项目" className="mt-1 min-h-10 w-full rounded border p-2" value={project} disabled={clean.isPending} onChange={e=>{setProject(e.target.value);setRepository('');resetSelection();}}>
        <option value="">选择项目</option>{projects.data?.results.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
      <label className="min-w-0 text-sm">仓库<select aria-label="仓库" className="mt-1 min-h-10 w-full rounded border p-2" value={repository} disabled={clean.isPending} onChange={e=>{setRepository(e.target.value);resetSelection();}}>
        <option value="">选择仓库</option>{components.data?.filter(c=>c.is_active).map(c=><option key={c.repository} value={c.repository}>{c.repository_detail?.name || c.repository}</option>)}
      </select></label>
    </div>
    {candidates.isFetching ? <p>正在核验远端引用…</p> : null}
    {projects.error || components.error ? <p role="alert">项目或仓库加载失败，请刷新重试。</p> : null}
    {candidates.error ? <p role="alert">{candidates.error.message}</p> : null}
    <div className="space-y-3">
      {rows.map(row=><article key={row.id} className="flex items-start gap-3 rounded-lg border bg-white p-3 max-md:flex-col">
        <label className="flex min-h-9 items-center gap-2 break-all font-medium"><input type="checkbox" aria-label={`选择 ${row.tag_name}`} checked={selected.includes(row.id)} disabled={!row.allowed || clean.isPending || !!confirmation} onChange={e=>setSelected(old=>e.target.checked ? [...old,row.id] : old.filter(id=>id!==row.id))} />{row.tag_name}</label>
        <div className="min-w-0 flex-1 space-y-1 text-sm"><p className="break-all">保护引用：{row.protected_by || '无'}</p><p className="break-all text-xs text-slate-500">{row.git_hash}</p>{row.reason ? <p className="text-amber-700">{row.reason}</p> : null}</div>
        <Link className="min-h-9 text-sm text-indigo-600" to={`/releases/${row.id}`}>发布历史</Link>
      </article>)}
      {repository && !candidates.isFetching && !rows.length ? <p>当前没有已发布 RC</p> : null}
    </div>
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <button className="min-h-9 rounded border px-3" disabled={page===1 || clean.isPending || !!confirmation} onClick={()=>{setPage(page-1);setSelected([]);}}>上一页</button>
      <span>第 {page} 页 · 共 {candidates.data?.total || 0} 条</span>
      <button className="min-h-9 rounded border px-3" disabled={page*20 >= (candidates.data?.total || 0) || clean.isPending || !!confirmation} onClick={()=>{setPage(page+1);setSelected([]);}}>下一页</button>
      <button className="min-h-9 rounded bg-indigo-600 px-3 text-white disabled:opacity-50" disabled={!selected.length || clean.isPending} onClick={()=>setConfirmation(rows.filter(row=>selected.includes(row.id)).map(({id,tag_name})=>({id,tag_name})))}>预览清理 {selected.length} 项</button>
    </div>
    {confirmation ? <section aria-label="确认清理范围" className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
      <p>仅删除远端 RC Tag，保留所有平台历史；执行时会重新核验资格。</p>
      <ul className="break-all">{confirmation.map(item=><li key={item.id}>{item.tag_name}</li>)}</ul>
      <div className="flex gap-3"><button className="min-h-10 rounded bg-red-600 px-3 text-white" disabled={clean.isPending} onClick={()=>clean.mutate(confirmation)}>{clean.isPending ? '逐项处理中…' : '确认清理'}</button>
      <button className="min-h-10 px-3" disabled={clean.isPending} onClick={()=>setConfirmation(null)}>取消</button></div>
      {clean.error ? <p role="alert">{clean.error.message}；结果未确认，可重试对账。</p> : null}
    </section> : null}
    {results.length ? <section className="space-y-2 rounded border p-3 text-sm" aria-live="polite">
      <p>成功 {results.filter(r=>successful(r.status)).length} 项，失败或阻止 {results.filter(r=>!successful(r.status)).length} 项</p>
      {results.map(result=><p className="break-all" key={result.id}>{result.tag_name || result.id}：{statusLabel[result.status] || result.status} <span>{result.reason}</span></p>)}
      {results.some(r=>!successful(r.status)) ? <button className="min-h-10 rounded border px-3" disabled={clean.isPending} onClick={()=>setConfirmation(results.filter(r=>!successful(r.status)).flatMap(r=>{const name=r.tag_name || rows.find(row=>row.id===r.id)?.tag_name;return name ? [{id:r.id,tag_name:name}] : [];}))}>重试失败项</button> : null}
    </section> : null}
  </div>;
}
