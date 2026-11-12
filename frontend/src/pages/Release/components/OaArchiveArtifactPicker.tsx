import { useState } from 'react';
import { Alert, Button, Modal, Pagination, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { packageApi } from '@/api/package';
import { oaArchiveApi, type ArchiveArtifact } from '@/api/oaArchive';
import { PermissionAlert } from '@/components/PermissionAlert';

/** 原清单与补录共用一次单文件选择；进入表单时服务端再次实时核验。 */
export function OaArchiveArtifactPicker({ releaseId, open, onClose, onSelect, pending, error }: {
  releaseId: string; open: boolean; onClose: () => void; onSelect: (artifact: ArchiveArtifact) => void;
  pending: boolean; error: unknown;
}) {
  const [selected, setSelected] = useState<ArchiveArtifact>();
  const [taskId, setTaskId] = useState('');
  const [path, setPath] = useState('');
  const [page, setPage] = useState(1);
  const options = useQuery({ queryKey: ['oa-archive-options', releaseId], queryFn: () => oaArchiveApi.options(releaseId), enabled: open, retry: false, staleTime: 0 });
  const files = useQuery({ queryKey: ['oa-archive-svn', taskId, path, page], queryFn: () => packageApi.getTaskSvnArtifacts(taskId, path, page), enabled: open && !!taskId, retry: false, staleTime: 0 });
  const task = options.data?.svn_tasks?.find(item => item.task_id === taskId);
  function navigate(next: string) { setPath(next); setPage(1); setSelected(undefined); }
  return <Modal title="选择归档产物" open={open} onCancel={onClose} footer={null} width={680}>
    <div className="space-y-3">
      <label htmlFor="archive-artifact" className="block">归档产物</label>
      <select id="archive-artifact" value={selected?.source_kind !== 'svn' && selected?.artifact_id ? `${selected.task_id}:${selected.artifact_id}` : ''}
        onChange={event => { setTaskId(''); setSelected(options.data?.artifacts.find(item => `${item.task_id}:${item.artifact_id}` === event.target.value)); }}
        className="min-h-11 w-full min-w-0 rounded border border-slate-300 bg-white p-2" disabled={options.isPending || pending}>
        <option value="">选择一个本地产物</option>
        {(options.data?.artifacts || []).map(item => <option key={`${item.task_id}:${item.artifact_id}`} value={`${item.task_id}:${item.artifact_id}`}>{item.task_name} / {item.name}</option>)}
      </select>
      {!!options.data?.svn_tasks?.length && <>
        <label htmlFor="archive-svn-task" className="block">SVN 历史任务</label>
        <select id="archive-svn-task" value={taskId} disabled={pending} onChange={event => { setTaskId(event.target.value); navigate(''); }}
          className="min-h-11 w-full min-w-0 rounded border border-slate-300 bg-white p-2">
          <option value="">选择任务以核验 SVN 当前文件</option>
          {options.data.svn_tasks.map(item => <option key={item.task_id} value={item.task_id}>{item.task_name}</option>)}
        </select>
      </>}
      {taskId && <div className="space-y-3">
        <Alert type="info" title="按 SVN 当前文件办理" description="当前文件可能已被覆盖，不表示与原构建内容一致。原始元数据缺失时保持未知，发布 SN 仍为固定源码提交。" />
        <div className="flex flex-wrap gap-2">
          {path && <Button className="min-h-11" disabled={pending} onClick={() => navigate(path.split('/').slice(0, -1).join('/'))}>返回上级目录</Button>}
          <Button className="min-h-11" disabled={files.isFetching || pending} onClick={() => { setSelected(undefined); void files.refetch(); }}>重新核验 SVN 文件</Button>
        </div>
        {files.isFetching ? <div role="status"><Spin /> 正在核验 SVN 当前文件…</div> : files.error ? <PermissionAlert error={files.error} errorTitle="SVN 文件无法核验" /> : files.data && <>
          <p className="break-all text-xs text-slate-500">任务目录：{files.data.root_url}{path ? ` / ${path}` : ''}</p>
          <ul aria-label="归档 SVN 文件清单" className="max-h-72 space-y-2 overflow-y-auto">
            {files.data.entries.map(entry => <li key={entry.path} className="space-y-1 rounded border border-slate-200 p-2 text-xs">
              {entry.current?.kind === 'dir' ? <Button className="min-h-11 max-w-full whitespace-normal break-all" disabled={pending} onClick={() => navigate(entry.path)}>进入目录 {entry.name}</Button> : <label className="flex min-h-11 items-start gap-2 break-all">
                <input type="radio" name="archive-svn-file" className="mt-1" checked={selected?.source_kind === 'svn' && selected.path === entry.path} disabled={entry.state !== 'available' || pending}
                  onChange={() => setSelected({ task_id: taskId, task_name: task?.task_name || '', artifact_id: entry.artifact_id, path: entry.path, name: entry.name, source_kind: 'svn' })} />
                <span>{entry.path}</span>
              </label>}
              <p>{entry.source === 'svn_supplement' ? '从 SVN 补录' : entry.source === 'upload_manifest' ? '原上传清单' : '原产物清单'} · {entry.message}</p>
              <p>原大小：{entry.original.size ?? '未知'} · 当前大小：{entry.current?.size ?? '未知'} · 当前 revision：{entry.current?.revision ?? '未知'}</p>
            </li>)}
          </ul>
          {!files.data.entries.length && <p>该任务目录没有可选文件</p>}
          {files.data.total > files.data.page_size && <Pagination size="small" current={page} total={files.data.total} pageSize={files.data.page_size} showSizeChanger={false} onChange={next => { setPage(next); setSelected(undefined); }} />}
        </>}
      </div>}
      {!options.isPending && !options.error && !options.data?.artifacts.length && !options.data?.svn_tasks?.length && <Alert type="info" title="没有可准备归档的产物，请确认任务成功及 SVN 推送结果。" />}
      {options.error && <><PermissionAlert error={options.error} /><Button onClick={() => void options.refetch()}>重新加载产物</Button></>}
      {error ? <PermissionAlert error={error} errorTitle="无法准备该产物" /> : null}
      <div className="flex justify-end"><Button className="min-h-11" type="primary" loading={pending} disabled={!selected || (selected.source_kind === 'svn' && (files.isFetching || !!files.error))} onClick={() => selected && onSelect(selected)}>填写申请资料</Button></div>
    </div>
  </Modal>;
}
