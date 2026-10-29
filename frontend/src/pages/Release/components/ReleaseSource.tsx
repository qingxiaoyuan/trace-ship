import { useState } from 'react';
import { Button, Modal } from 'antd';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ChevronDown, ChevronUp, GitBranch, GitCommitHorizontal, RefreshCw, Tag } from 'lucide-react';
import { releaseApi } from '@/api/release';
import type { Release } from '@/types';
import { RcSourceSelect } from './RcSourceSelect';

/** 统一展示本次发布的固定代码、Tag 与来源；草稿保留更新入口。 */
export function ReleaseSource({ release, canRefresh = false }: { release: Release; canRefresh?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [commitExpanded, setCommitExpanded] = useState(false);
  const queryClient = useQueryClient();
  const preview = useQuery({ queryKey: ['branch-update', release.id],
    queryFn: () => releaseApi.previewBranchUpdate(release.id), enabled: previewOpen, retry: false,
    staleTime: 0 });
  const refresh = useMutation({
    mutationFn: () => releaseApi.confirmBranchUpdate(release.id, preview.data!.old_hash, preview.data!.new_hash),
    onSuccess: (data) => {
      queryClient.setQueryData(['release', release.id], data);
      void queryClient.invalidateQueries({ queryKey: ['release-commits', release.id] });
      void queryClient.invalidateQueries({ queryKey: ['formal-changes', release.id] });
      setPreviewOpen(false);
    },
  });
  const update = useMutation({
    mutationFn: (source: string) => releaseApi.updateSource(release.id, source),
    onSuccess: (data) => {
      queryClient.setQueryData(['release', release.id], data);
      queryClient.invalidateQueries({ queryKey: ['release-commits', release.id] });
      queryClient.invalidateQueries({ queryKey: ['formal-changes', release.id] });
      setEditing(false);
    },
  });
  const reference = useQuery({ queryKey: ['release-reference', release.id, release.tag_cleanup_status, release.source_rc],
    queryFn: () => releaseApi.getSourceReference(release.id), enabled: release.release_type === 'formal' && (release.status === 'released' || !!release.source_rc), retry: false });
  const commit = release.git_hash || release.source_rc_git_hash || '';
  const canUpdate = release.status === 'draft' && canRefresh;
  const commitDetailsId = `release-commit-${release.id}`;

  return <section aria-label="发布代码" className="mt-5 rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 text-[13px]">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-1 gap-3 max-sm:basis-full">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-indigo-100 bg-white text-indigo-500">
          <GitBranch className="h-[18px] w-[18px]" strokeWidth={1.5} />
        </div>
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-slate-900">发布代码</h2>
          <p className="mt-1 text-[12px] leading-5 text-slate-500">本次审批和打包使用此提交，分支后续更新不会自动带入。</p>
        </div>
      </div>
      {canUpdate && release.source_rc && !editing ? (
        <Button size="small" className="max-sm:ml-12 max-sm:min-h-9" onClick={() => { setSelected(undefined); setEditing(true); }}>重选来源 RC</Button>
      ) : null}
      {canUpdate && !release.source_rc ? (
        <Button size="small" className="max-sm:ml-12 max-sm:min-h-9" icon={<RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />}
          onClick={() => { refresh.reset(); setPreviewOpen(true); }}>更新到分支最新提交</Button>
      ) : null}
    </div>

    <dl className="mt-4 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="min-w-0">
        <dt className="mb-1.5 text-[11px] text-slate-400">代码分支</dt>
        <dd className="flex min-w-0 items-start gap-1.5 font-mono text-[12px] font-medium text-slate-700">
          <GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" strokeWidth={1.5} />
          <span className="break-all">{release.branch || '-'}</span>
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="mb-1.5 text-[11px] text-slate-400">固定提交</dt>
        <dd>
          {commit ? <button type="button" aria-label={commitExpanded ? '收起完整提交号' : '查看完整提交号'}
            aria-expanded={commitExpanded} aria-controls={commitDetailsId}
            onClick={() => setCommitExpanded(value => !value)}
            className="inline-flex items-center gap-1.5 rounded text-slate-700 transition-colors hover:text-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500 max-md:min-h-9">
            <GitCommitHorizontal className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />
            <span className="font-mono text-[12px] font-medium">{commit.slice(0, 12)}</span>
            {commitExpanded ? <ChevronUp className="h-3 w-3 text-slate-400" /> : <ChevronDown className="h-3 w-3 text-slate-400" />}
          </button> : <span className="text-slate-400">未记录提交</span>}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="mb-1.5 text-[11px] text-slate-400">发布 Tag</dt>
        <dd className="flex min-w-0 items-start gap-1.5 font-mono text-[12px] font-medium text-slate-700">
          <Tag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" strokeWidth={1.5} />
          <span className="break-all">{release.tag_name || '-'}</span>
        </dd>
      </div>
    </dl>

    {commitExpanded ? <div id={commitDetailsId} className="mt-3 space-y-2 border-t border-slate-200/70 pt-3">
      <p className="text-[11px] text-slate-400">完整提交号</p>
      <p className="select-all break-all font-mono text-[12px] text-slate-600">{commit}</p>
      {release.source_rc_git_hash && release.source_rc_git_hash !== commit ? <>
        <p className="text-[11px] text-slate-400">来源 RC 提交</p>
        <p className="select-all break-all font-mono text-[12px] text-slate-600">{release.source_rc_git_hash}</p>
      </> : null}
    </div> : null}

    {release.source_rc ? <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-slate-200/70 pt-3 text-[12px]">
      <span className="text-slate-400">来源 RC</span>
      <Link className="min-w-0 break-all font-medium text-indigo-600 hover:text-indigo-500" to={`/releases/${release.source_rc}`}>
        {release.source_rc_version} · {release.source_rc_tag}
      </Link>
    </div> : null}

    {reference.isFetching && !reference.data ? <p className="mt-3 text-[12px] text-slate-400">正在核验打包引用…</p> : null}
    {reference.error ? <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
      <p className="min-w-0 flex-1 break-words">源码引用核验失败：{reference.error.message}</p>
      <Button size="small" type="text" className="max-md:min-h-9" loading={reference.isFetching} onClick={() => { void reference.refetch(); }}>重新核验</Button>
    </div> : reference.data ? (
      reference.data.available ? <p className="mt-3 flex items-start gap-1.5 text-[12px] text-slate-500">
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" strokeWidth={1.75} />
        <span className="break-all">打包引用：{reference.data.reference}</span>
      </p> : <div role="alert" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-700">
        <p className="font-medium">打包源码暂不可用</p>
        <p className="break-words">{reference.data.reason || '没有有效的源码引用，请联系项目管理员核对。'}</p>
      </div>
    ) : null}
    {release.revision_update_required && !release.has_revision_history ? <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-700">申请已退回修改，请更新到新的来源提交，再重新生成发布说明并提审。</p> : null}

    {!release.source_rc && canUpdate ? <>
      <Modal title="确认更新来源提交" open={previewOpen} onCancel={() => setPreviewOpen(false)}
        okText="确认更新" cancelText="取消" confirmLoading={refresh.isPending}
        okButtonProps={{ disabled: preview.isFetching || !!preview.error || !preview.data || preview.data.old_hash === preview.data.new_hash }}
        onOk={() => refresh.mutate()}>
        {preview.isFetching ? <p>正在获取分支变更…</p> : null}
        {preview.error ? <p role="alert">预览失败：{preview.error.message}</p> : null}
        {refresh.error ? <p role="alert">更新失败：{refresh.error.message}，请关闭后重新预览。</p> : null}
        {preview.data && !preview.isFetching && !preview.error ? <div className="space-y-2 text-sm">
          <p className="break-all">当前提交：{preview.data.old_hash}</p>
          <p className="break-all">最新提交：{preview.data.new_hash}</p>
          <p>确认后原发布说明及关联变更将清空，必须重新生成说明。</p>
          <p className="font-medium">提交变更</p>
          {preview.data.commits.length ? <ul className="max-h-64 overflow-auto">{preview.data.commits.map(commit =>
            <li key={commit.hash} className="break-all border-t py-2"><span className="font-mono">{commit.hash}</span><p className="whitespace-pre-wrap">{commit.message}</p><p>{commit.author}</p></li>)}</ul>
            : <p>没有新增提交</p>}
          <p className="font-medium">代码差异</p>
          <div className="max-h-80 overflow-auto">{preview.data.diffs.map((file, index) =>
            <section key={`${file.old_path}:${file.new_path}:${index}`}><p className="break-all">{file.old_path} → {file.new_path}</p><pre className="whitespace-pre-wrap break-all">{file.diff || '无文本差异（可能为二进制或文件属性变更）'}</pre></section>)}</div>
        </div> : null}
      </Modal>
    </> : null}
    {editing && canUpdate ? <div className="mt-4 space-y-3 border-t border-slate-200/70 pt-3">
      <p className="text-amber-700">保存新来源后，原发布说明和关联变更将清空，需要重新生成。</p>
      <RcSourceSelect project={release.project} repository={release.repository} value={selected} onChange={setSelected} />
      {update.error ? <p role="alert">{update.error.message}</p> : null}
      <div className="flex gap-2">
        <Button type="primary" disabled={!selected || selected === release.source_rc} loading={update.isPending}
          onClick={() => selected && update.mutate(selected)}>保存来源</Button>
        <Button disabled={update.isPending} onClick={() => setEditing(false)}>取消</Button>
      </div>
    </div> : null}
  </section>;
}
