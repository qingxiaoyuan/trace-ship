import { useState } from 'react';
import { Alert, Button, Empty, Modal, Pagination, Spin, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { packageApi } from '@/api/package';
import { PermissionAlert } from '@/components/PermissionAlert';
import { formatSize } from '@/pages/Package/components/utils';

const sourceLabels = {
  artifact_manifest: '原产物清单', upload_manifest: '原上传清单', svn_supplement: '从 SVN 补录',
};

/** 仅查询当前文件元信息，沿用任务的项目可见范围。 */
export function TaskSvnArtifacts({ taskId, taskName }: { taskId: string; taskName: string }) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState('');
  const [page, setPage] = useState(1);
  const navigateDirectory = (next: string) => { setPath(next); setPage(1); };
  const files = useQuery({
    queryKey: ['task-svn-artifacts', taskId, path, page],
    queryFn: () => packageApi.getTaskSvnArtifacts(taskId, path, page),
    enabled: open,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  return <>
    <Button className="max-md:min-h-9" size="small" onClick={() => setOpen(true)}>查看 SVN 文件</Button>
    <Modal title={`${taskName} · SVN 当前文件`} open={open} onCancel={() => setOpen(false)} footer={null} width={880}>
      <div className="space-y-4">
        <Alert type="info" showIcon title="只读查看 SVN 当前文件" description="当前文件可能已被覆盖；当前元数据不代表当年的构建快照。原始信息缺失时显示未知。" />
        <div className="flex flex-wrap gap-2">
        {path && <Button className="max-md:min-h-9" onClick={() => navigateDirectory(path.split('/').slice(0, -1).join('/'))}>返回上级目录</Button>}
        <Button className="max-md:min-h-9" disabled={files.isFetching} onClick={() => void files.refetch()}>重新核验</Button>
        </div>
        {files.isFetching ? <div role="status" className="py-6 text-center"><Spin /><p>正在核验 SVN 当前文件…</p></div> : files.error ?
          <PermissionAlert error={files.error} errorTitle="SVN 文件无法核验" /> : files.data && <>
            <p className="break-all text-xs text-slate-500">任务目录：{files.data.root_url}</p>
            {!files.data.entries.length ? <Empty description="该任务目录没有可显示的文件" /> :
              <ul aria-label="SVN 文件清单" className="max-h-[60vh] space-y-3 overflow-y-auto">
                {files.data.entries.map((entry) => <li key={entry.path} className="space-y-2 rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0 break-all font-medium">{entry.path}</span>
                    <Tag>{sourceLabels[entry.source]}</Tag>
                  </div>
                  {entry.current?.kind === 'dir' && files.data.mode === 'browse' && <Button className="max-md:min-h-9" aria-label={`打开目录 ${entry.name}`} onClick={() => navigateDirectory(entry.path)}>打开目录</Button>}
                  <p className={entry.state === 'available' ? 'text-xs text-emerald-700' : 'text-xs text-amber-700'}>{entry.message}</p>
                  {entry.current?.kind !== 'dir' && <p className="text-xs text-slate-500">{entry.local_available ? '本地文件仍可用' : '本地文件已清理或不可用'}</p>}
                  <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
                    <dl className="space-y-1 break-all text-xs text-slate-600">
                      <dt className="font-medium text-slate-800">原构建依据</dt>
                      <dd>大小：<span>{entry.original.size == null ? '未知' : formatSize(entry.original.size)}</span></dd>
                      <dd>SHA-256：<span>{entry.original.sha256 || '未知'}</span></dd>
                      <dd>SVN revision：{entry.original.revision || '未知'}</dd>
                    </dl>
                    <dl className="space-y-1 break-all text-xs text-slate-600">
                      <dt className="font-medium text-slate-800">当前 SVN 文件</dt>
                      <dd>类型：{entry.current?.kind === 'dir' ? '目录' : entry.current?.kind === 'file' ? '文件' : '无法核验'}</dd>
                      <dd>大小：<span>{entry.current?.size == null ? '未知' : formatSize(entry.current.size)}</span></dd>
                      <dd>SVN revision：{entry.current?.revision || '未知'}</dd>
                    </dl>
                  </div>
                  <p className="break-all text-xs text-slate-500">{entry.url}</p>
                </li>)}
              </ul>}
            <Pagination simple hideOnSinglePage current={page} total={files.data.total} pageSize={files.data.page_size || 50} onChange={setPage} showSizeChanger={false} />
          </>}
      </div>
    </Modal>
  </>;
}
