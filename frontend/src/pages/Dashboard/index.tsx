import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Grid } from 'antd';
import {
  ArrowDownRight,
  ArrowRight,
  Download,
  GitPullRequestArrow,
  Hammer,
  Rocket,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react';
import { Chart, registerables } from 'chart.js';
import { dashboardApi } from '@/api/dashboard';
import { releaseApi } from '@/api/release';
import { packageApi } from '@/api/package';
import { useAuthStore } from '@/stores/authStore';
import type { KpiCard, PipelineColumn, PipelineRange, TodoFilter, TodoItem } from './types';
import {
  buildSevenDayTrend,
  formatDurationSeconds,
  formatRelative,
  getBuildDurationSeconds,
  getGreeting,
  isBuildRunning,
  normalizeStatus,
} from './utils';
import { InitialAvatar } from './components/SmallTag';
import { KpiCardView } from './components/KpiCardView';
import { BuildSuccessChart } from './components/BuildSuccessChart';
import { BuildTrendChart } from './components/BuildTrendChart';
import { PipelinePanel } from './components/PipelinePanel';
import { RecentReleasesPanel } from './components/RecentReleasesPanel';
import { TodoPanel } from './components/TodoPanel';

Chart.register(...registerables);

export default function Dashboard() {
  const navigate = useNavigate();
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

  const { data: packageTaskData } = useQuery({
    queryKey: ['dashboard-package-tasks'],
    queryFn: () => packageApi.getTasks({ page_size: 20 }),
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
  const pendingReleases = releases.filter((r) => normalizeStatus(r) === 'pending');
  const buildTrendData = useMemo(() => buildSevenDayTrend(packageTasks), [packageTasks]);

  const totalReleases = overview?.total_releases || 0;
  const pendingAuditCount = overview?.pending_audit_count || pendingReleases.length;
  const rejectedCount = overview?.rejected_count || releases.filter((r) => normalizeStatus(r) === 'rejected').length;
  const successRate = Math.round((overview?.success_rate || 0) * 1000) / 10;
  const buildSuccess = packageTasks.filter((task) => task.status === 'success').length;
  const buildFailed = packageTasks.filter((task) => task.status === 'failure' || task.status === 'canceled').length;
  const buildTotal = buildSuccess + buildFailed;
  const buildSuccessRate = buildTotal ? Math.round((buildSuccess / buildTotal) * 1000) / 10 : 0;
  const displayName = user?.nickname || user?.username || '用户';
  const pendingPublishers = pendingReleases
    .map((release) => release.publisher)
    .filter((publisher): publisher is string => Boolean(publisher));
  const visiblePendingPublishers = pendingPublishers.slice(0, 3);
  const hiddenPendingPublisherCount = Math.max(0, pendingPublishers.length - visiblePendingPublishers.length);
  const latestPendingRelease = pendingReleases[0];
  const pendingDescription = latestPendingRelease
    ? `最近提交于 ${formatRelative(latestPendingRelease.created_at)}`
    : '暂无待审批发布';
  const completedBuildDurations = packageTasks
    .filter((task) => task.status === 'success' || task.status === 'failure' || task.status === 'canceled')
    .map(getBuildDurationSeconds)
    .filter((duration): duration is number => duration !== null);
  const averageBuildDuration = completedBuildDurations.length
    ? Math.round(completedBuildDurations.reduce((sum, duration) => sum + duration, 0) / completedBuildDurations.length)
    : null;

  const pipelineColumns: PipelineColumn[] = [
    {
      key: 'draft',
      label: '草稿',
      count: rangeReleases.filter((r) => normalizeStatus(r) === 'draft').length,
      tone: 'border-slate-200/70 bg-slate-50/50 text-slate-500',
      dot: 'bg-slate-400',
      cardBorder: 'border-slate-200 hover:border-slate-400',
      releases: rangeReleases.filter((r) => normalizeStatus(r) === 'draft').slice(0, 2),
    },
    {
      key: 'building',
      label: '打包中',
      count: runningBuilds.length + rangeReleases.filter((r) => normalizeStatus(r) === 'building').length,
      tone: 'border-cyan-200/70 bg-cyan-50/40 text-cyan-700',
      dot: 'bg-cyan-500 pulse-dot',
      cardBorder: 'border-cyan-200 hover:border-cyan-400',
      releases: rangeReleases.filter((r) => normalizeStatus(r) === 'building').slice(0, 2),
    },
    {
      key: 'pending',
      label: '待审批',
      count: rangeReleases.filter((r) => normalizeStatus(r) === 'pending').length,
      tone: 'border-amber-200/70 bg-amber-50/40 text-amber-700',
      dot: 'bg-amber-500 pulse-dot',
      cardBorder: 'border-amber-200 hover:border-amber-400',
      releases: rangeReleases.filter((r) => normalizeStatus(r) === 'pending').slice(0, 2),
    },
    {
      key: 'released',
      label: '已发布',
      count: rangeReleases.filter((r) => normalizeStatus(r) === 'released').length,
      tone: 'border-emerald-200/70 bg-emerald-50/40 text-emerald-700',
      dot: 'bg-emerald-500',
      cardBorder: 'border-emerald-200 hover:border-emerald-400',
      releases: rangeReleases.filter((r) => normalizeStatus(r) === 'released').slice(0, 2),
    },
    {
      key: 'rejected',
      label: '已驳回',
      count: rangeReleases.filter((r) => normalizeStatus(r) === 'rejected').length,
      tone: 'border-rose-200/70 bg-rose-50/40 text-rose-700',
      dot: 'bg-rose-500',
      cardBorder: 'border-rose-200 hover:border-rose-400',
      releases: rangeReleases.filter((r) => normalizeStatus(r) === 'rejected').slice(0, 2),
    },
  ];

  const todoItems: TodoItem[] = [
    ...releases
      .filter((r) => normalizeStatus(r) === 'pending')
      .slice(0, 2)
      .map((release) => ({
        key: `audit-${release.id}`,
        title: `审批发布 ${release.version}`,
        project: release.project_name || '-',
        meta: `${release.publisher || '系统'} 提交 · ${formatRelative(release.created_at)} · 需审批`,
        icon: GitPullRequestArrow,
        iconClass: 'icon-amber',
        type: 'audit' as const,
        actions: (
          <div className="flex items-center gap-1.5">
            <button className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600">
              驳回
            </button>
            <button className="btn-glow rounded-lg px-3 py-1.5 text-[12px] font-medium text-white">通过</button>
          </div>
        ),
      })),
    ...runningBuilds.slice(0, 1).map((build) => ({
      key: `build-${build.id}`,
      title: `打包任务 ${build.name} 进行中`,
      project: build.project_name || build.repository_name || '-',
      meta: `${build.version || '当前版本'} · ${build.status_display || '运行中'}`,
      icon: Hammer,
      iconClass: 'icon-cyan',
      type: 'build' as const,
      actions: (
        <button
          onClick={() => navigate('/packages')}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600"
        >
          查看任务
        </button>
      ),
    })),
  ]
    .filter((item) => (todoFilter === 'all' ? true : item.type === todoFilter))
    .slice(0, 5);

  const kpiCards: KpiCard[] = [
    {
      title: '近 7 天发布数',
      value: <span className="text-[24px] lg:text-[28px] font-semibold tracking-tight text-slate-900">{totalReleases}</span>,
      unit: '次发布',
      description: (
        <>
          <span>成功率 {successRate}%</span>
          <span className="h-1 w-1 rounded-full bg-slate-300" />
          <span>已发布 {overview?.released_count || 0} 条</span>
        </>
      ),
      icon: Rocket,
      iconClass: 'icon-indigo',
      action: (
        <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-600">
          <TrendingUp className="h-3 w-3" strokeWidth={1.5} />
          <span>{successRate}%</span>
        </div>
      ),
      footer: (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400"
            style={{ width: `${Math.min(100, successRate)}%` }}
          />
        </div>
      ),
    },
    {
      title: '待审批数',
      value: <span className="text-[24px] lg:text-[28px] font-semibold tracking-tight text-slate-900">{pendingAuditCount}</span>,
      unit: '个审批',
      description: pendingDescription,
      icon: GitPullRequestArrow,
      iconClass: 'icon-amber',
      action: <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-600">待处理</span>,
      footer: (
        <div className="flex -space-x-1.5">
          {visiblePendingPublishers.map((publisher, index) => (
            <InitialAvatar key={`${publisher}-${index}`} name={publisher} size={20} />
          ))}
          {hiddenPendingPublisherCount > 0 ? (
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-50 ring-2 ring-white text-[9px] font-semibold text-indigo-600">
              +{hiddenPendingPublisherCount}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: '已驳回',
      value: <span className="text-[24px] lg:text-[28px] font-semibold tracking-tight text-slate-900">{rejectedCount}</span>,
      unit: '个驳回',
      description: '需关注异常打包',
      icon: TriangleAlert,
      iconClass: 'icon-rose',
      action: (
        <div className="flex items-center gap-1 text-[11px] font-medium text-rose-500">
          <ArrowDownRight className="h-3 w-3" strokeWidth={1.5} />
          <span>{rejectedCount}</span>
        </div>
      ),
      footer: (
        <button
          onClick={() => navigate('/packages')}
          className="inline-flex items-center gap-1 text-[12px] font-medium text-indigo-600 transition-colors hover:text-indigo-500"
        >
          <span>查看详情</span>
          <ArrowRight className="h-3 w-3" strokeWidth={1.5} />
        </button>
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
      description: `本批 ${buildTotal} 个打包任务，${buildFailed} 个失败`,
      icon: Hammer,
      iconClass: 'icon-cyan',
      action: <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">{buildSuccess} 成功</span>,
      footer: (
        <div className="flex items-center gap-1">
          <div
            className="h-1.5 rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400"
            style={{ flex: Math.max(buildSuccess, buildTotal ? 1 : 0) }}
          />
          {buildFailed > 0 ? (
            <div
              className="h-1.5 rounded-full bg-rose-400"
              style={{ flex: Math.max(buildFailed, 1) }}
            />
          ) : null}
        </div>
      ),
    },
  ];

  const successChartCard = (
    <div className="tech-card rounded-xl p-5">
      <div className="mb-2">
        <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">打包成功率</h2>
        <p className="mt-0.5 text-[12px] text-slate-500">最近打包任务统计</p>
      </div>
      <BuildSuccessChart
        rate={buildSuccessRate}
        successCount={buildSuccess}
        failureCount={buildFailed}
      />
      <div className="mt-4 space-y-2.5 border-t border-indigo-50 pt-4">
        {[
          ['成功', buildSuccess, 'bg-emerald-400'],
          ['失败', buildFailed, 'bg-rose-400'],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-sm ${color}`} />
              <span className="text-[12px] text-slate-600">{label}</span>
            </div>
            <span className="font-mono text-[12px] font-medium text-slate-800">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const trendChartCard = (
    <div className="tech-card rounded-xl p-5">
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">打包趋势</h2>
        <p className="mt-0.5 text-[12px] text-slate-500">最近 7 天</p>
      </div>
      <BuildTrendChart data={buildTrendData} />
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-indigo-50 pt-4">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="h-2 w-2 rounded-sm bg-emerald-400" />
            <span>成功</span>
          </div>
          <div className="mt-1 font-mono text-[18px] font-semibold tracking-tight text-slate-900">{buildSuccess}</div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="h-2 w-2 rounded-sm bg-rose-400" />
            <span>失败</span>
          </div>
          <div className="mt-1 font-mono text-[18px] font-semibold tracking-tight text-slate-900">{buildFailed}</div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-indigo-50 pt-3">
        <span className="text-[11px] text-slate-400">平均打包时长</span>
        <span className="font-mono text-[13px] font-medium text-cyan-600">
          {formatDurationSeconds(averageBuildDuration)}
        </span>
      </div>
    </div>
  );

  const pageHeader = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        {isMobile ? (
          <>
            <h1 className="text-[20px] font-semibold tracking-tight text-slate-900">
              {getGreeting()}，{displayName}
            </h1>
            <p className="mt-1 text-[12px] text-slate-500">
              今天有 {pendingAuditCount} 个发布待审批 · {runningBuilds.length} 个打包任务进行中
            </p>
          </>
        ) : (
          <>
            <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">工作台</h1>
            <p className="mt-1 text-[13px] text-slate-500">
              {getGreeting()}，{displayName}。今天有{' '}
              <span className="font-medium text-indigo-600">{pendingAuditCount}</span> 个发布待审批，
              <span className="font-medium text-cyan-600">{runningBuilds.length}</span> 个打包任务进行中。
            </p>
          </>
        )}
      </div>
      {!isMobile ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
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

  // 移动端布局（对齐 ui-design/mobile-dashboard.html）：问候 → KPI 双列 → 趋势 → 待办 → 最近发布
  if (isMobile) {
    return (
      <div className="space-y-4">
        {pageHeader}
        <div className="grid grid-cols-2 gap-3">
          {kpiCards.map((card) => (
            <KpiCardView key={card.title} card={card} compact />
          ))}
        </div>
        {trendChartCard}
        <TodoPanel items={todoItems} filter={todoFilter} onFilterChange={setTodoFilter} />
        <RecentReleasesPanel releases={recentReleases} onViewAll={() => navigate('/releases')} />
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
        <RecentReleasesPanel releases={recentReleases} onViewAll={() => navigate('/releases')} />
        {successChartCard}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <TodoPanel items={todoItems} filter={todoFilter} onFilterChange={setTodoFilter} />
        {trendChartCard}
      </div>
    </div>
  );
}
