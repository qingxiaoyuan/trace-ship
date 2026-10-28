import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, FileCode2, Folder } from 'lucide-react';
import { workflowApi } from '@/api/workflow';
import type { ReviewDiffFile } from '@/api/workflow';
import type { NormalizedError } from '@/api/request';
import { useAuthStore } from '@/stores/authStore';

interface DirectoryNode {
  folders: Map<string, DirectoryNode>;
  files: Array<{ name: string; path: string; oldPath?: string }>;
}

function makeTree(files: ReviewDiffFile[]): DirectoryNode {
  const root: DirectoryNode = { folders: new Map(), files: [] };
  for (const file of files) {
    const path = file.new_path || file.old_path;
    if (!path) continue;
    const segments = path.split('/');
    const name = segments.pop() || path;
    let current = root;
    for (const segment of segments) {
      if (!current.folders.has(segment)) current.folders.set(segment, { folders: new Map(), files: [] });
      current = current.folders.get(segment)!;
    }
    current.files.push({ name, path, oldPath: file.renamed_file && file.old_path !== file.new_path ? file.old_path : undefined });
  }
  return root;
}

function DirectoryEntries({ node }: { node: DirectoryNode }) {
  return <ul className="space-y-1">
    {[...node.folders.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, folder]) => <li key={name}>
      <details open className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1.5 text-slate-600 hover:bg-slate-100 [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform group-open:rotate-90" strokeWidth={1.5} />
          <Folder aria-hidden="true" className="h-4 w-4 shrink-0 text-indigo-400" strokeWidth={1.5} />
          <span className="min-w-0 break-all">{name}</span>
        </summary>
        <div className="ml-4 border-l border-slate-200 pl-2"><DirectoryEntries node={folder} /></div>
      </details>
    </li>)}
    {node.files.map((file, index) => <li key={`${file.path}:${index}`} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-slate-600" title={file.path}>
      <FileCode2 aria-hidden="true" className="ml-[22px] mt-0.5 h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.5} />
      <span className="min-w-0 break-all">{file.name}{file.oldPath ? <span className="ml-2 text-slate-400">（原路径：{file.oldPath}）</span> : null}</span>
    </li>)}
  </ul>;
}

/** 在本轮固定差异上展示待审查目录，仅完整报告权限可请求文件路径。 */
export function ReviewFileDirectory({ instanceId, canViewFiles, active }: { instanceId: string; canViewFiles: boolean; active: boolean }) {
  const sessionVersion = useAuthStore((state) => state.sessionVersion);
  const query = useQuery({
    queryKey: ['review-diff', instanceId, sessionVersion],
    queryFn: () => workflowApi.getReviewDiff(instanceId),
    enabled: canViewFiles && active,
    retry: false,
    gcTime: 0,
  });
  if (!canViewFiles) return <p className="text-xs text-slate-500">文件目录仅向有完整审查权限的人员展示。</p>;
  if (!active || query.isLoading || (query.isFetching && !query.isFetchedAfterMount)) return <p className="text-xs text-slate-500">正在读取待审查文件…</p>;
  if (query.error) {
    const error = query.error as unknown as NormalizedError;
    return <div role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">文件目录读取失败：{error.friendlyMessage || error.message || '请稍后重试'} <button type="button" className="underline" onClick={() => void query.refetch()}>重试</button></div>;
  }
  if (!query.data) return <p className="text-xs text-slate-500">尚未取得待审查文件目录。</p>;
  if (query.data.status === 'first_release') return <p className="rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-600">首次发布没有基线，本轮将跳过 AI 代码审查，仍需人工审批。</p>;
  if (query.data.status === 'no_changes') return <p className="rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-600">本轮没有代码变更，仍需人工审批。</p>;
  return <FileDirectory files={query.data.diffs} title="待审查文件" incomplete={query.data.status === 'incomplete'} />;
}

/** 已知未覆盖路径仅来自授权后的报告。 */
export function UnreviewedFileDirectory({ paths, incomplete }: { paths: string[]; incomplete: boolean }) {
  return <FileDirectory files={paths.map((path) => ({ old_path: path, new_path: path, diff: '' }))} title="未审查文件" incomplete={incomplete} />;
}

function FileDirectory({ files, title, incomplete }: { files: ReviewDiffFile[]; title: string; incomplete: boolean }) {
  const [page, setPage] = useState(0);
  const pageSize = 100;
  const pages = Math.max(1, Math.ceil(files.length / pageSize));
  const current = Math.min(page, pages - 1);
  return <div className="overflow-hidden rounded-xl border border-slate-200">
    <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-3"><h5 className="font-medium text-slate-800">{title}</h5><span className="text-xs text-slate-400">{files.length} 个文件{incomplete ? '（清单不完整）' : ''}</span></div>
    {incomplete ? <p className="border-b border-amber-100 bg-amber-50/60 px-4 py-2 text-xs text-amber-800">以下仅为已取得的文件，完整范围尚未取得。</p> : null}
    {files.length ? <div className="max-h-80 overflow-auto px-3 py-3 font-mono text-xs"><DirectoryEntries node={makeTree(files.slice(current * pageSize, (current + 1) * pageSize))} /></div>
      : <p className="px-4 py-5 text-xs text-slate-500">{incomplete ? '尚未取得文件目录。' : '没有未审查的文件。'}</p>}
    {pages > 1 ? <div className="flex items-center gap-3 border-t border-slate-100 px-4 py-3 text-xs"><button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="text-indigo-700 disabled:text-slate-300">上一页</button><span className="text-slate-500">{current + 1} / {pages}</span><button type="button" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)} className="text-indigo-700 disabled:text-slate-300">下一页</button></div> : null}
  </div>;
}
