import { useState } from 'react';
import { Button, Modal } from 'antd';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { releaseApi } from '@/api/release';
import type { Release } from '@/types';
import { RcSourceSelect } from './RcSourceSelect';

/** 展示正式版来源；已有 RC 来源的草稿保留历史重选能力。 */
export function ReleaseSource({ release, canRefresh = false }: { release: Release; canRefresh?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [previewOpen, setPreviewOpen] = useState(false);
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
  const availability = <div className="space-y-2 break-all text-sm">
    {reference.error ? <p role="alert">源码引用核验失败：{reference.error.message}</p> : reference.data ? <p>{reference.data.available ? `当前源码引用：${reference.data.reference}` : reference.data.reason}</p> : null}
  </div>;
  return <section className="mt-4 space-y-2 rounded-lg border border-indigo-100 p-3 text-[13px]">
    <p className="font-medium">{release.source_rc ? '来源 RC' : '来源代码'}</p>{availability}
    {release.source_rc ? <>
      <Link className="break-all text-indigo-600" to={`/releases/${release.source_rc}`}>{release.source_rc_version} · {release.source_rc_tag}</Link>
      <p className="break-all font-mono text-xs">{release.source_rc_git_hash}</p>
    </> : <>
      <p className="break-all text-slate-500">分支：{release.branch || '-'}</p>
      <p className="break-all font-mono text-xs">{release.git_hash || '-'}</p>
    </>}
    {release.source_rc && release.status === 'draft' && canRefresh && !editing ? <Button onClick={() => { setSelected(undefined); setEditing(true); }}>重选来源 RC</Button> : null}
    {!release.source_rc && release.status === 'draft' && canRefresh ? <>
      <Button onClick={() => { refresh.reset(); setPreviewOpen(true); }}>更新到分支最新提交</Button>
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
    {editing && canRefresh ? <>
      <p className="text-amber-700">保存新来源后，原发布说明和关联变更将清空，需要重新生成。</p>
      <RcSourceSelect project={release.project} repository={release.repository} value={selected} onChange={setSelected} />
      {update.error ? <p role="alert">{update.error.message}</p> : null}
      <div className="flex gap-2">
        <Button type="primary" disabled={!selected || selected === release.source_rc} loading={update.isPending}
          onClick={() => selected && update.mutate(selected)}>保存来源</Button>
        <Button disabled={update.isPending} onClick={() => setEditing(false)}>取消</Button>
      </div>
    </> : null}
  </section>;
}
