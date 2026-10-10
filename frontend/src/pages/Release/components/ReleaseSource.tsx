import { useState } from 'react';
import { Button } from 'antd';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { releaseApi } from '@/api/release';
import type { Release } from '@/types';
import { RcSourceSelect } from './RcSourceSelect';

const cleanupStatus: Record<string, string> = {attempting: '结果待核验', success: '清理成功', already_cleaned: '已清理', external_missing: '远端已缺失', reconciled_missing: '对账确认缺失', blocked: '已阻止', failure: '失败'};

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
  const reference = useQuery({ queryKey: ['release-reference', release.id, release.tag_cleanup_status, release.source_rc],
    queryFn: () => releaseApi.getSourceReference(release.id), enabled: release.status === 'released' || !!release.source_rc, retry: false });
  const availability = <div className="space-y-2 break-all text-sm">
    {reference.error ? <p role="alert">源码引用核验失败：{reference.error.message}</p> : reference.data ? <p>{reference.data.available ? `当前源码引用：${reference.data.reference}` : reference.data.reason}</p> : null}
  </div>;
  if (release.release_type === 'rc') return <section className="mt-4 space-y-2 rounded border p-3 text-sm">
    <p className="font-medium">RC 标签与源码</p>{availability}
    <p>清理状态：{release.tag_cleanup_status === 'cleaned' ? '平台已清理' : release.tag_cleanup_status === 'external_missing' ? '已确认缺失（无法归属平台删除）' : '未记录清理'}</p>
    {release.tag_cleaned_at ? <p>最近核验：{release.tag_cleaned_at}</p> : null}
    {release.tag_cleanup_reference ? <p className="break-all">保护引用：{release.tag_cleanup_reference}</p> : null}
    <Link className="inline-block min-h-9 text-indigo-600" to={`/releases/cleanup?project=${release.project}&repository=${release.repository}`}>预览并清理 RC Tag</Link>
    {release.cleanup_history?.length ? <details><summary className="min-h-9">清理记录</summary>{release.cleanup_history.map((item,index)=><p className="break-all" key={index}>{item.created_at} · {cleanupStatus[item.status] || '未知状态'} · {item.message} · 操作者 {item.actor_name || item.actor_id || '已删除账号'}</p>)}</details> : null}
  </section>;
  if (release.release_type !== 'formal') return null;
  return <section className="mt-4 space-y-2 rounded-lg border border-indigo-100 p-3 text-[13px]">
    <p className="font-medium">来源 RC</p>{availability}
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
