import { memo, useMemo, useState } from 'react';
import { Activity, ChevronRight, Clock3, Layers3, LoaderCircle, Package as PackageIcon, Search } from 'lucide-react';
import type { PackageConfig, PackageTask, Project } from '@/types';
import { formatDuration, isRunning, stageLabels } from './utils';

/** 产品侧栏配色（点 + 图标底色），按产品顺序循环取用 */
const PRODUCT_DOTS = ['bg-indigo-500', 'bg-cyan-400', 'bg-amber-400', 'bg-rose-400', 'bg-emerald-400', 'bg-violet-400'];
const PRODUCT_ICONS = ['bg-cyan-50 text-cyan-600', 'bg-amber-50 text-amber-600', 'bg-rose-50 text-rose-600', 'bg-emerald-50 text-emerald-600', 'bg-violet-50 text-violet-600', 'bg-indigo-50 text-indigo-600'];

interface BoardSidebarProps {
  projects: Project[];
  /** 全量打包配置（未按产品过滤），用于统计各产品配置数 */
  configs: PackageConfig[];
  /** 跨产品进行中 / 排队任务（轮询） */
  runningTasks: PackageTask[];
  selectedProject: string;
  onSelectProject: (projectId: string) => void;
  onOpenTask: (task: PackageTask) => void;
}

export const BoardSidebar = memo(function BoardSidebar({
  projects,
  configs,
  runningTasks,
  selectedProject,
  onSelectProject,
  onOpenTask,
}: BoardSidebarProps) {
  const [keyword, setKeyword] = useState('');

  const configCountByProject = useMemo(() => {
    const map = new Map<string, number>();
    configs.forEach((c) => {
      const key = c.project_id || c.project;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [configs]);

  const runningCountByProject = useMemo(() => {
    const map = new Map<string, number>();
    runningTasks.forEach((t) => {
      map.set(t.project, (map.get(t.project) || 0) + 1);
    });
    return map;
  }, [runningTasks]);

  const filteredProjects = useMemo(() => {
    if (!keyword.trim()) return projects;
    const kw = keyword.trim().toLowerCase();
    return projects.filter((p) => p.name.toLowerCase().includes(kw));
  }, [projects, keyword]);

  const selectProject = (projectId: string) => onSelectProject(selectedProject === projectId ? '' : projectId);

  return (
    // 半透明白面板：仅边框，让工作区网格背景透出（窄屏加轻底保证胶囊区可读）
    <aside className="flex h-fit min-w-0 flex-col self-start rounded-xl border border-indigo-100/80 p-3 max-lg:flex-col max-lg:bg-white/70 lg:sticky lg:top-[84px] lg:max-h-[calc(100vh-140px)]">
      {/* 我的产品：lg 及以上为边框分隔列表，窄屏为横向胶囊筛选条 */}
      <section className="flex max-h-[55%] flex-none flex-col pb-3 max-lg:max-h-none max-lg:pb-0">
        <div className="mb-3 flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Layers3 className="h-3.5 w-3.5 text-indigo-500" strokeWidth={1.5} />
            <span className="text-[12px] font-semibold text-slate-700">我的产品</span>
          </div>
          <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] text-slate-500">{projects.length} 个</span>
        </div>
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-indigo-100/80 bg-white/45 px-2.5 py-2 text-[12px] text-slate-400">
          <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="w-full bg-transparent outline-none placeholder:text-slate-400"
            placeholder="筛选产品"
          />
        </div>

        {/* 桌面端产品列表：上下边框 + 条目分隔线 */}
        <nav className="hidden max-h-[calc(68vh-250px)] min-h-0 flex-1 space-y-0.5 overflow-y-auto rounded-lg border-y border-indigo-100/80 py-1 lg:block">
          <ProductItem
            name="全部产品"
            dotClass="bg-slate-400"
            iconClass="bg-slate-50 text-slate-500"
            meta={`共 ${configs.length} 个配置`}
            active={!selectedProject}
            onClick={() => onSelectProject('')}
          />
          {filteredProjects.map((project, idx) => {
            const configCount = configCountByProject.get(project.id) || 0;
            const runningCount = runningCountByProject.get(project.id) || 0;
            return (
              <ProductItem
                key={project.id}
                name={project.name}
                dotClass={PRODUCT_DOTS[idx % PRODUCT_DOTS.length]}
                iconClass={PRODUCT_ICONS[idx % PRODUCT_ICONS.length]}
                meta={
                  runningCount > 0
                    ? `${configCount} 个配置 · ${runningCount} 个运行中`
                    : configCount > 0
                      ? `${configCount} 个配置 · 空闲`
                      : '暂无打包配置'
                }
                active={selectedProject === project.id}
                onClick={() => selectProject(project.id)}
              />
            );
          })}
          {filteredProjects.length === 0 && (
            <div className="px-2 py-4 text-center text-[11px] text-slate-400">没有匹配的产品</div>
          )}
        </nav>

        {/* 窄屏胶囊筛选条 */}
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 lg:hidden">
          <ProductChip name="全部" dotClass="bg-slate-400" active={!selectedProject} onClick={() => onSelectProject('')} />
          {filteredProjects.map((project, idx) => (
            <ProductChip
              key={project.id}
              name={project.name}
              dotClass={PRODUCT_DOTS[idx % PRODUCT_DOTS.length]}
              active={selectedProject === project.id}
              onClick={() => selectProject(project.id)}
            />
          ))}
          {filteredProjects.length === 0 && (
            <span className="inline-flex h-9 shrink-0 items-center text-[11px] text-slate-400">没有匹配的产品</span>
          )}
        </div>
      </section>

      {/* 正在打包（跨产品实时任务）：仅双栏桌面布局展示 */}
      <section className="hidden min-h-0 flex-1 flex-col pt-4 lg:flex">
        <div className="mb-3 flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-emerald-500" strokeWidth={1.5} />
            <div>
              <div className="text-[12px] font-semibold text-slate-700">正在打包</div>
              <div className="mt-0.5 text-[10px] text-slate-400">实时任务列表</div>
            </div>
          </div>
          {runningTasks.length > 0 && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
              {runningTasks.length} 个任务
            </span>
          )}
        </div>
        <div className="min-h-0 flex-1 divide-y divide-indigo-50/80 overflow-y-auto rounded-lg border-t border-indigo-100/80">
          {runningTasks.length === 0 ? (
            <div className="px-2 py-6 text-center text-[11px] text-slate-400">当前没有进行中的打包任务</div>
          ) : (
            runningTasks.map((task) => (
              <RunningItem key={task.id} task={task} onOpen={onOpenTask} />
            ))
          )}
        </div>
      </section>
    </aside>
  );
});

interface ProductItemProps {
  name: string;
  meta: string;
  dotClass: string;
  iconClass: string;
  active: boolean;
  onClick: () => void;
}

/** 桌面端产品条目：选中态复用主菜单的 nav-active 样式。 */
const ProductItem = memo(function ProductItem({ name, meta, dotClass, iconClass, active, onClick }: ProductItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex min-h-[62px] w-full items-center gap-2.5 rounded-lg border px-2.5 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-inset ${
        active ? 'nav-active' : 'border-transparent text-slate-600 hover:bg-indigo-50/60 hover:text-indigo-600'
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass} ${active ? 'ring-4 ring-indigo-100' : ''}`} />
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          active ? 'bg-white text-indigo-600 shadow-sm' : iconClass
        }`}
      >
        <PackageIcon className="h-4 w-4" strokeWidth={1.5} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium">{name}</span>
        <span className={`mt-0.5 block truncate text-[10px] ${active ? 'text-indigo-400' : 'text-slate-400'}`}>{meta}</span>
      </span>
      {active && (
        <span className="shrink-0 rounded-md bg-white/80 px-1.5 py-0.5 text-[10px] font-medium text-indigo-500">当前</span>
      )}
      <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-indigo-400' : 'text-slate-300'}`} strokeWidth={1.5} />
    </button>
  );
});

