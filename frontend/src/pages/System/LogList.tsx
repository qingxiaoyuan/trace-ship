import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dropdown } from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import {
  Search,
  Filter,
  Calendar,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ArrowLeft,
  Check,
} from 'lucide-react';
import { systemApi } from '@/api/system';
import type { SystemLog } from '@/api/system';
import { getAvatarColor } from '@/utils/avatar';

const actionTextMap: Record<string, string> = {
  login: '登录',
  logout: '登出',
  create: '新增',
  update: '修改',
  delete: '删除',
  audit: '审批',
  release: '发布',
  trigger: '触发构建',
  push_tag: '推送 Tag',
  sync: '同步',
  review: '审查',
  import: '导入',
  export: '导出',
};

function getActionText(action: string): string {
  return actionTextMap[action] || action;
}

const moduleColorMap: Record<string, string> = {
  auth: 'border-indigo-200 bg-indigo-50 text-indigo-600',
  release: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  workflow: 'border-violet-200 bg-violet-50 text-violet-700',
  jenkins: 'border-amber-200 bg-amber-50 text-amber-700',
  credential: 'border-rose-200 bg-rose-50 text-rose-600',
  project: 'border-indigo-200 bg-indigo-50 text-indigo-600',
  repository: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  system: 'border-slate-200 bg-slate-50 text-slate-600',
  commit: 'border-blue-200 bg-blue-50 text-blue-700',
};

function getModuleBadgeClass(module: string): string {
  return moduleColorMap[module] || 'border-slate-200 bg-slate-50 text-slate-600';
}

function formatDateTime(dateStr?: string): string {
  if (!dateStr) return '-';
  const d = dayjs(dateStr);
  if (!d.isValid()) return dateStr;
  return d.format('YYYY-MM-DD HH:mm');
}

function formatShortDateTime(dateStr?: string): string {
  if (!dateStr) return '-';
  const d = dayjs(dateStr);
  if (!d.isValid()) return dateStr;
  return d.format('MM-DD HH:mm');
}

interface LogFilters {
  keyword: string;
  module: string;
  result: string;
  created_at__gte: Dayjs | null;
  created_at__lte: Dayjs | null;
}

const moduleOptions = [
  { key: '', label: '全部模块' },
  { key: 'auth', label: '认证' },
  { key: 'release', label: '发布' },
  { key: 'workflow', label: '工作流' },
  { key: 'jenkins', label: 'Jenkins' },
  { key: 'credential', label: '凭证' },
  { key: 'project', label: '项目' },
  { key: 'repository', label: '仓库' },
  { key: 'system', label: '系统' },
];

const resultOptions = [
  { key: '', label: '全部结果' },
  { key: 'success', label: '成功' },
  { key: 'failure', label: '失败' },
];

