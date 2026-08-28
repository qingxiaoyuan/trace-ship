import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Grid } from 'antd';
import dayjs from 'dayjs';
import {
  ArrowRight,
  Download,
  GitPullRequestArrow,
  Hammer,
  LoaderCircle,
  PackageX,
  Rocket,
  TriangleAlert,
} from 'lucide-react';
import { Chart, registerables } from 'chart.js';
import { dashboardApi } from '@/api/dashboard';
import { releaseApi } from '@/api/release';
import { packageApi } from '@/api/package';
import { workflowApi } from '@/api/workflow';
import { useAuthStore } from '@/stores/authStore';
import { useAppMessage } from '@/hooks/useAppMessage';
import type { KpiCard, PipelineColumn, PipelineRange, TodoFilter, TodoItem } from './types';
import { releaseStatusText, releaseTypeText } from './constants';
import {
  formatDurationSeconds,
  formatRelative,
  getGreeting,
  getRunningElapsedSeconds,
  isBuildRunning,
  mapReleaseTrend,
  normalizeStatus,
} from './utils';
import { KpiCardView } from './components/KpiCardView';
import { BuildSuccessChart } from './components/BuildSuccessChart';
import { BuildTrendChart } from './components/BuildTrendChart';
import { PipelinePanel } from './components/PipelinePanel';
import { RecentReleasesPanel } from './components/RecentReleasesPanel';
import { TodoPanel } from './components/TodoPanel';

Chart.register(...registerables);

