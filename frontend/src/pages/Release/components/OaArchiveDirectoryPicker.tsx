import { useState } from 'react';
import { Alert, Button, Modal } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { oaArchiveApi, type ArchiveDirectory, type ArchiveSelection } from '@/api/oaArchive';
import { PermissionAlert } from '@/components/PermissionAlert';

/** 每次只选择一次成功打包的整个产物根目录，进入表单时实时核验。 */
export function OaArchiveDirectoryPicker({ releaseId, open, onClose, onSelect, pending, error }: {
  releaseId: string; open: boolean; onClose: () => void; onSelect: (selection: ArchiveSelection) => void;
  pending: boolean; error: unknown;
}) {
  const [taskId, setTaskId] = useState('');
  const options = useQuery({ queryKey: ['oa-archive-options', releaseId], queryFn: () => oaArchiveApi.options(releaseId), enabled: open, retry: false, staleTime: 0 });
  const selected: ArchiveDirectory | undefined = options.data?.directories?.find(item => item.task_id === taskId);
  return <Modal title="选择归档目录" open={open} onCancel={onClose} footer={null} width={680}>
    <div className="space-y-3">
      <p>选择一次成功打包的整个产物目录，目录内多个文件仍只办理一份归档。</p>
      <label htmlFor="archive-directory" className="block">归档目录</label>
      <select id="archive-directory" value={taskId} onChange={event => setTaskId(event.target.value)}
        className="min-h-11 w-full min-w-0 rounded border border-slate-300 bg-white p-2" disabled={options.isFetching || pending}>
        <option value="">选择一次成功打包</option>
        {(options.data?.directories || []).map(item => <option key={item.task_id} value={item.task_id}>{item.task_name} / 完整产物目录</option>)}
      </select>
      {selected && <div className="space-y-2 text-xs">
        <p>归档范围：整个产物目录</p>
        {selected.created_at && <p>打包时间：{new Date(selected.created_at).toLocaleString()}</p>}
        {selected.svn_url && <p className="break-all">任务保存的 SVN 目录：{selected.svn_url}</p>}
        {selected.source_kind === 'svn' && <Alert type="info" title="按当前 SVN 目录办理" description="目录内容可能已被覆盖，不表示与原构建一致。填写和提交时重新核验任务保存的整个目录；没有原清单时明确标记从 SVN 补录。" />}
      </div>}
      {!options.isPending && !options.error && !options.data?.directories?.length && <Alert type="info" title="没有可准备归档的目录，请确认任务成功及 SVN 推送结果。" />}
      {options.error && <><PermissionAlert error={options.error} /><Button onClick={() => void options.refetch()}>重新加载目录</Button></>}
      {error ? <PermissionAlert error={error} errorTitle="无法准备该目录" /> : null}
      <div className="flex justify-end"><Button className="min-h-11" type="primary" loading={pending} disabled={!selected || options.isFetching || !!options.error}
        onClick={() => selected && onSelect({ task_id: selected.task_id, scope: 'directory', path: '.', source_kind: selected.source_kind })}>填写申请资料</Button></div>
    </div>
  </Modal>;
}