export default function SystemLogList() {
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [selectedLog, setSelectedLog] = useState<SystemLog | null>(null);
  const [filters, setFilters] = useState<LogFilters>({
    keyword: '',
    module: '',
    result: '',
    created_at__gte: null,
    created_at__lte: null,
  });
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const queryParams = useMemo(
    () => ({
      page,
      page_size: pageSize,
      module: filters.module || undefined,
      result: filters.result || undefined,
      keyword: filters.keyword || undefined,
      created_at__gte: filters.created_at__gte?.format('YYYY-MM-DD 00:00:00') || undefined,
      created_at__lte: filters.created_at__lte?.format('YYYY-MM-DD 23:59:59') || undefined,
    }),
    [filters, page]
  );

  const { data, isLoading } = useQuery({
    queryKey: ['system-logs', queryParams],
    queryFn: () => systemApi.getLogs(queryParams),
    enabled: view === 'list',
  });

  const logs = data?.results || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const openDetail = (log: SystemLog) => {
    setSelectedLog(log);
    setView('detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const moduleMenuItems = moduleOptions.map((o) => ({ key: o.key, label: o.label }));
  const resultMenuItems = resultOptions.map((o) => ({ key: o.key, label: o.label }));

  if (view === 'detail' && selectedLog) {
    const log = selectedLog;
    const user = log.user as { id?: string; username?: string; nickname?: string } | null | undefined;
    const userName = user?.nickname || user?.username || '-';
    let detailJson: string;
    try {
      detailJson = JSON.stringify(log.detail ?? {}, null, 2);
    } catch {
      detailJson = '{}';
    }

    return (
      <div className="space-y-5 page-fade-in">
        <div className="flex items-center gap-2 text-[13px]">
          <button
            type="button"
            onClick={() => setView('list')}
            className="inline-flex items-center gap-1 text-slate-400 transition-colors hover:text-indigo-600"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
            操作日志
          </button>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            <div className="tech-card rounded-xl p-5">
              <div className="mb-3 flex items-center gap-2">
                <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${getModuleBadgeClass(log.module)}`}>
                  {log.module}
                </span>
                {log.result === 'success' ? (
                  <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                    <Check className="h-3 w-3" strokeWidth={2} />
                    成功
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-600">
                    失败
                  </span>
                )}
              </div>
              <h2 className="text-[20px] font-semibold tracking-tight text-slate-900">{getActionText(log.action)}</h2>
              <p className="mt-1.5 text-[12px] text-slate-400">
                {formatDateTime(log.created_at)}
                {log.description ? ` · 操作描述：${log.description}` : ''}
              </p>
            </div>

            <div className="tech-card rounded-xl p-5">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">详情（detail JSON）</div>
              <div className="scrollbar-thin overflow-x-auto rounded-lg border border-indigo-100 bg-slate-900 p-4">
                <pre className="font-mono text-[11px] leading-relaxed text-slate-300">{detailJson}</pre>
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <div className="tech-card rounded-xl p-5">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">操作信息</div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-slate-500">操作用户</span>
                  <span className="text-[13px] font-medium text-slate-800">{userName}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-slate-500">用户名</span>
                  <span className="font-mono text-[12px] text-slate-600">{user?.username || '-'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-slate-500">模块</span>
                  <span className="text-[13px] text-slate-700">{log.module}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-slate-500">动作</span>
                  <span className="text-[13px] text-slate-700">{log.action}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-slate-500">资源类型</span>
                  <span className="text-[13px] text-slate-700">{log.resource_type || '-'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-slate-500">资源 ID</span>
                  <span className="font-mono text-[11px] text-slate-600">{log.resource_id || '-'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-slate-500">结果</span>
                  {log.result === 'success' ? (
                    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">成功</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-600">失败</span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-slate-500">IP 地址</span>
                  <span className="font-mono text-[12px] text-slate-600">{log.ip || '-'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-slate-500">操作时间</span>
                  <span className="text-[12px] text-slate-700">{formatShortDateTime(log.created_at)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="space-y-5 page-fade-in">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">操作日志</h1>
        <p className="mt-1 text-[13px] text-slate-500">记录用户关键操作，用于审计排查，仅管理员可查看</p>
      </div>

      <div className="tech-card overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center gap-2 border-b border-indigo-50 px-5 py-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" strokeWidth={1.5} />
            <input
              type="text"
              value={filters.keyword}
              onChange={(e) => { setFilters({ ...filters, keyword: e.target.value }); setPage(1); }}
              placeholder="搜索操作描述"
              className="w-[200px] rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <Dropdown
            menu={{
              items: moduleMenuItems,
              onClick: ({ key }) => { setFilters({ ...filters, module: key }); setPage(1); },
              selectable: true,
              selectedKeys: [filters.module || 'all'],
            }}
            trigger={['click']}
            placement="bottomLeft"
          >
            <button
              type="button"
              className={[
                'inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-[13px] transition-colors',
                filters.module
                  ? 'border-indigo-200 text-indigo-600 bg-indigo-50/40'
                  : 'border-indigo-100 text-slate-600 hover:bg-indigo-50 hover:text-indigo-600',
              ].join(' ')}
            >
              <Filter className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>{filters.module ? moduleOptions.find((o) => o.key === filters.module)?.label : '全部模块'}</span>
              <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
            </button>
          </Dropdown>

          <Dropdown
            menu={{
              items: resultMenuItems,
              onClick: ({ key }) => { setFilters({ ...filters, result: key }); setPage(1); },
              selectable: true,
              selectedKeys: [filters.result || 'all'],
            }}
            trigger={['click']}
            placement="bottomLeft"
          >
            <button
              type="button"
              className={[
                'inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-[13px] transition-colors',
                filters.result
                  ? 'border-indigo-200 text-indigo-600 bg-indigo-50/40'
                  : 'border-indigo-100 text-slate-600 hover:bg-indigo-50 hover:text-indigo-600',
              ].join(' ')}
            >
              <Filter className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>{filters.result ? resultOptions.find((o) => o.key === filters.result)?.label : '全部结果'}</span>
              <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
            </button>
          </Dropdown>

          <div className="relative">
            <Calendar className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" strokeWidth={1.5} />
            <input
              type="date"
              value={filters.created_at__gte?.format('YYYY-MM-DD') || ''}
              onChange={(e) => {
                const v = e.target.value ? dayjs(e.target.value) : null;
                setFilters({ ...filters, created_at__gte: v });
                setPage(1);
              }}
              className="rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-2 text-[13px] text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <span className="text-[12px] text-slate-400">至</span>
          <div className="relative">
            <Calendar className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" strokeWidth={1.5} />
            <input
              type="date"
              value={filters.created_at__lte?.format('YYYY-MM-DD') || ''}
              onChange={(e) => {
                const v = e.target.value ? dayjs(e.target.value) : null;
                setFilters({ ...filters, created_at__lte: v });
                setPage(1);
              }}
              className="rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-2 text-[13px] text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <div className="ml-auto text-[12px] text-slate-400">共 {total} 条</div>
        </div>

        <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
          <div className="col-span-2">时间</div>
          <div className="col-span-1">用户</div>
          <div className="col-span-1">模块</div>
          <div className="col-span-2">动作</div>
          <div className="col-span-2">资源</div>
          <div className="col-span-1">结果</div>
          <div className="col-span-2">IP</div>
          <div className="col-span-1 text-right">操作</div>
        </div>

        <div className="divide-y divide-indigo-50/50 max-h-[calc(100vh-340px)] overflow-y-auto">
          {isLoading ? (
            <div className="px-5 py-12 text-center text-[13px] text-slate-400">加载中…</div>
          ) : logs.length === 0 ? (
            <div className="px-5 py-12 text-center text-[13px] text-slate-400">暂无日志数据</div>
          ) : (
            logs.map((log) => {
              const user = log.user as { nickname?: string; username?: string } | null | undefined;
              const userName = user?.nickname || user?.username || '-';
              const userInitial = (userName).charAt(0);
              const resource = [log.resource_type, log.resource_id].filter(Boolean).join(' / ');
              return (
                <div
                  key={log.id}
                  onClick={() => openDetail(log)}
                  className="grid grid-cols-12 cursor-pointer items-center gap-3 px-5 py-3 transition-colors hover:bg-indigo-50/20"
                >
                  <div className="col-span-6 font-mono text-[12px] text-slate-600 md:col-span-2">{formatShortDateTime(log.created_at)}</div>
                  <div className="col-span-6 flex items-center gap-1.5 md:col-span-1">
                    <div
                      className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white"
                      style={{ background: getAvatarColor(userName) }}
                    >
                      {userInitial}
                    </div>
                    <span className="truncate text-[12px] text-slate-700">{userName}</span>
                  </div>
                  <div className="col-span-6 md:col-span-1">
                    <span className={`inline-flex items-center rounded-md border px-1 py-0.5 text-[10px] font-medium ${getModuleBadgeClass(log.module)}`}>
                      {log.module}
                    </span>
                  </div>
                  <div className="col-span-12 text-[12px] text-slate-700 md:col-span-2">{getActionText(log.action)}</div>
                  <div className="col-span-6 truncate font-mono text-[11px] text-slate-500 md:col-span-2">{resource || '-'}</div>
                  <div className="col-span-6 md:col-span-1">
                    {log.result === 'success' ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1 py-0.5 text-[10px] font-medium text-emerald-700">成功</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-1 py-0.5 text-[10px] font-medium text-rose-600">失败</span>
                    )}
                  </div>
                  <div className="col-span-6 truncate font-mono text-[11px] text-slate-500 md:col-span-2">{log.ip || '-'}</div>
                  <div className="col-span-6 flex items-center justify-end md:col-span-1">
                    <ChevronRight className="h-4 w-4 text-slate-300" strokeWidth={1.5} />
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-indigo-50 px-5 py-3">
          <div className="text-[12px] text-slate-400">
            {total === 0 ? '暂无数据' : `第 ${start}-${end} 条 / 共 ${total} 条`}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-indigo-100 text-slate-400 transition-colors hover:bg-indigo-50 disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
            {Array.from({ length: totalPages }).slice(0, 7).map((_, idx) => {
              const p = idx + 1;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPage(p)}
                  className={[
                    'flex h-7 w-7 items-center justify-center rounded-md text-[12px] font-medium transition-colors',
                    p === page
                      ? 'bg-indigo-500 text-white'
                      : 'border border-indigo-100 text-slate-600 hover:bg-indigo-50',
                  ].join(' ')}
                >
                  {p}
                </button>
              );
            })}
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-indigo-100 text-slate-400 transition-colors hover:bg-indigo-50 disabled:opacity-40"
            >
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
