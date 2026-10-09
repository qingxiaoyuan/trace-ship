import { useState } from 'react';
import { Button } from 'antd';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { releaseApi } from '@/api/release';
import type { Release } from '@/types';
import { RcSourceSelect } from './RcSourceSelect';

/** 发布身份只读展示；仅正式草稿可以显式重选来源。 */
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
  if (release.release_type !== 'formal') return null;
  return <section className="mt-4 space-y-2 rounded-lg border border-indigo-100 p-3 text-[13px]">
    <p className="font-medium">来源 RC</p>
    {release.source_rc ? <>
      <Link className="break-all text-indigo-600" to={`/releases/${release.source_rc}`}>{release.source_rc_version} · {release.source_rc_tag}</Link>
      <p className="break-all font-mono text-xs">{release.source_rc_git_hash}</p>
    </> : <p className="text-slate-500">历史记录未记录来源 RC</p>}
    {release.status === 'draft' && !editing ? <Button onClick={() => { setSelected(undefined); setEditing(true); }}>重选来源 RC</Button> : null}
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
