import { memo, useCallback, useMemo, useState } from 'react';
import { Boxes, FolderOpen, Package as PackageIcon, Play, Search, Settings2, Trash2 } from 'lucide-react';
import type { PackageConfig, PackageTask } from '@/types';
import { SvnBrowserDrawer } from '@/components/SvnBrowserDrawer';
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
  const [browsing, setBrowsing] = useState<PackageConfig | null>(null);

  const latestTaskByConfig = useLatestTaskByConfig(tasks);

  const filtered = useMemo(() => {
    return configs.filter((c) => {
      if (keyword) {
        const kw = keyword.toLowerCase();
        const txt = `${c.name} ${c.project_name || ''} ${c.repository_name || ''}`.toLowerCase();
        if (!txt.includes(kw)) return false;
      }
      return true;
    });
  }, [configs, keyword]);

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
        <div className="ml-auto text-[12px] text-slate-400">共 {filtered.length} 条</div>
      </div>
      <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
        <div className="col-span-3">配置名称</div>
        <div className="col-span-2">所属项目</div>
        <div className="col-span-2">关联仓库</div>
        <div className="col-span-2">脚本</div>
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
                onBrowseSvn={setBrowsing}
              />
            );
          })}
        </div>
      )}
      <SvnBrowserDrawer open={!!browsing} config={browsing} onClose={() => setBrowsing(null)} />
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
  onBrowseSvn: (config: PackageConfig) => void;
}

const ConfigRow = memo(function ConfigRow({
  config,
  index,
  latest,
  onEdit,
  onDelete,
  onTrigger,
  onOpenHistory,
  onBrowseSvn,
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

  const handleBrowseSvn = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onBrowseSvn(config);
    },
    [config, onBrowseSvn]
  );

  // 是否启用了 SVN 产物推送（展示「浏览 SVN」入口）
  const svnEnabled = Boolean(config.svn_push_enabled && config.svn_url);

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
            {svnEnabled && <span className="ml-2 text-amber-500">SVN 推送</span>}
          </div>
        </div>
      </div>
      <div className="col-span-6 md:col-span-2 text-[12px] text-slate-600 truncate">{config.project_name || '-'}</div>
      <div className="col-span-6 md:col-span-2 font-mono text-[11px] text-slate-500 truncate">{config.repository_name || '-'}</div>
      <div className="col-span-6 md:col-span-2 text-[12px] text-slate-600">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">{config.custom_script ? "自定义脚本" : "内置脚本"}</span>
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
        {svnEnabled && (
          <button
            title="浏览 SVN 制品目录"
            className="rounded-md p-1.5 text-slate-400 hover:bg-amber-100 hover:text-amber-600"
            onClick={handleBrowseSvn}
          >
            <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        )}
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
