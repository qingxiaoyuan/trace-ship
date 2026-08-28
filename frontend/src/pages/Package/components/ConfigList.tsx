import { memo, useCallback, useMemo, useState } from 'react';
import { Boxes, FolderOpen, GitBranch, Package as PackageIcon, Play, Search, Settings2, Star, Trash2 } from 'lucide-react';
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
  /** 切换收藏（星标），由父组件负责乐观更新与缓存失效 */
  onToggleFavorite: (config: PackageConfig) => void;
}

export const ConfigList = memo(function ConfigList({
  configs,
  tasks,
  loading,
  onEdit,
  onDelete,
  onTrigger,
  onOpenHistory,
  onToggleFavorite,
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
        <div className="col-span-4">配置名称</div>
        <div className="col-span-2">关联仓库</div>
        <div className="col-span-2">脚本</div>
        <div className="col-span-2">最近打包</div>
        <div className="col-span-2 text-right">操作</div>
      </div>
      {loading ? (
        <div className="px-5 py-12 text-center text-[13px] text-slate-400">加载中…</div>
      ) : filtered.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <Boxes className="mx-auto h-10 w-10 text-slate-300" strokeWidth={1.5} />
          <p className="mt-3 text-[13px] text-slate-400">暂无打包配置</p>
        </div>
      ) : (
        <div className="divide-y divide-indigo-50/50 max-md:divide-y-0 max-md:space-y-3 max-md:p-3">
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
                onToggleFavorite={onToggleFavorite}
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
  onToggleFavorite: (config: PackageConfig) => void;
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
  onToggleFavorite,
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

  const handleToggleFavorite = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleFavorite(config);
    },
    [config, onToggleFavorite]
  );

  // 星标收藏按钮：收藏时实心 amber，未收藏 slate 描边，hover 高亮
  const favoriteButton = (className: string, iconClass: string) => (
    <button
      type="button"
      title={config.is_favorite ? '取消收藏' : '收藏为常用配置'}
      className={`${className} ${
        config.is_favorite ? 'text-amber-400' : 'text-slate-300 hover:text-amber-400'
      }`}
      onClick={handleToggleFavorite}
    >
      <Star className={iconClass} strokeWidth={1.5} fill={config.is_favorite ? 'currentColor' : 'none'} />
    </button>
  );

  // 是否启用了 SVN 产物推送（展示「浏览 SVN」入口）
  const svnEnabled = Boolean(config.svn_push_enabled && config.svn_url);
  // 打包配置参数仅项目管理员 / 软件管理员可维护（后端 my_role：超管返回 software_admin）
  const canManage = config.my_role === 'software_admin' || config.my_role === 'manager';

  return (
    <div
      className={`cursor-pointer transition-colors max-md:rounded-xl max-md:border max-md:bg-white max-md:p-4 ${
        config.is_favorite
          ? 'bg-amber-50/40 hover:bg-amber-50/60 max-md:border-amber-200/70'
          : 'hover:bg-indigo-50/30 max-md:border-indigo-100/70'
      }`}
      onClick={handleClick}
    >
      {/* 桌面端网格行 */}
      <div className="hidden grid-cols-12 items-center gap-3 px-5 py-3 md:grid">
        <div className="col-span-12 md:col-span-4 flex items-center gap-2.5">
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
        <div className="col-span-6 font-mono text-[11px] text-slate-500 truncate md:col-span-2">{config.repository_name || '-'}</div>
        <div className="col-span-6 text-[12px] text-slate-600 md:col-span-2">
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
        <div className="col-span-12 md:col-span-2 flex items-center justify-end gap-1">
          {favoriteButton('rounded-md p-1.5', 'h-3.5 w-3.5')}
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
          {/* 无权限用户也可查看配置（只读，用于参考模仿） */}
          <button
            title={canManage ? '编辑配置' : '查看配置（只读）'}
            className="rounded-md p-1.5 text-slate-400 hover:bg-indigo-100 hover:text-indigo-600"
            onClick={handleEdit}
          >
            <Settings2 className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
          {canManage && (
            <button
              title="删除配置"
              className="rounded-md p-1.5 text-slate-400 hover:bg-rose-100 hover:text-rose-600"
              onClick={handleDelete}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>

      {/* 移动端卡片（参考 docs/ui/mobile/mobile-release.html） */}
      <div className="md:hidden">
        <div className="flex items-center justify-between">
          <span
            className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
              config.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'
            }`}
          >
            {config.is_active ? '已启用' : '已停用'}
          </span>
          <div className="flex items-center gap-1.5">
            {config.auto_package_on_release && (
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-600">发布自动打包</span>
            )}
            {svnEnabled && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-600">SVN 推送</span>
            )}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold tracking-tight text-slate-900">{config.name}</span>
          <span className="shrink-0 truncate text-[12px] text-slate-400">{config.project_name || '-'}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
          <GitBranch className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
          <span className="truncate font-mono">{config.repository_name || '-'}</span>
          <span className="shrink-0 text-slate-200">|</span>
          <span className="shrink-0">{config.custom_script ? '自定义脚本' : '内置脚本'}</span>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-indigo-50 pt-3">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            {latest ? (
              <>
                <StatusBadge status={latest.status} />
                <span>{formatRelativeTime(latest.created_at)}</span>
              </>
            ) : (
              <span>暂无打包记录</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {favoriteButton('inline-flex h-9 w-9 items-center justify-center rounded-md', 'h-4 w-4')}
            {svnEnabled && (
              <button
                title="浏览 SVN 制品目录"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-400 hover:bg-amber-100 hover:text-amber-600"
                onClick={handleBrowseSvn}
              >
                <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            )}
            <button
              title="触发打包"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-400 hover:bg-indigo-100 hover:text-indigo-600"
              onClick={handleTrigger}
            >
              <Play className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
            {/* 无权限用户也可查看配置（只读，用于参考模仿） */}
            <button
              title={canManage ? '编辑配置' : '查看配置（只读）'}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-400 hover:bg-indigo-100 hover:text-indigo-600"
              onClick={handleEdit}
            >
              <Settings2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
            {canManage && (
              <button
                title="删除配置"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-400 hover:bg-rose-100 hover:text-rose-600"
                onClick={handleDelete}
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
