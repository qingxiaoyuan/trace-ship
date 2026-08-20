import { useState } from 'react';
import { Select, App } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
  HeartPulse,
  Plus,
  Search,
} from 'lucide-react';
import { RepositoryModal } from './modals/RepositoryModal';
import { repositoryApi } from '@/api/repository';
import { projectApi } from '@/api/project';
import { repoTypeBadge, healthDisplay } from './constants';
import type { Repository } from '@/types';

/** 仓库类型选项 */
const repoTypeOptions = [
  { label: 'Git', value: 'git' },
  { label: 'SVN', value: 'svn' },
];

/** 统计卡配置 */
const statCards = [
  { key: 'total', label: '仓库总数', icon: GitFork, iconClass: 'icon-indigo' },
  { key: 'healthy_count', label: '健康', icon: HeartPulse, iconClass: 'icon-emerald' },
  { key: 'git_count', label: 'Git 仓库', icon: GitBranch, iconClass: 'icon-cyan' },
  { key: 'svn_count', label: 'SVN 仓库', icon: GitCommitHorizontal, iconClass: 'icon-amber' },
] as const;

/** 移动端健康状态软底徽标 */
const healthSoftBadge: Record<Repository['health_status'], string> = {
  healthy: 'bg-emerald-50 text-emerald-600',
  unhealthy: 'bg-rose-50 text-rose-600',
  unknown: 'bg-slate-100 text-slate-500',
};

