import { memo, useCallback, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Button } from 'antd';
import { ChevronRight, Package as PackageIcon, Plus, Settings2 } from 'lucide-react';
import type { PackageConfig, PackageTask } from '@/types';
import { packageApi } from '@/api/package';
import { BuildHistory, ArtifactListPanel } from './BuildHistory';
import { TerminalLog } from './TerminalLog';
import { ArtifactActionsDropdown } from './Artifacts';
import { downloadTaskLog, isRunning } from './utils';
import { StatusBadge, SvnPushWarning } from './Shared';

interface DetailViewProps {
  config?: PackageConfig | null;
  task: PackageTask;
  builds: PackageTask[];
  logText: string;
  onBack: () => void;
  onLoadTaskLog: (taskId: string) => Promise<{ task: PackageTask; logText: string; logPartial?: boolean }>;
  onCancel: (task: PackageTask) => void;
  onEditConfig: () => void;
  onTriggerBuild: () => void;
  hideHeader?: boolean;
}

export const DetailView = memo(function DetailView({
  config,
  task,
  builds,
  logText,
  onBack,
  onLoadTaskLog,
  onCancel,
  onEditConfig,
  onTriggerBuild,
  hideHeader,
}: DetailViewProps) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'log' | 'artifacts'>('log');
  const [activeBuild, setActiveBuild] = useState<PackageTask>(task);
  const [activeLogText, setActiveLogText] = useState<string>(logText);
  const [activeLogPartial, setActiveLogPartial] = useState(false);
  const [pushing, setPushing] = useState(false);

  const loadLog = useCallback(async (taskId: string) => {
    const { task: t, logText: text, logPartial: partial } = await onLoadTaskLog(taskId);
    setActiveBuild(t);
    setActiveLogText(text);
    setActiveLogPartial(partial ?? false);
  }, [onLoadTaskLog]);

  useEffect(() => {
    const id = task.id;
    const timer = window.setTimeout(() => loadLog(id), 0);
    return () => window.clearTimeout(timer);
  }, [task.id, loadLog]);

  useEffect(() => {
    if (!isRunning(activeBuild.status)) return;
    const timer = window.setInterval(() => loadLog(activeBuild.id), 3000);
    return () => window.clearInterval(timer);
  }, [activeBuild.id, activeBuild.status, loadLog]);

  const artifacts = activeBuild.artifact_info || [];

  const pushSvnMutation = useMutation({
    mutationFn: () => packageApi.pushSvn(activeBuild.id),
    onSuccess: () => {
      message.success('已推送到 SVN');
      queryClient.invalidateQueries({ queryKey: ['package-tasks'] });
      loadLog(activeBuild.id);
    },
    onSettled: () => setPushing(false),
  });

  const handlePushSvn = () => {
    setPushing(true);
    pushSvnMutation.mutate();
  };

  const handleSelectBuild = useCallback(
    (taskId: string) => {
      loadLog(taskId);
    },
    [loadLog]
  );

  return (
    <div className="space-y-5 page-fade-in">
      {!hideHeader && (
        <>
          <div className="flex items-center gap-2 text-[13px]">
            <button onClick={onBack} className="text-slate-400 hover:text-indigo-600 cursor-pointer">打包看板</button>
            <ChevronRight className="h-3.5 w-3.5 text-slate-300" strokeWidth={1.5} />
            <span className="font-medium text-slate-800">{config ? config.name : task.name}</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg icon-indigo">
                <PackageIcon className="h-[18px] w-[18px]" strokeWidth={1.5} />
              </div>
              <div>
                <div className="text-[15px] font-semibold tracking-tight text-slate-900">{config ? config.name : task.name}</div>
                <div className="font-mono text-[10px] text-slate-400">{task.repository_name || '-'} · {task.project_name || '-'}</div>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {task.config && (
                <button
                  className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium text-white"
                  onClick={onTriggerBuild}
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                  新建打包
                </button>
              )}
              <Button icon={<Settings2 className="h-3.5 w-3.5" strokeWidth={1.5} />} onClick={onEditConfig}>打包配置</Button>
            </div>
          </div>
        </>
      )}

      <SvnPushWarning task={activeBuild} pushing={pushing} onRetry={handlePushSvn} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <BuildHistory builds={builds} activeBuildId={activeBuild.id} onSelect={handleSelectBuild} onCancel={onCancel} />

        <div className="lg:col-span-4 tech-card rounded-xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between border-b border-indigo-50 px-4">
            <div className="flex items-center gap-1">
              <button
                className={`lt-tab whitespace-nowrap border-b-2 px-3 py-3 text-[13px] font-medium ${activeTab === 'log' ? 'on' : 'text-slate-500 border-transparent hover:text-indigo-600'}`}
                onClick={() => setActiveTab('log')}
              >
                构建日志
              </button>
              <button
                className={`lt-tab whitespace-nowrap border-b-2 px-3 py-3 text-[13px] font-medium ${activeTab === 'artifacts' ? 'on' : 'text-slate-500 border-transparent hover:text-indigo-600'}`}
                onClick={() => setActiveTab('artifacts')}
              >
                打包产物
                {artifacts.length > 0 && <span className="ml-1 rounded bg-slate-100 px-1 py-0 text-[10px] font-medium text-slate-500">{artifacts.length}</span>}
              </button>
            </div>
            <div className="flex items-center gap-2">
              {activeTab === 'artifacts' && artifacts.length > 0 && (
                <ArtifactActionsDropdown task={activeBuild} pushing={pushing} onPushSvn={handlePushSvn} />
              )}
              <span className="font-mono text-[12px] text-slate-500">{activeBuild.version}</span>
              <StatusBadge status={activeBuild.status} />
            </div>
          </div>
          {activeTab === 'log' ? (
            <TerminalLog
              text={activeLogText}
              partial={activeLogPartial}
              onDownloadFull={() => downloadTaskLog(activeBuild.id)}
            />
          ) : (
            <ArtifactListPanel artifacts={artifacts} taskId={activeBuild.id} />
          )}
        </div>
      </div>
    </div>
  );
});