/** 待办审批徽标样式（按发布类型区分） */
const auditBadgeClass: Record<string, string> = {
  formal: 'border-amber-200 bg-amber-50 text-amber-600',
  rc: 'border-cyan-200 bg-cyan-50 text-cyan-600',
  beta: 'border-violet-200 bg-violet-50 text-violet-600',
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { message } = useAppMessage();
  const user = useAuthStore((state) => state.user);
  const [pipelineRange, setPipelineRange] = useState<PipelineRange>('week');
  const [todoFilter, setTodoFilter] = useState<TodoFilter>('all');
  // 移动端（<lg）使用贴合设计稿的精简布局
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.lg;

  const { data: overview } = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: () => dashboardApi.getOverview(),
    staleTime: 30_000,
    gcTime: 300_000,
  });

  const { data: releaseData } = useQuery({
    queryKey: ['dashboard-releases'],
    queryFn: () => releaseApi.getReleases({ page_size: 50 }),
    staleTime: 30_000,
    gcTime: 300_000,
  });

  const { data: recentReleaseData } = useQuery({
    queryKey: ['dashboard-recent-releases', 'released'],
    queryFn: () => releaseApi.getReleases({ status: 'released', page_size: 10 }),
    staleTime: 30_000,
    gcTime: 300_000,
  });

  // 工作台的打包数据只看「我发起的」任务（失败/打包中/成功率均为此口径）
  const { data: packageTaskData } = useQuery({
    queryKey: ['dashboard-package-tasks', user?.id],
    queryFn: () => packageApi.getTasks({ page_size: 20, triggered_by: user!.id }),
    enabled: !!user,
    staleTime: 30_000,
    gcTime: 300_000,
  });

  // 真实待办：待我审批的工作流任务（queryKey 与审批中心一致，操作后自动联动刷新）
  const { data: todoTaskData } = useQuery({
    queryKey: ['workflow-todo'],
    queryFn: () => workflowApi.getTodoTasks({ page_size: 10 }),
    staleTime: 30_000,
    gcTime: 300_000,
  });

  // 后端按天聚合的发布趋势（最近 7 天）
  const { data: trendData } = useQuery({
    queryKey: ['dashboard-trend', 7],
    queryFn: () => dashboardApi.getTrend(7),
    staleTime: 30_000,
    gcTime: 300_000,
  });

  const releases = useMemo(() => releaseData?.results || [], [releaseData?.results]);
  const recentReleaseRows = useMemo(() => recentReleaseData?.results || [], [recentReleaseData?.results]);
  // 发布流水线按时间范围过滤后的发布记录
  const rangeReleases = useMemo(() => {
    if (pipelineRange === 'all') return releases;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const start = pipelineRange === 'today' ? startOfToday : startOfToday - 6 * 86400000;
    return releases.filter((r) => {
      const t = r.created_at ? new Date(r.created_at).getTime() : 0;
      return t >= start;
    });
  }, [releases, pipelineRange]);
  const packageTasks = useMemo(() => packageTaskData?.results || [], [packageTaskData?.results]);
  const recentReleases = recentReleaseRows.filter((r) => r.status === 'released').slice(0, 10);
  const runningBuilds = packageTasks.filter(isBuildRunning);
  const failedBuilds = packageTasks.filter((task) => task.status === 'failure');
  const pendingReleases = releases.filter((r) => normalizeStatus(r) === 'pending');
  const releaseTrend = useMemo(() => mapReleaseTrend(trendData || []), [trendData]);
  const trendSuccessTotal = releaseTrend.reduce((sum, item) => sum + item.success, 0);
  const trendFailedTotal = releaseTrend.reduce((sum, item) => sum + item.failed, 0);

  const totalReleases = overview?.total_releases || 0;
  // 「待我审批」以当前用户的真实待办任务数为准，接口不可用时回退到全站待审批数
  const myTodoCount = todoTaskData?.total ?? overview?.pending_audit_count ?? pendingReleases.length;
  const successRate = Math.round((overview?.success_rate || 0) * 1000) / 10;
  const buildSuccess = packageTasks.filter((task) => task.status === 'success').length;
  const buildFailed = packageTasks.filter((task) => task.status === 'failure' || task.status === 'canceled').length;
  const buildTotal = buildSuccess + buildFailed;
  const buildSuccessRate = buildTotal ? Math.round((buildSuccess / buildTotal) * 1000) / 10 : 0;
  const displayName = user?.nickname || user?.username || '用户';
  const latestPendingRelease = pendingReleases[0];
  const latestFailedBuild = failedBuilds[0];

  const pipelineColumns: PipelineColumn[] = [
    {
      key: 'draft',
      label: '草稿',
      count: rangeReleases.filter((r) => normalizeStatus(r) === 'draft').length,
      tone: 'border-slate-200/70 bg-slate-50/50 text-slate-500',
      dot: 'bg-slate-400',
      cardBorder: 'border-slate-200 hover:border-slate-400',
      to: '/releases',
      releases: rangeReleases.filter((r) => normalizeStatus(r) === 'draft').slice(0, 2),
    },
    {
      key: 'building',
      label: '打包中',
      count: runningBuilds.length,
      tone: 'border-cyan-200/70 bg-cyan-50/40 text-cyan-700',
      dot: 'bg-cyan-500 pulse-dot',
      cardBorder: 'border-cyan-200 hover:border-cyan-400',
      to: '/packages',
      releases: [],
      builds: runningBuilds.slice(0, 2),
    },
    {
      key: 'pending',
      label: '待审批',
      count: rangeReleases.filter((r) => normalizeStatus(r) === 'pending').length,
      tone: 'border-amber-200/70 bg-amber-50/40 text-amber-700',
      dot: 'bg-amber-500 pulse-dot',
      cardBorder: 'border-amber-200 hover:border-amber-400',
      to: '/releases',
      releases: rangeReleases.filter((r) => normalizeStatus(r) === 'pending').slice(0, 2),
    },
    {
      key: 'released',
      label: '已发布',
      count: rangeReleases.filter((r) => normalizeStatus(r) === 'released').length,
      tone: 'border-emerald-200/70 bg-emerald-50/40 text-emerald-700',
      dot: 'bg-emerald-500',
      cardBorder: 'border-emerald-200 hover:border-emerald-400',
      to: '/releases',
      releases: rangeReleases.filter((r) => normalizeStatus(r) === 'released').slice(0, 2),
    },
    {
      key: 'rejected',
      label: '已驳回',
      count: rangeReleases.filter((r) => normalizeStatus(r) === 'rejected').length,
      tone: 'border-rose-200/70 bg-rose-50/40 text-rose-700',
      dot: 'bg-rose-500',
      cardBorder: 'border-rose-200 hover:border-rose-400',
      to: '/releases',
      releases: rangeReleases.filter((r) => normalizeStatus(r) === 'rejected').slice(0, 2),
    },
  ];

  // 我的待办：真实审批任务 + 失败/运行中的打包任务
  const allTodoItems: TodoItem[] = [
    ...(todoTaskData?.results || []).map((task) => ({
      key: `audit-${task.id}`,
      type: 'audit' as const,
      kind: 'audit' as const,
      title: `${task.project_name || '-'} 发布审批 · ${task.version || '-'}`,
      badge: task.release_type ? `${releaseTypeText[task.release_type]}发布` : '发布审批',
      badgeClass: auditBadgeClass[task.release_type || ''] || 'border-slate-200 bg-slate-50 text-slate-500',
      meta: `${task.applicant || '-'} 提交于 ${formatRelative(task.submit_time)} · 当前节点：${task.current_node || '-'}`,
      icon: GitPullRequestArrow,
      iconClass: 'icon-amber',
      to: '/workflows',
      taskId: task.id,
    })),
    ...failedBuilds.slice(0, 3).map((task) => ({
      key: `build-failure-${task.id}`,
      type: 'build' as const,
      kind: 'build-failure' as const,
      title: `${task.name} 打包失败`,
      badge: '失败',
      badgeClass: 'border-rose-200 bg-rose-50 text-rose-500',
      meta: `${task.error_message || task.status_display || '打包失败'} · ${formatRelative(task.finished_at || task.created_at)}${task.release_version ? ` · 关联发布 ${task.release_version}` : ''}`,
      icon: PackageX,
      iconClass: 'icon-rose',
      to: `/packages/${task.id}`,
    })),
    ...runningBuilds.slice(0, 3).map((task) => ({
      key: `build-running-${task.id}`,
      type: 'build' as const,
      kind: 'build-running' as const,
      title: `${task.name} 打包中`,
      badge: '运行中',
      badgeClass: 'border-cyan-200 bg-cyan-50 text-cyan-600',
      meta: `${task.status === 'queued' ? '排队中' : `已运行 ${formatDurationSeconds(getRunningElapsedSeconds(task))}`}${task.release_version ? ` · 关联发布 ${task.release_version}` : ''}`,
      icon: LoaderCircle,
      iconClass: 'icon-cyan',
      to: `/packages/${task.id}`,
    })),
  ];
  const todoItems = allTodoItems
    .filter((item) => (todoFilter === 'all' ? true : item.type === todoFilter))
    .slice(0, 6);

  const kpiCards: KpiCard[] = [
    {
      title: '近 7 天发布数',
      value: <span className="text-[24px] lg:text-[28px] font-semibold tracking-tight text-slate-900">{totalReleases}</span>,
      unit: '次发布 · 近 7 天',
      description: (
        <>
          <span>
            成功率 <span className="font-medium text-emerald-600">{successRate}%</span>
          </span>
          <span className="h-1 w-1 rounded-full bg-slate-300" />
          <span>已发布 {overview?.released_count || 0} 条</span>
        </>
      ),
      icon: Rocket,
      iconClass: 'icon-indigo',
      onClick: () => navigate('/releases'),
      footer: (
        <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400"
            style={{ width: `${Math.min(100, successRate)}%` }}
          />
        </div>
      ),
    },
    {
      title: '待我审批',
      value: <span className="text-[24px] lg:text-[28px] font-semibold tracking-tight text-slate-900">{myTodoCount}</span>,
      unit: '个审批等待处理',
      description: latestPendingRelease
        ? `最早：${latestPendingRelease.project_name || '-'} ${latestPendingRelease.version} · ${formatRelative(latestPendingRelease.created_at)}提交`
        : '暂无待审批发布',
      icon: GitPullRequestArrow,
      iconClass: 'icon-amber',
      onClick: () => navigate('/workflows'),
      action: (
        <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
          <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-amber-500" />
          待处理
        </span>
      ),
      footer: (
        <span className="inline-flex items-center gap-1 text-[12px] font-medium text-indigo-600 transition-colors group-hover:text-indigo-500">
          前往审批中心
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={1.5} />
        </span>
      ),
    },
    {
      title: '异常打包',
      value: <span className="text-[24px] lg:text-[28px] font-semibold tracking-tight text-slate-900">{failedBuilds.length}</span>,
      unit: '个打包任务失败',
      description: latestFailedBuild
        ? `${latestFailedBuild.name} · ${formatRelative(latestFailedBuild.finished_at || latestFailedBuild.created_at)}`
        : '暂无失败的打包任务',
      icon: TriangleAlert,
      iconClass: 'icon-rose',
      onClick: () => navigate('/packages'),
      footer: (
        <span className="inline-flex items-center gap-1 text-[12px] font-medium text-indigo-600 transition-colors group-hover:text-indigo-500">
          查看打包看板
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={1.5} />
        </span>
      ),
    },
    {
      title: '打包成功率',
      value: (
        <span className="text-gradient text-[24px] lg:text-[28px] font-semibold tracking-tight">
          {buildSuccessRate}
          <span className="text-[18px] text-slate-400">%</span>
        </span>
      ),
      unit: '打包成功率',
      description: `本批 ${buildTotal} 个打包任务，${buildFailed} 个失败`,
      icon: Hammer,
      iconClass: 'icon-cyan',
      onClick: () => navigate('/packages'),
      action: (
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">
          {buildSuccess} 成功
        </span>
      ),
      footer: (
        <div className="flex h-1 overflow-hidden rounded-full bg-slate-100">
          {buildSuccess > 0 ? <div className="h-full bg-emerald-500" style={{ width: `${buildTotal ? (buildSuccess / buildTotal) * 100 : 0}%` }} /> : null}
          {buildFailed > 0 ? <div className="h-full bg-rose-400" style={{ width: `${buildTotal ? (buildFailed / buildTotal) * 100 : 0}%` }} /> : null}
        </div>
      ),
    },
  ];

  const successChartCard = (
    <div className="tech-card rounded-xl p-5">
      <div className="mb-2 flex items-start justify-between">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">打包成功率</h2>
          <p className="mt-0.5 text-[12px] text-slate-500">最近打包任务统计</p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/packages')}
          className="inline-flex items-center gap-1 text-[12px] font-medium text-indigo-600 transition-colors hover:text-indigo-500"
        >
          打包看板
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </div>
      <BuildSuccessChart
        rate={buildSuccessRate}
        successCount={buildSuccess}
        failureCount={buildFailed}
      />
      <div className="mt-4 space-y-1 border-t border-indigo-50 pt-3">
        {[
          { label: '成功', value: buildSuccess, color: 'bg-emerald-400', hover: 'hover:bg-emerald-50/60' },
          { label: '失败', value: buildFailed, color: 'bg-rose-400', hover: 'hover:bg-rose-50/60' },
        ].map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => navigate('/packages')}
            className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors ${item.hover}`}
          >
            <span className="flex items-center gap-2 text-[12px] text-slate-600">
              <span className={`h-2 w-2 rounded-full ${item.color}`} />
              {item.label}
            </span>
            <span className="font-mono text-[12px] font-semibold text-slate-800">{item.value}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const trendChartCard = (
    <div className="tech-card rounded-xl p-5">
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">发布趋势</h2>
        <p className="mt-0.5 text-[12px] text-slate-500">最近 7 天 · 成功 / 失败</p>
      </div>
      <BuildTrendChart data={releaseTrend} />
      <div className="mt-4 flex items-center justify-center gap-5 border-t border-indigo-50 pt-3 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-indigo-500" />
          发布成功 <span className="font-mono font-semibold text-slate-700">{trendSuccessTotal}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-rose-400" />
          发布失败 <span className="font-mono font-semibold text-slate-700">{trendFailedTotal}</span>
        </span>
      </div>
    </div>
  );

  /** 导出周报：独立拉取近 7 天发布记录生成 CSV 下载（分页上限 100 条） */
  const handleExportWeekly = async () => {
    const since = Date.now() - 7 * 86400000;
    const data = await releaseApi.getReleases({ page_size: 100 });
    const rows = (data?.results || []).filter(
      (r) => r.created_at && new Date(r.created_at).getTime() >= since,
    );
    if (!rows.length) {
      message.warning('近 7 天暂无发布记录');
      return;
    }
    // 防 CSV 公式注入：以 = + - @ 开头的单元格前缀单引号
    const safeCell = (value: unknown) => {
      const text = String(value ?? '');
      const prefixed = /^[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${prefixed.replace(/"/g, '""')}"`;
    };
    const header = ['版本', '项目', '仓库', '类型', '状态', '发布人', '创建时间'];
    const csv = [
      header,
      ...rows.map((r) => [
        r.version,
        r.project_name || '',
        r.repository_name || '',
        releaseTypeText[r.release_type] || r.release_type,
        releaseStatusText[r.status as string] || r.status,
        r.publisher || '',
        dayjs(r.created_at).format('YYYY-MM-DD HH:mm'),
      ]),
    ]
      .map((cols) => cols.map(safeCell).join(','))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `trace-ship-weekly-${dayjs().format('YYYYMMDD')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    message.success(`已导出近 7 天 ${rows.length} 条发布记录`);
  };

  const pageHeader = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        {isMobile ? (
          <>
            <h1 className="text-[20px] font-semibold tracking-tight text-slate-900">
              {getGreeting()}，{displayName}
            </h1>
            <p className="mt-1 text-[12px] text-slate-500">
              今天有 {myTodoCount} 个发布待审批 · {failedBuilds.length} 个打包任务失败
            </p>
          </>
        ) : (
          <>
            <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">工作台</h1>
            <p className="mt-1.5 text-[13px] text-slate-500">
              {getGreeting()}，{displayName}。今天有{' '}
              <button
                type="button"
                onClick={() => navigate('/workflows')}
                className="font-semibold text-amber-600 underline decoration-amber-300 decoration-2 underline-offset-2 transition-colors hover:text-amber-700"
              >
                {myTodoCount} 个发布待审批
              </button>
              ，
              <button
                type="button"
                onClick={() => navigate('/packages')}
                className="font-semibold text-rose-500 underline decoration-rose-300 decoration-2 underline-offset-2 transition-colors hover:text-rose-600"
              >
                {failedBuilds.length} 个打包任务失败
              </button>
              。
            </p>
          </>
        )}
      </div>
      {!isMobile ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportWeekly}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[13px] font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span>导出周报</span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/releases/create')}
            className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white"
          >
            <Rocket className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span>新建发布</span>
          </button>
        </div>
      ) : null}
    </div>
  );

  // 移动端布局（对齐 docs/ui/mobile/mobile-dashboard.html）：问候 → KPI 双列 → 待办 → 最近发布 → 图表
  if (isMobile) {
    return (
      <div className="space-y-4">
        {pageHeader}
        <div className="grid grid-cols-2 gap-3">
          {kpiCards.map((card) => (
            <KpiCardView key={card.title} card={card} compact />
          ))}
        </div>
        <TodoPanel items={todoItems} total={allTodoItems.length} filter={todoFilter} onFilterChange={setTodoFilter} />
        <RecentReleasesPanel
          releases={recentReleases}
          onViewAll={() => navigate('/releases')}
          onRowClick={(release) => navigate(`/releases/${release.id}`)}
        />
        {trendChartCard}
        {successChartCard}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {pageHeader}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((card) => (
          <KpiCardView key={card.title} card={card} />
        ))}
      </div>

      <PipelinePanel columns={pipelineColumns} range={pipelineRange} onRangeChange={setPipelineRange} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* 左列：待办 + 最近发布 */}
        <div className="space-y-5 lg:col-span-2">
          <TodoPanel items={todoItems} total={allTodoItems.length} filter={todoFilter} onFilterChange={setTodoFilter} />
          <RecentReleasesPanel
            releases={recentReleases}
            onViewAll={() => navigate('/releases')}
            onRowClick={(release) => navigate(`/releases/${release.id}`)}
          />
        </div>
        {/* 右列：图表 */}
        <div className="space-y-5">
          {successChartCard}
          {trendChartCard}
        </div>
      </div>
    </div>
  );
}