/** 相对时间 */
function relativeTime(value?: string): string {
  if (!value) return '-';
  const diff = Date.now() - new Date(value).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 60) return min <= 1 ? '刚刚' : `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  return `${d} 天前`;
}

export default function RepositoryList() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [project, setProject] = useState<string | undefined>(undefined);
  const [repoType, setRepoType] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRepo, setEditingRepo] = useState<Repository | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['repositories', keyword, project, repoType, page],
    queryFn: () =>
      repositoryApi.getRepositories({
        page,
        page_size: pageSize,
        keyword: keyword || undefined,
        project: project || undefined,
        repo_type: repoType || undefined,
      }),
  });
  const { data: stats } = useQuery({
    queryKey: ['repository-stats'],
    queryFn: () => repositoryApi.getRepositoryStats(),
  });
  const { data: projectData } = useQuery({
    queryKey: ['projects-all'],
    queryFn: () => projectApi.getProjects({ page_size: 1000 }),
  });

  const results = data?.results || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const projectOptions = (projectData?.results || []).map((p) => ({ label: p.name, value: p.id }));

  const handleSave = async (values: Partial<Repository>) => {
    try {
      if (editingRepo?.id) {
        await repositoryApi.updateRepository(editingRepo.id, values);
      } else {
        await repositoryApi.createRepository(values);
      }
      message.success('保存成功');
      setModalOpen(false);
      setEditingRepo(null);
      setPage(1);
      refetch();
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="space-y-5 ts-fade-in-up">
      {/* 标题区 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">仓库</h1>
          <p className="mt-1 text-[13px] text-slate-500">管理 Git / SVN 代码仓库，追踪提交与分支</p>
        </div>
        <button
          type="button"
          onClick={() => { setEditingRepo(null); setModalOpen(true); }}
          className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          关联仓库
        </button>
      </div>

      {/* 统计卡 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.key} className="tech-card flex items-center gap-3 rounded-xl p-4">
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${card.iconClass}`}>
                <Icon className="h-[18px] w-[18px]" strokeWidth={1.5} />
              </div>
              <div>
                <div className="font-mono text-[20px] font-semibold tracking-tight text-slate-900">
                  {stats?.[card.key] ?? 0}
                </div>
                <div className="text-[11px] text-slate-400">{card.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 列表卡片 */}
      <div className="tech-card overflow-hidden rounded-xl">
        {/* 搜索过滤栏 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-indigo-50 px-5 py-3">
          <div className="relative w-full sm:w-[240px]">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" strokeWidth={1.5} />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setPage(1)}
              placeholder="搜索仓库名称/URL"
              className="w-full rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 placeholder-slate-400 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <Select
            allowClear
            placeholder="类型"
            style={{ width: 120 }}
            value={repoType}
            onChange={(v: string | undefined) => { setRepoType(v); setPage(1); }}
            options={repoTypeOptions}
          />
          <Select
            allowClear
            placeholder="项目"
            style={{ width: 176 }}
            value={project}
            onChange={(v: string | undefined) => { setProject(v); setPage(1); }}
            options={projectOptions}
          />
          <div className="ml-auto text-[12px] text-slate-400">共 {total} 条</div>
        </div>

        {/* 表头 */}
        <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
          <div className="col-span-3">仓库名称</div>
          <div className="col-span-2">所属项目</div>
          <div className="col-span-2">类型</div>
          <div className="col-span-2">默认分支</div>
          <div className="col-span-2">健康</div>
          <div className="col-span-1 text-right">同步</div>
        </div>

        {/* 行 */}
        <div className="divide-y divide-indigo-50/50 max-h-[calc(100vh-340px)] overflow-y-auto max-md:max-h-none max-md:divide-y-0 max-md:space-y-3 max-md:p-3">
          {isLoading ? (
            <div className="px-5 py-10 text-center text-[13px] text-slate-400">加载中…</div>
          ) : results.length === 0 ? (
            <div className="px-5 py-10 text-center text-[13px] text-slate-400">暂无仓库</div>
          ) : (
            results.map((record) => {
              const badge = repoTypeBadge(record);
              const health = healthDisplay(record.health_status);
              return (
                <div
                  key={record.id}
                  onClick={() => navigate(`/repositories/${record.id}`)}
                  className="cursor-pointer transition-colors hover:bg-indigo-50/30 max-md:rounded-xl max-md:border max-md:border-indigo-100/70 max-md:bg-white max-md:p-4"
                >
                  {/* 桌面端网格行 */}
                  <div className="hidden grid-cols-12 items-center gap-3 px-5 py-3 md:grid">
                    <div className="col-span-12 flex items-center gap-2.5 md:col-span-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg icon-indigo">
                        <GitBranch className="h-4 w-4" strokeWidth={1.5} />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium text-slate-900">{record.name}</div>
                        <div className="truncate font-mono text-[10px] text-slate-400">
                          {record.clone_url || record.url}
                        </div>
                      </div>
                    </div>
                    <div className="col-span-6 truncate text-[12px] text-slate-600 md:col-span-2">
                      {record.project_name || '-'}
                    </div>
                    <div className="col-span-6 md:col-span-2">
                      <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium ${badge.cls}`}>
                        {badge.text}
                      </span>
                    </div>
                    <div className="col-span-6 flex items-center gap-1 font-mono text-[12px] text-slate-600 md:col-span-2">
                      <GitBranch className="h-3 w-3 text-indigo-400" strokeWidth={1.5} />
                      {record.default_branch || '-'}
                    </div>
                    <div className="col-span-6 md:col-span-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${health.cls}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${health.dot}`} />
                        {health.text}
                      </span>
                    </div>
                    <div className="col-span-6 flex items-center justify-end gap-1 text-right md:col-span-1">
                      <span className="text-[11px] text-slate-400">{relativeTime(record.last_sync_at)}</span>
                    </div>
                  </div>

                  {/* 移动端卡片（参考 docs/ui/mobile/mobile-release.html） */}
                  <div className="md:hidden">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${healthSoftBadge[record.health_status]}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${health.dot}`} />
                        {health.text}
                      </span>
                      <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-indigo-600">
                        {badge.text}
                      </span>
                    </div>
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="min-w-0 truncate text-[15px] font-semibold tracking-tight text-slate-900">
                        {record.name}
                      </span>
                      <span className="min-w-0 truncate text-[12px] text-slate-400">{record.project_name || '-'}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                      <GitBranch className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                      <span className="shrink-0 font-mono">{record.default_branch || '-'}</span>
                      <span className="shrink-0 text-slate-200">|</span>
                      <span className="min-w-0 truncate font-mono">{record.clone_url || record.url}</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-indigo-50 pt-3">
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                        <Clock className="h-3.5 w-3.5" strokeWidth={1.5} />
                        同步 {relativeTime(record.last_sync_at)}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" strokeWidth={1.5} />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 分页 */}
        {total > 0 ? (
          <div className="flex items-center justify-between border-t border-indigo-50 px-5 py-3">
            <div className="text-[12px] text-slate-400">
              第 {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)} 条 / 共 {total} 条
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="flex h-7 w-7 max-md:h-9 max-md:w-9 items-center justify-center rounded-md border border-indigo-100 text-slate-400 transition-colors hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => Math.abs(p - page) <= 1 || p === 1 || p === totalPages)
                .map((p, idx, arr) => (
                  <span key={p} className="flex items-center">
                    {idx > 0 && arr[idx - 1] !== p - 1 ? (
                      <span className="px-1 text-slate-400">…</span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setPage(p)}
                      className={
                        p === page
                          ? 'flex h-7 w-7 max-md:h-9 max-md:w-9 items-center justify-center rounded-md bg-indigo-500 text-[12px] font-medium text-white'
                          : 'flex h-7 w-7 max-md:h-9 max-md:w-9 items-center justify-center rounded-md border border-indigo-100 text-[12px] font-medium text-slate-600 transition-colors hover:bg-indigo-50'
                      }
                    >
                      {p}
                    </button>
                  </span>
                ))}
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="flex h-7 w-7 max-md:h-9 max-md:w-9 items-center justify-center rounded-md border border-indigo-100 text-slate-400 transition-colors hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <RepositoryModal
        open={modalOpen}
        repo={editingRepo}
        onCancel={() => { setModalOpen(false); setEditingRepo(null); }}
        onOk={handleSave}
      />
    </div>
  );
}
