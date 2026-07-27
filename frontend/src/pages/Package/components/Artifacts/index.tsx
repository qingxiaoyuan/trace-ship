import { memo, useCallback, useMemo, useState } from 'react';
import { App, Button, Dropdown } from 'antd';
import { ChevronDown, Download, FileArchive, Upload } from 'lucide-react';
import type { PackageArtifact, PackageTask } from '@/types';
import { packageApi } from '@/api/package';
import { canPushSvn, formatSize, saveBlob } from '../utils';


export const ArtifactActionsDropdown = memo(function ArtifactActionsDropdown({
  task,
  pushing,
  onPushSvn,
}: {
  task: PackageTask;
  pushing?: boolean;
  onPushSvn?: () => void;
}) {
  const { message } = App.useApp();
  const [downloading, setDownloading] = useState(false);

  const hasArtifacts = (task.artifact_info || []).length > 0;

  const items = useMemo(() => {
    if (!canPushSvn(task)) return [];
    return [
      {
        key: 'push-svn',
        label: pushing ? '推送 SVN 中…' : '推送 SVN',
        icon: <Upload className="h-3 w-3" strokeWidth={1.5} />,
        disabled: pushing,
      },
    ];
  }, [task, pushing]);

  const handleDownload = useCallback(async () => {
    if (!hasArtifacts) {
      message.warning('暂无可下载产物');
      return;
    }
    setDownloading(true);
    try {
      const blob = await packageApi.downloadAllArtifacts(task.id);
      const safeName = (task.name || 'artifacts').replace(/\s+/g, '_').replace(/\//g, '_');
      saveBlob(blob, `${safeName}-${task.version}-artifacts.zip`);
    } catch {
      message.error('下载全部产物失败');
    } finally {
      setDownloading(false);
    }
  }, [task, hasArtifacts, message]);

  const handleMenuClick = useCallback(
    ({ key }: { key: string }) => {
      if (key === 'push-svn') {
        onPushSvn?.();
      }
    },
    [onPushSvn]
  );

  if (!hasArtifacts && items.length === 0) return null;

  return (
    <Dropdown.Button
      size="small"
      type="default"
      loading={downloading}
      disabled={!hasArtifacts}
      icon={<ChevronDown className="h-3 w-3" strokeWidth={1.5} />}
      menu={{ items, onClick: handleMenuClick }}
      onClick={handleDownload}
    >
      <span className="flex items-center gap-1">
        <Download className="h-3 w-3" strokeWidth={1.5} />
        下载全部
      </span>
    </Dropdown.Button>
  );
});

export const ArtifactRow = memo(function ArtifactRow({ artifact, taskId }: { artifact: PackageArtifact; taskId: string }) {
  const { message } = App.useApp();
  const [downloading, setDownloading] = useState(false);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      const blob = await packageApi.downloadArtifact(taskId, artifact.id);
      saveBlob(blob, artifact.name);
    } catch {
      message.error('下载失败');
    } finally {
      setDownloading(false);
    }
  }, [artifact, message, taskId]);

  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-indigo-100 px-3 py-2.5 hover:bg-indigo-50/30">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg icon-emerald shrink-0">
        <FileArchive className="h-[18px] w-[18px]" strokeWidth={1.5} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-slate-900 truncate">{artifact.name}</div>
        <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
          <span className="font-mono">{formatSize(artifact.size)}</span>
          <span className="h-1 w-1 rounded-full bg-slate-300" />
          <span className="font-mono truncate">{artifact.path}</span>
        </div>
      </div>
      <Button size="small" loading={downloading} icon={<Download className="h-3 w-3" strokeWidth={1.5} />} onClick={handleDownload} className="shrink-0">
        下载
      </Button>
    </div>
  );
});

export const ArtifactDownloadButton = memo(function ArtifactDownloadButton({
  artifact,
  taskId,
}: {
  artifact: PackageArtifact;
  taskId: string;
}) {
  const { message } = App.useApp();
  const [downloading, setDownloading] = useState(false);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      const blob = await packageApi.downloadArtifact(taskId, artifact.id);
      saveBlob(blob, artifact.name);
    } catch {
      message.error('下载失败');
    } finally {
      setDownloading(false);
    }
  }, [artifact, message, taskId]);

  return (
    <button
      className="rounded-md p-1.5 text-slate-400 hover:bg-indigo-100 hover:text-indigo-600 shrink-0 disabled:opacity-50"
      onClick={handleDownload}
      disabled={downloading}
    >
      <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
    </button>
  );
});

export const ArtifactList = memo(function ArtifactList({ artifacts, taskId }: { artifacts: PackageTask['artifact_info']; taskId: string }) {
  const list = artifacts || [];
  return (
    <div className="p-4 space-y-3 scrollbar-thin" style={{ minHeight: 420, maxHeight: 560, overflowY: 'auto' }}>
      {list.length === 0 ? (
        <div className="text-center py-12 text-[13px] text-slate-400">暂无产物</div>
      ) : (
        list.map((a) => <ArtifactRow key={a.id} artifact={a} taskId={taskId} />)
      )}
    </div>
  );
});

export const ArtifactPanel = memo(function ArtifactPanel({
  artifacts,
  taskId,
}: {
  artifacts: PackageTask['artifact_info'];
  taskId: string;
}) {
  const list = artifacts || [];
  return (
    <div className="divide-y divide-indigo-50/50 flex-1 overflow-y-auto scrollbar-thin" style={{ maxHeight: 560 }}>
      {list.length === 0 ? (
        <div className="px-4 py-12 text-center text-[13px] text-slate-400">暂无产物</div>
      ) : (
        list.map((a) => (
          <div key={a.id} className="px-4 py-3 hover:bg-indigo-50/30">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg icon-emerald shrink-0">
                <FileArchive className="h-4 w-4" strokeWidth={1.5} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-slate-900 truncate">{a.name}</div>
                <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                  <span className="font-mono">{formatSize(a.size)}</span>
                  <span className="h-1 w-1 rounded-full bg-slate-300" />
                  <span className="font-mono truncate">{a.path}</span>
                </div>
              </div>
              <ArtifactDownloadButton artifact={a} taskId={taskId} />
            </div>
          </div>
        ))
      )}
    </div>
  );
});
