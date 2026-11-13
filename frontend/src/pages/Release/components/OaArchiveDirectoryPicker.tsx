import { useState } from 'react';
import dayjs from 'dayjs';
import { Alert, Button, Modal, Select } from 'antd';
import { FolderArchive } from 'lucide-react';
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
    <div className="flex flex-col gap-4 pt-1">
      <p className="text-[13px] leading-6 text-slate-500">选择一次成功打包的整个产物目录，目录内多个文件仍只办理一份归档。</p>
      <div className="flex flex-col gap-2">
        <label htmlFor="archive-directory" className="text-[13px] font-medium text-slate-600">归档目录</label>
        <Select id="archive-directory" value={taskId || undefined} onChange={setTaskId} className="w-full" virtual={false}
          showSearch={{ optionFilterProp: 'label' }} placeholder="选择打包任务，可搜索名称或时间" loading={options.isFetching}
          disabled={options.isFetching || pending} notFoundContent={options.isFetching ? '加载中…' : '没有匹配的打包目录'}
          options={(options.data?.directories || []).map(item => ({ value: item.task_id, taskName: item.task_name,
            time: item.created_at ? dayjs(item.created_at).format('YYYY-MM-DD HH:mm:ss') : '打包时间未知',
            label: `${item.created_at ? `${dayjs(item.created_at).format('YYYY-MM-DD HH:mm:ss')} · ` : ''}${item.task_name} / 完整产物目录`,
          }))}
          optionRender={option => <div className="flex items-start gap-2 py-1">
            <FolderArchive className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" strokeWidth={1.5} aria-hidden="true" />
            <div className="min-w-0"><div className="whitespace-normal break-words text-[13px] font-medium">{option.data.taskName}</div>
              <div className="mt-1 text-[12px] text-slate-500">{option.data.time} · 完整产物目录</div></div>
          </div>} />
      </div>
      {selected && <div className="flex flex-col gap-2 rounded-lg border border-indigo-100 bg-slate-50/60 p-3 text-[12px] leading-5 text-slate-500">
        <p className="break-words font-medium text-slate-700">打包任务：{selected.task_name}</p>
        <div className="flex flex-wrap gap-x-6 gap-y-1"><span>归档范围：整个产物目录</span>
          {selected.created_at && <span>打包时间：{dayjs(selected.created_at).format('YYYY-MM-DD HH:mm:ss')}</span>}</div>
        {selected.svn_url && <p className="break-all">任务保存的 SVN 目录：{selected.svn_url}</p>}
        {selected.source_kind === 'svn' && <Alert type="info" title="按当前 SVN 目录办理" description="目录内容可能已被覆盖，不表示与原构建一致。填写和提交时重新核验任务保存的整个目录；没有原清单时明确标记从 SVN 补录。" />}
      </div>}
      {!options.isPending && !options.error && !options.data?.directories?.length && <Alert type="info" title="没有可准备归档的目录，请确认任务成功及 SVN 推送结果。" />}
      {options.error && <><PermissionAlert error={options.error} /><Button onClick={() => void options.refetch()}>重新加载目录</Button></>}
      {error ? <PermissionAlert error={error} errorTitle="无法准备该目录" /> : null}
      <div className="flex justify-end border-t border-slate-100 pt-4"><Button className="max-md:min-h-11" type="primary" loading={pending} disabled={!selected || options.isFetching || !!options.error}
        onClick={() => selected && onSelect({ task_id: selected.task_id, scope: 'directory', path: '.', source_kind: selected.source_kind })}>填写申请资料</Button></div>
    </div>
  </Modal>;
}
