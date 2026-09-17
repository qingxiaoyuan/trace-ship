import { memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Play, RotateCw } from 'lucide-react';
import type { FavoritePackageConfig, PackageTaskStatus } from '@/types';
import type { PackageTriggerTarget } from './PackageTriggerModal';

interface FavoriteConfigCardProps {
  config: FavoritePackageConfig;
  onTrigger: (target: PackageTriggerTarget) => void;
}

const isRunningStatus = (status?: PackageTaskStatus) => status === 'queued' || status === 'running';

/**
 * 常用配置卡片（设计稿 package-favorites-design.html 的侧栏 / 二级卡片样式）：
 * 状态点 + 配置名 + 项目·仓库 + 执行方式·节点/镜像 + 最近一次结果 + 按状态分派的操作按钮。
 */
export const FavoriteConfigCard = memo(function FavoriteConfigCard({
  config,
  onTrigger,
}: FavoriteConfigCardProps) {
  const navigate = useNavigate();
  const lastTask = config.last_task;
  const status = lastTask?.status;
  const running = isRunningStatus(status);

  const handleAction = useCallback(() => {
    if (running && lastTask) {
      navigate(`/packages/${lastTask.id}`);
      return;
    }
    onTrigger({
      id: config.id,
      name: config.name,
      repository_name: config.repository_name,
      project: config.project_id,
      repository: config.repository_id,
    });
  }, [config, lastTask, navigate, onTrigger, running]);

  // 卡片与状态点配色：进行中 cyan / 失败 rose / 成功 emerald / 其余 slate
  const cardClass = running
    ? 'border-cyan-200/80 bg-cyan-50/30 hover:border-cyan-300'
    : status === 'failure'
      ? 'border-rose-200/70 bg-rose-50/30 hover:border-rose-300'
      : 'border-slate-200/80 bg-slate-50/50 hover:border-indigo-300';
  const dotClass = running
    ? 'animate-pulse bg-cyan-500'
    : status === 'success'
      ? 'bg-emerald-500'
      : status === 'failure'
        ? 'bg-rose-500'
        : 'bg-slate-400';
  const buttonClass = running
    ? 'border-cyan-200 text-cyan-500 hover:border-cyan-400 hover:text-cyan-600'
    : status === 'failure'
      ? 'border-rose-200 text-rose-400 hover:border-rose-300 hover:text-rose-500'
      : 'border-slate-200 text-slate-400 hover:border-indigo-300 hover:text-indigo-600';
  const actionTitle = running ? '查看进度' : status === 'failure' ? '重新打包' : '触发打包';

  // 最近一次结果：成功 / 失败 / 进行中着色，未打包显示占位文案
  const resultText = lastTask
    ? `${lastTask.version || ''} ${lastTask.status_display || ''}`.trim()
    : '尚未打包';
  const resultClass = !lastTask
    ? 'text-slate-400'
    : running
      ? 'font-medium text-cyan-600'
      : status === 'success'
        ? 'font-medium text-emerald-600'
        : status === 'failure'
          ? 'font-medium text-rose-500'
          : 'text-slate-400';

  return (
    <div className={`group rounded-lg border p-3 transition-all hover:bg-white hover:shadow-sm ${cardClass}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-[13px] font-semibold tracking-tight text-slate-900">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
            {config.name}
          </p>
          <p className="mt-1 truncate text-[11px] text-slate-400">
            {config.project_name || '-'} · {config.repository_name || '-'}
          </p>
        </div>
        <button
          type="button"
          title={actionTitle}
          onClick={handleAction}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-white transition-all group-hover:shadow-sm max-md:h-9 max-md:w-9 ${buttonClass}`}
        >
          {running ? (
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
          ) : status === 'failure' ? (
            <RotateCw className="h-3 w-3" strokeWidth={1.5} />
          ) : (
            <Play className="h-3 w-3" strokeWidth={1.5} />
          )}
        </button>
      </div>
      <p className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-slate-400">
        <span className="truncate">
          {config.executor_type_display || '-'} · {config.node_name || config.image_name || '-'}
        </span>
        <span className={`shrink-0 ${resultClass}`}>{resultText}</span>
      </p>
    </div>
  );
});
