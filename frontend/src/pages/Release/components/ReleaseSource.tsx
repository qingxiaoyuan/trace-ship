import { useState } from 'react';
import { Button } from 'antd';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { releaseApi } from '@/api/release';
import type { Release } from '@/types';
import { RcSourceSelect } from './RcSourceSelect';

/** 展示正式版来源；已有 RC 来源的草稿保留历史重选能力。 */
export function ReleaseSource({ release }: { release: Release }) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string>();
  const queryClient = useQueryClient();
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
  if (release.release_type !== 'formal') return null;
  return <section className="mt-4 space-y-2 rounded-lg border border-indigo-100 p-3 text-[13px]">
    <p className="font-medium">{release.source_rc ? '来源 RC' : '来源代码'}</p>{availability}
    {release.source_rc ? <>
      <Link className="break-all text-indigo-600" to={`/releases/${release.source_rc}`}>{release.source_rc_version} · {release.source_rc_tag}</Link>
      <p className="break-all font-mono text-xs">{release.source_rc_git_hash}</p>
    </> : <>
      <p className="break-all text-slate-500">分支：{release.branch || '-'}</p>
      <p className="break-all font-mono text-xs">{release.git_hash || '-'}</p>
    </>}
    {release.source_rc && release.status === 'draft' && !editing ? <Button onClick={() => { setSelected(undefined); setEditing(true); }}>重选来源 RC</Button> : null}
    {editing ? <>
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