interface ProductChipProps {
  name: string;
  dotClass: string;
  active: boolean;
  onClick: () => void;
}

/** 移动端产品胶囊（横向滚动筛选条） */
const ProductChip = memo(function ProductChip({ name, dotClass, active, onClick }: ProductChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1 ${
        active
          ? 'nav-active'
          : 'border-indigo-100/70 bg-white text-slate-600 active:bg-indigo-50'
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
      <span className="max-w-[140px] truncate">{name}</span>
    </button>
  );
});

/** 桌面端实时任务条目：半透明白底，运行中带进度条 */
const RunningItem = memo(function RunningItem({ task, onOpen }: { task: PackageTask; onOpen: (task: PackageTask) => void }) {
  const queued = task.status === 'queued';
  const stageInfo = task.stage_info as { stage?: string } | undefined;
  const progress = task.status === 'running' ? task.progress || 0 : 0;
  return (
    <button
      type="button"
      onClick={() => onOpen(task)}
      className="flex w-full items-center gap-2.5 bg-white/45 px-2.5 py-3 text-left transition-colors hover:bg-white/75 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-200"
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          queued ? 'bg-amber-50 text-amber-500' : 'bg-emerald-50 text-emerald-500'
        }`}
      >
        {queued ? (
          <Clock3 className="h-3.5 w-3.5" strokeWidth={1.5} />
        ) : (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-[11px] font-medium text-slate-700">{task.name}</span>
          {queued ? (
            <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600">排队中</span>
          ) : (
            <span className="shrink-0 font-mono text-[10px] text-emerald-600">{progress}%</span>
          )}
        </span>
        {isRunning(task.status) && !queued && (
          <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-emerald-100">
            <span className="stage-line block h-full rounded-full" style={{ width: `${progress}%` }} />
          </span>
        )}
        <span className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-400">
          <span className="truncate">
            {task.project_name || '-'} ·{' '}
            {queued ? '等待节点' : `运行 ${formatDuration(task.duration)}`}
            {task.status === 'running' && stageInfo?.stage ? ` · ${stageLabels[stageInfo.stage] || stageInfo.stage}` : ''}
          </span>
          {task.version && <span className="shrink-0 font-mono">{task.version}</span>}
        </span>
      </span>
    </button>
  );
});
