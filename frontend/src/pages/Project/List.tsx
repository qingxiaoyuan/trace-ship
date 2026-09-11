import { useState } from 'react';
import { Select, App } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  FolderKanban,
  GitFork,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
} from 'lucide-react';
import { ProjectModal } from './modals/ProjectModal';
import { projectApi } from '@/api/project';
import { getAvatarColor } from '@/utils/avatar';
import type { Project, ProjectStatus } from '@/types';

/** 产品状态选项 */
const projectStatusOptions = [
  { label: '启用', value: 'active' },
  { label: '停用', value: 'inactive' },
];

/** 统计卡配置 */
const statCards = [
  { key: 'total', label: '产品总数', icon: FolderKanban, iconClass: 'icon-indigo' },
  { key: 'active_count', label: '启用中', icon: CircleDot, iconClass: 'icon-emerald' },
  { key: 'repo_total', label: '关联仓库', icon: GitFork, iconClass: 'icon-cyan' },
  { key: 'member_total', label: '产品成员', icon: Users, iconClass: 'icon-violet' },
] as const;

/** 产品状态徽标 */
function StatusBadge({ status }: { status: ProjectStatus }) {
  const active = status === 1 || status === 'active';
  return (
    <span
      className={
        active
          ? 'inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700'
          : 'inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-500'
      }
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
      {active ? '启用' : '停用'}
    </span>
  );
}

export default function ProjectList() {
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<ProjectStatus | undefined>(undefined);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [modalOpen, setModalOpen] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['projects', keyword, status, page],
    queryFn: () =>
      projectApi.getProjects({
        page,
        page_size: pageSize,
        keyword: keyword || undefined,
        status,
      }),
  });
  const { data: stats } = useQuery({
    queryKey: ['project-stats'],
    queryFn: () => projectApi.getProjectStats(),
  });

  const results = data?.results || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handleAdd = async (values: Partial<Project>) => {
    try {
      await projectApi.createProject(values);
      message.success('新增成功');
      setModalOpen(false);
      setPage(1);
      refetch();
    } catch (error) {
      console.error(error);
    }
  };

  const handleDelete = (record: Project) => {
    modal.confirm({
      title: '确认删除产品',
      content: `确定要删除「${record.name}」吗？删除后不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      async onOk() {
        try {
          await projectApi.deleteProject(record.id);
          message.success('删除成功');
          refetch();
        } catch (error) {
          console.error(error);
        }
      },
    });
  };

  return (
    <div className="space-y-5 ts-fade-in-up">
      {/* 标题区 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">产品</h1>
          <p className="mt-1 text-[13px] text-slate-500">管理产品关联的仓库、成员、审批与打包配置</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[13px] font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
          >
            <ArrowUpDown className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span>排序</span>
          </button>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span>新增产品</span>
          </button>
        </div>
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
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" strokeWidth={1.5} />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setPage(1)}
              placeholder="搜索产品编码/名称"
              className="w-full sm:w-[240px] rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 placeholder-slate-400 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <Select
            allowClear
            placeholder="全部状态"
            style={{ width: 144 }}
            value={status}
            onChange={(v: ProjectStatus | undefined) => {
              setStatus(v);
              setPage(1);
            }}
            options={projectStatusOptions}
          />
          <div className="ml-auto text-[12px] text-slate-400">共 {total} 条</div>
        </div>

        {/* 表头 */}
        <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
          <div className="col-span-2">编码</div>
          <div className="col-span-3">产品名称</div>
          <div className="col-span-2">负责人</div>
          <div className="col-span-1 text-center">仓库</div>
          <div className="col-span-2">状态</div>
          <div className="col-span-2 text-right">操作</div>
        </div>

        {/* 行 */}
        <div className="divide-y divide-indigo-50/50 max-md:divide-y-0 max-md:space-y-3 max-md:p-3 max-h-[calc(100vh-340px)] overflow-y-auto max-md:max-h-none">
          {isLoading ? (
            <div className="px-5 py-10 text-center text-[13px] text-slate-400">加载中…</div>
          ) : results.length === 0 ? (
            <div className="px-5 py-10 text-center text-[13px] text-slate-400">暂无产品</div>
          ) : (
            results.map((record) => (
              <div
                key={record.id}
                onClick={() => navigate(`/projects/${record.id}`)}
                className="cursor-pointer transition-colors hover:bg-indigo-50/30 max-md:rounded-xl max-md:border max-md:border-indigo-100/70 max-md:bg-white max-md:p-4"
              >
                {/* 桌面端网格行 */}
                <div className="hidden grid-cols-12 items-center gap-3 px-5 py-3 md:grid">
                  <div className="col-span-2 font-mono text-[12px] text-slate-500">
                    {record.code || '-'}
                  </div>
                  <div className="col-span-3 flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-md icon-indigo text-[11px] font-semibold text-indigo-600">
                      {(record.name || 'P').slice(0, 2).toUpperCase()}
                    </span>
                    <span className="text-[13px] font-medium text-slate-900">{record.name}</span>
                  </div>
                  <div className="col-span-2 flex items-center gap-1.5">
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                      style={{ background: getAvatarColor(record.leader_name) }}
                    >
                      {(record.leader_name || 'U').charAt(0)}
                    </span>
                    <span className="text-[12px] text-slate-600">{record.leader_name || '-'}</span>
                  </div>
                  <div className="col-span-1 text-center font-mono text-[13px] text-slate-700">
                    {record.repo_count ?? 0}
                  </div>
                  <div className="col-span-2">
                    <StatusBadge status={record.status} />
                  </div>
                  <div className="col-span-2 flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/projects/${record.id}`);
                      }}
                      className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                    >
                      <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(record);
                      }}
                      className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>

                {/* 移动端卡片（参考 docs/ui/mobile/mobile-release.html） */}
                <div className="md:hidden">
                  <div className="flex items-center justify-between">
                    <StatusBadge status={record.status} />
                    <span className="rounded-md bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-500">
                      {record.code || '-'}
                    </span>
                  </div>
                  <div className="mt-2.5 flex items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg icon-indigo text-[12px] font-semibold text-indigo-600">
                      {(record.name || 'P').slice(0, 2).toUpperCase()}
                    </span>
                    <span className="truncate text-[15px] font-semibold tracking-tight text-slate-900">{record.name}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
                    <GitFork className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                    <span>{record.repo_count ?? 0} 个仓库</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-indigo-50 pt-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-semibold text-white"
                        style={{ background: getAvatarColor(record.leader_name) }}
                      >
                        {(record.leader_name || 'U').charAt(0)}
                      </span>
                      <span className="text-[12px] text-slate-500">负责人 {record.leader_name || '-'}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/projects/${record.id}`);
                        }}
                        className="rounded-md p-3 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                      >
                        <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(record);
                        }}
                        className="rounded-md p-3 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))
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

      <ProjectModal open={modalOpen} project={null} onCancel={() => setModalOpen(false)} onOk={handleAdd} />
    </div>
  );
}
