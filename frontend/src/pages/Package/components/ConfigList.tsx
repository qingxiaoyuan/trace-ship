import { memo, useCallback, useMemo, useState } from 'react';
import { Boxes, Package as PackageIcon, Play, Search, Settings2, Trash2 } from 'lucide-react';
import type { PackageBuildType, PackageConfig, PackageMode, PackageTask } from '@/types';
import { useLatestTaskByConfig } from './useLatestTaskByConfig';
import { formatRelativeTime, iconColors } from './utils';
import { StatusBadge } from './Shared';

interface ConfigListProps {
  configs: PackageConfig[];
  tasks: PackageTask[];
  loading: boolean;
  onEdit: (config: PackageConfig) => void;
  onDelete: (config: PackageConfig) => void;
  onTrigger: (config: PackageConfig) => void;
  onOpenHistory: (config: PackageConfig) => void;
}

export const ConfigList = memo(function ConfigList({
  configs,
  tasks,
  loading,
  onEdit,
  onDelete,
  onTrigger,
  onOpenHistory,
}: ConfigListProps) {
  const [keyword, setKeyword] = useState('');
  const [modeFilter, setModeFilter] = useState<PackageMode | ''>('');
  const [typeFilter, setTypeFilter] = useState<PackageBuildType | ''>('');

  const latestTaskByConfig = useLatestTaskByConfig(tasks);

  const filtered = useMemo(() => {
    return configs.filter((c) => {
      if (keyword) {
        const kw = keyword.toLowerCase();
        const txt = `${c.name} ${c.project_name || ''} ${c.repository_name || ''}`.toLowerCase();
        if (!txt.includes(kw)) return false;
      }
      if (modeFilter && c.mode !== modeFilter) return false;
      if (typeFilter && c.build_type !== typeFilter) return false;
      return true;
    });
  }, [configs, keyword, modeFilter, typeFilter]);

  return (
    <div className="tech-card rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-indigo-50 px-5 py-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />
          <input
            type="text"
            placeholder="搜索配置名称 / 项目 / 仓库"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="w-[240px] rounded-lg border border-indigo-100 bg-white pl-8 pr-3 py-1.5 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <select
          value={modeFilter}
          onChange={(e) => setModeFilter(e.target.value as PackageMode | '')}
          className="rounded-lg border border-indigo-100 bg-white px-3 py-1.5 text-[13px] text-slate-600 outline-none hover:bg-indigo-50 hover:text-indigo-600 cursor-pointer"
        >
          <option value="">全部模式</option>
          <option value="simple">简易打包</option>
          <option value="local">本地脚本</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as PackageBuildType | '')}
          className="rounded-lg border border-indigo-100 bg-white px-3 py-1.5 text-[13px] text-slate-600 outline-none hover:bg-indigo-50 hover:text-indigo-600 cursor-pointer"
        >
          <option value="">全部类型</option>
          <option value="web">Web</option>
          <option value="qt">Qt</option>
        </select>
        <div className="ml-auto text-[12px] text-slate-400">共 {filtered.length} 条</div>
      </div>
      <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
        <div className="col-span-3">配置名称</div>
        <div className="col-span-2">所属项目</div>
        <div className="col-span-2">关联仓库</div>
        <div className="col-span-2">模式 / 类型</div>
        <div className="col-span-2">最近打包</div>
        <div className="col-span-1 text-right">操作</div>
      </div>
      {loading ? (
        <div className="px-5 py-12 text-center text-[13px] text-slate-400">加载中…</div>
      ) : filtered.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <Boxes className="mx-auto h-10 w-10 text-slate-300" strokeWidth={1.5} />
          <p className="mt-3 text-[13px] text-slate-400">暂无打包配置</p>
        </div>
      ) : (
        <div className="divide-y divide-indigo-50/50">
          {filtered.map((config, idx) => {
            const latest = config.id ? latestTaskByConfig.get(config.id) : undefined;
            return (
              <ConfigRow
                key={config.id}
                config={config}
                index={idx}
                latest={latest}
                onEdit={onEdit}
                onDelete={onDelete}
                onTrigger={onTrigger}
                onOpenHistory={onOpenHistory}
              />
            );
          })}
        </div>
      )}
    </div>
  );
});

interface ConfigRowProps {
  config: PackageConfig;
  index: number;
  latest?: PackageTask;
  onEdit: (config: PackageConfig) => void;
  onDelete: (config: PackageConfig) => void;
  onTrigger: (config: PackageConfig) => void;
  onOpenHistory: (config: PackageConfig) => void;
}

const ConfigRow = memo(function ConfigRow({
  config,
  index,
  latest,
  onEdit,
  onDelete,
  onTrigger,
  onOpenHistory,
}: ConfigRowProps) {
  const handleClick = useCallback(() => {
    onOpenHistory(config);
  }, [config, onOpenHistory]);

  const handleTrigger = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onTrigger(config);
    },
    [config, onTrigger]
  );

  const handleEdit = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onEdit(config);
    },
    [config, onEdit]
  );

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDelete(config);
    },
    [config, onDelete]
  );

  return (
    <div
      className="grid grid-cols-12 gap-3 items-center px-5 py-3 hover:bg-indigo-50/30 cursor-pointer"
      onClick={handleClick}
    >
      <div className="col-span-12 md:col-span-3 flex items-center gap-2.5">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconColors[index % iconColors.length]}`}>
          <PackageIcon className="h-4 w-4" strokeWidth={1.5} />
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-slate-900 truncate">{config.name}</div>
          <div className="text-[10px] text-slate-400">
            {config.is_active ? '已启用' : '已停用'}
            {config.auto_package_on_release && <span className="ml-2 text-indigo-500">发布自动打包</span>}
          </div>
        </div>
      </div>
      <div className="col-span-6 md:col-span-2 text-[12px] text-slate-600 truncate">{config.project_name || '-'}</div>
      <div className="col-span-6 md:col-span-2 font-mono text-[11px] text-slate-500 truncate">{config.repository_name || '-'}</div>
      <div className="col-span-6 md:col-span-2 text-[12px] text-slate-600">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">{config.mode_display || config.mode}</span>
        <span className="ml-1.5 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-600">{config.build_type_display || config.build_type}</span>
      </div>
      <div className="col-span-6 md:col-span-2">
        {latest ? (
          <div className="flex items-center gap-1.5 text-left pointer-events-none">
            <StatusBadge status={latest.status} />
            <span className="text-[11px] text-slate-400">{formatRelativeTime(latest.created_at)}</span>
          </div>
        ) : (
          <span className="text-[12px] text-slate-400">-</span>
        )}
      </div>
      <div className="col-span-12 md:col-span-1 flex items-center justify-end gap-1">
        <button
          title="触发打包"
          className="rounded-md p-1.5 text-slate-400 hover:bg-indigo-100 hover:text-indigo-600"
          onClick={handleTrigger}
        >
          <Play className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
        <button
          title="编辑配置"
          className="rounded-md p-1.5 text-slate-400 hover:bg-indigo-100 hover:text-indigo-600"
          onClick={handleEdit}
        >
          <Settings2 className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
        <button
          title="删除配置"
          className="rounded-md p-1.5 text-slate-400 hover:bg-rose-100 hover:text-rose-600"
          onClick={handleDelete}
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
});
