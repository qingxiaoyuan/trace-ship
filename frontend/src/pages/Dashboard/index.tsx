import type { ComponentType, ReactNode } from 'react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownRight,
  ArrowRight,
  CheckCircle2,
  Download,
  GitPullRequestArrow,
  Hammer,
  Loader,
  Rocket,
  ScanSearch,
  TrendingUp,
  TriangleAlert,
  XCircle,
} from 'lucide-react';
import { dashboardApi } from '@/api/dashboard';
import { releaseApi } from '@/api/release';
import { commitApi } from '@/api/commit';
import { jenkinsApi } from '@/api/jenkins';
import { useAuthStore } from '@/stores/authStore';
import type { BuildRecord, Release, ReleaseType } from '@/types';

type LucideIcon = ComponentType<{ className?: string; strokeWidth?: number }>;

type PipelineStatus = 'draft' | 'building' | 'pending' | 'released' | 'rejected';

interface KpiCard {
  title: string;
  value: ReactNode;
  unit?: string;
  description: ReactNode;
  icon: LucideIcon;
  iconClass: string;
  action?: ReactNode;
}

interface PipelineColumn {
  key: PipelineStatus;
  label: string;
  count: number;
  tone: string;
  dot: string;
  releases: Release[];
}

interface TodoItem {
  key: string;
  title: string;
  project: string;
  meta: string;
  icon: LucideIcon;
  iconClass: string;
  actions: ReactNode;
}

const releaseStatusText: Record<string, string> = {
  draft: '草稿',
  pending: '待审批',
  building: '构建中',
  auditing: '待审批',
  released: '已发布',
  rejected: '已驳回',
};

const releaseTypeText: Record<ReleaseType, string> = {
  formal: '正式',
  rc: 'RC',
  beta: 'Beta',
};

const releaseTypeClass: Record<ReleaseType, string> = {
  formal: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  rc: 'border-blue-200 bg-blue-50 text-blue-700',
  beta: 'border-amber-200 bg-amber-50 text-amber-700',
};

const statusTextClass: Record<string, string> = {
  draft: 'text-slate-500',
  pending: 'text-amber-700',
  building: 'text-cyan-700',
  auditing: 'text-amber-700',
  released: 'text-emerald-700',
  rejected: 'text-rose-600',
};

const statusDotClass: Record<string, string> = {
  draft: 'bg-slate-400',
  pending: 'bg-amber-500 pulse-dot',
  building: 'bg-cyan-500 pulse-dot',
  auditing: 'bg-amber-500 pulse-dot',
  released: 'bg-emerald-500',
  rejected: 'bg-rose-500',
};

const buildBars = [
  { day: '周一', success: 18, failed: 1 },
  { day: '周二', success: 22, failed: 0 },
  { day: '周三', success: 25, failed: 2 },
  { day: '周四', success: 20, failed: 0 },
  { day: '周五', success: 28, failed: 1 },
  { day: '周六', success: 15, failed: 1 },
  { day: '周日', success: 14, failed: 0 },
];

function formatDate(value?: string): string {
  return value?.split('T')[0] || '-';
}

function formatRelative(value?: string): string {
  if (!value) return '刚刚';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDate(value);

  const diff = Date.now() - date.getTime();
  const minutes = Math.max(1, Math.floor(diff / 60000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function normalizeStatus(release: Release): PipelineStatus {
  const status = release.status as string;
  if (status === 'building') return 'building';
  if (status === 'auditing') return 'pending';
  if (status === 'released' || status === 'rejected' || status === 'pending' || status === 'draft') {
    return status;
  }
  return 'draft';
}

function isBuildRunning(build: BuildRecord): boolean {
  return build.status === 'queue' || build.status === 'running';
}

function SmallTag({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${className}`}>
      {children}
    </span>
  );
}

function IconBox({ icon: Icon, className }: { icon: LucideIcon; className: string }) {
  return (
    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${className}`}>
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.5} />
    </div>
  );
}

function KpiCardView({ card }: { card: KpiCard }) {
  return (
    <div className="tech-card tech-card-hover rounded-xl p-5">
      <div className="flex items-start justify-between">
        <IconBox icon={card.icon} className={card.iconClass} />
        {card.action}
      </div>
      <div className="mt-4">
        <div className="flex items-baseline gap-1.5">
          {card.value}
          {card.unit ? <span className="text-[13px] text-slate-400">{card.unit}</span> : null}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[12px] text-slate-500">{card.description}</div>
      </div>
    </div>
  );
}

function PipelineCard({ release, status }: { release: Release; status: PipelineStatus }) {
  const statusLabel = releaseStatusText[release.status as string] || releaseStatusText[status];

  return (
    <button
      type="button"
      className="w-full rounded-lg border border-white/70 bg-white p-2.5 text-left transition-colors hover:border-indigo-300 hover:shadow-sm"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[12px] font-medium text-slate-800">{release.version}</span>
        <SmallTag className={releaseTypeClass[release.release_type]}>{releaseTypeText[release.release_type]}</SmallTag>
      </div>
      <div className="mt-1.5 truncate text-[11px] text-slate-500">{release.project_name || '-'}</div>
      <div className="mt-2 flex items-center gap-1.5">
        {status === 'building' ? (
          <Loader className="spin-slow h-3 w-3 text-cyan-500" strokeWidth={2} />
        ) : status === 'released' ? (
          <CheckCircle2 className="h-3 w-3 text-emerald-500" strokeWidth={1.5} />
        ) : status === 'rejected' ? (
          <XCircle className="h-3 w-3 text-rose-400" strokeWidth={1.5} />
        ) : (
          <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass[status]}`} />
        )}
        <span className="truncate text-[10px] text-slate-400">
          {release.publisher || '系统'} · {statusLabel} · {formatRelative(release.created_at)}
        </span>
      </div>
      {status === 'building' ? (
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-cyan-100">
          <div className="h-full w-[65%] rounded-full bg-gradient-to-r from-cyan-400 to-indigo-400" />
        </div>
      ) : null}
    </button>
  );
}

function EmptyPipelineCard() {
  return (
    <div className="rounded-lg border border-dashed border-white/80 bg-white/50 p-2.5 text-[11px] text-slate-400">
      暂无记录
    </div>
  );
}

function ComplianceRing({ rate }: { rate: number }) {
  return (
    <div className="relative flex items-center justify-center py-3">
      <div
        className="h-[180px] w-[180px] rounded-full"
        style={{
          background: `conic-gradient(#10B981 0 ${rate}%, #F59E0B ${rate}% ${Math.min(100, rate + 1.5)}%, #F43F5E ${Math.min(100, rate + 1.5)}% 100%)`,
        }}
      >
        <div className="m-[18px] flex h-[144px] w-[144px] items-center justify-center rounded-full bg-white shadow-inner">
          <div className="text-center">
            <div className="text-gradient text-[28px] font-semibold tracking-tight">
              {rate}
              <span className="text-[16px] text-slate-400">%</span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400">合规率</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  const { data: overview } = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: () => dashboardApi.getOverview(),
  });

  const { data: releaseData } = useQuery({
    queryKey: ['dashboard-releases'],
    queryFn: () => releaseApi.getReleases({ page_size: 20 }),
  });

  const { data: commitData } = useQuery({
    queryKey: ['dashboard-commits'],
    queryFn: () => commitApi.getCommits({ page_size: 1000 }),
  });

  const { data: buildData } = useQuery({
    queryKey: ['dashboard-builds'],
    queryFn: () => jenkinsApi.getBuilds({ page_size: 20 }),
  });

  const releases = useMemo(() => releaseData?.results || [], [releaseData?.results]);
  const commits = useMemo(() => commitData?.results || [], [commitData?.results]);
  const builds = useMemo(() => buildData?.results || [], [buildData?.results]);
  const recentReleases = releases.slice(0, 10);
  const runningBuilds = builds.filter(isBuildRunning);

  const totalReleases = overview?.total_releases || 0;
  const pendingAuditCount = overview?.pending_audit_count || releases.filter((r) => normalizeStatus(r) === 'pending').length;
  const rejectedCount = overview?.rejected_count || releases.filter((r) => normalizeStatus(r) === 'rejected').length;
  const successRate = Math.round((overview?.success_rate || 0) * 1000) / 10;
  const passCommits = commits.filter((c) => c.review_status === 'pass').length;
  const warningCommits = commits.filter((c) => c.review_status === 'warning').length;
  const illegalCommits = commits.filter((c) => c.review_status === 'illegal').length;
  const complianceRate = commits.length ? Math.round((passCommits / commits.length) * 1000) / 10 : 100;
  const displayName = user?.nickname || user?.username || '张三';

  const pipelineColumns: PipelineColumn[] = [
    {
      key: 'draft',
      label: '草稿',
      count: releases.filter((r) => normalizeStatus(r) === 'draft').length,
      tone: 'border-slate-200/70 bg-slate-50/50 text-slate-500',
      dot: 'bg-slate-400',
      releases: releases.filter((r) => normalizeStatus(r) === 'draft').slice(0, 2),
    },
    {
      key: 'building',
      label: '构建中',
      count: runningBuilds.length + releases.filter((r) => normalizeStatus(r) === 'building').length,
      tone: 'border-cyan-200/70 bg-cyan-50/40 text-cyan-700',
      dot: 'bg-cyan-500 pulse-dot',
      releases: releases.filter((r) => normalizeStatus(r) === 'building').slice(0, 2),
    },
    {
      key: 'pending',
      label: '待审批',
      count: pendingAuditCount,
      tone: 'border-amber-200/70 bg-amber-50/40 text-amber-700',
      dot: 'bg-amber-500 pulse-dot',
      releases: releases.filter((r) => normalizeStatus(r) === 'pending').slice(0, 2),
    },
    {
      key: 'released',
      label: '已发布',
      count: releases.filter((r) => normalizeStatus(r) === 'released').length,
      tone: 'border-emerald-200/70 bg-emerald-50/40 text-emerald-700',
      dot: 'bg-emerald-500',
      releases: releases.filter((r) => normalizeStatus(r) === 'released').slice(0, 2),
    },
    {
      key: 'rejected',
      label: '已驳回',
      count: rejectedCount,
      tone: 'border-rose-200/70 bg-rose-50/40 text-rose-700',
      dot: 'bg-rose-500',
      releases: releases.filter((r) => normalizeStatus(r) === 'rejected').slice(0, 2),
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
      title: `构建 #${build.build_number || build.queue_id || '--'} 进行中`,
      project: build.project_name || build.job_name,
      meta: `${build.version || '当前版本'} · ${build.status_display || '运行中'}`,
      icon: Hammer,
      iconClass: 'icon-cyan',
      actions: (
        <button
          onClick={() => navigate(`/jenkins/logs/${build.id}`)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600"
        >
          查看日志
        </button>
      ),
    })),
    ...(illegalCommits > 0
      ? [
          {
            key: 'commit-alerts',
            title: `${illegalCommits} 条不合规提交需处理`,
            project: commits.find((c) => c.review_status === 'illegal')?.project_name || '提交审查',
            meta: '提交信息不符合规范或存在异常，需要确认',
            icon: TriangleAlert,
            iconClass: 'icon-rose',
            actions: (
              <button
                onClick={() => navigate('/commits/alerts')}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600"
              >
                查看
              </button>
            ),
          },
        ]
      : []),
  ].slice(0, 5);

  const kpiCards: KpiCard[] = [
    {
      title: '累计发布数',
      value: <span className="text-[28px] font-semibold tracking-tight text-slate-900">{totalReleases}</span>,
      unit: '次发布',
      description: (
        <>
          <span>成功率 {successRate}%</span>
          <span className="h-1 w-1 rounded-full bg-slate-300" />
          <span>最近 {recentReleases.length} 条</span>
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
    },
    {
      title: '待审批数',
      value: <span className="text-[28px] font-semibold tracking-tight text-slate-900">{pendingAuditCount}</span>,
      unit: '个审批',
      description: `最近提交于 ${formatRelative(releases.find((r) => normalizeStatus(r) === 'pending')?.created_at)}`,
      icon: GitPullRequestArrow,
      iconClass: 'icon-amber',
      action: <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-600">待处理</span>,
    },
    {
      title: '已驳回',
      value: <span className="text-[28px] font-semibold tracking-tight text-slate-900">{rejectedCount}</span>,
      unit: '个驳回',
      description: '需关注异常构建',
      icon: TriangleAlert,
      iconClass: 'icon-rose',
      action: (
        <div className="flex items-center gap-1 text-[11px] font-medium text-rose-500">
          <ArrowDownRight className="h-3 w-3" strokeWidth={1.5} />
          <span>{rejectedCount}</span>
        </div>
      ),
    },
    {
      title: 'Commit 合规率',
      value: (
        <span className="text-gradient text-[28px] font-semibold tracking-tight">
          {complianceRate}
          <span className="text-[18px] text-slate-400">%</span>
        </span>
      ),
      description: `本批 ${commits.length} 条提交，${illegalCommits} 条不合规`,
      icon: ScanSearch,
      iconClass: 'icon-violet',
      action: <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">合规</span>,
    },
  ];

  const buildSuccess = builds.filter((build) => build.status === 'success').length || 142;
  const buildFailed = builds.filter((build) => build.status === 'failure' || build.status === 'aborted').length || 5;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">工作台</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            {getGreeting()}，{displayName}。今天有{' '}
            <span className="font-medium text-indigo-600">{pendingAuditCount}</span> 个发布待审批，
            <span className="font-medium text-cyan-600">{runningBuilds.length}</span> 个构建进行中。
          </p>
        </div>
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
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((card) => (
          <KpiCardView key={card.title} card={card} />
        ))}
      </div>

      <div className="tech-card rounded-xl p-5 lg:p-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-[16px] font-semibold tracking-tight text-slate-900">发布流水线</h2>
            <p className="mt-0.5 text-[12px] text-slate-500">实时跟踪所有发布的状态流转</p>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-indigo-100 bg-indigo-50/40 p-0.5">
            <button className="rounded-md bg-white px-2.5 py-1 text-[12px] font-medium text-indigo-600 shadow-sm">全部</button>
            <button className="rounded-md px-2.5 py-1 text-[12px] font-medium text-slate-500 transition-colors hover:text-slate-700">今日</button>
            <button className="rounded-md px-2.5 py-1 text-[12px] font-medium text-slate-500 transition-colors hover:text-slate-700">本周</button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:gap-4">
          {pipelineColumns.map((column) => (
            <div key={column.key} className={`rounded-lg border p-3 ${column.tone}`}>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${column.dot}`} />
                  <span className="text-[12px] font-medium">{column.label}</span>
                </div>
                <span className="text-[11px] font-medium">{column.count}</span>
              </div>
              <div className="space-y-2">
                {column.releases.length > 0 ? (
                  column.releases.map((release) => <PipelineCard key={release.id} release={release} status={column.key} />)
                ) : (
                  <EmptyPipelineCard />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="tech-card rounded-xl lg:col-span-2">
          <div className="flex items-center justify-between border-b border-indigo-50 px-5 py-4">
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">最近发布</h2>
              <p className="mt-0.5 text-[12px] text-slate-500">最近 10 条发布记录</p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/releases')}
              className="inline-flex items-center gap-1 text-[13px] font-medium text-indigo-600 transition-colors hover:text-indigo-500"
            >
              <span>查看全部</span>
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </div>

          <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
            <div className="col-span-3">版本</div>
            <div className="col-span-3">项目</div>
            <div className="col-span-2">类型</div>
            <div className="col-span-2">发布人</div>
            <div className="col-span-2 text-right">状态</div>
          </div>

          <div className="divide-y divide-indigo-50/50">
            {recentReleases.length > 0 ? (
              recentReleases.map((release) => {
                const status = release.status as string;
                return (
                  <div
                    key={release.id}
                    className="grid cursor-pointer grid-cols-12 items-center gap-3 px-5 py-3 transition-colors hover:bg-indigo-50/30"
                  >
                    <div className="col-span-12 flex items-center gap-2 md:col-span-3">
                      <span className="font-mono text-[13px] font-medium text-slate-900">{release.version}</span>
                    </div>
                    <div className="col-span-6 text-[13px] text-slate-600 md:col-span-3">{release.project_name || '-'}</div>
                    <div className="col-span-6 md:col-span-2">
                      <SmallTag className={releaseTypeClass[release.release_type]}>{releaseTypeText[release.release_type]}</SmallTag>
                    </div>
                    <div className="col-span-6 flex items-center gap-1.5 md:col-span-2">
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-cyan-400 text-[9px] font-semibold text-white">
                        {(release.publisher || '系').charAt(0)}
                      </span>
                      <span className="text-[12px] text-slate-600">{release.publisher || '系统'}</span>
                    </div>
                    <div className="col-span-6 flex items-center justify-end gap-1.5 md:col-span-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass[status] || 'bg-slate-400'}`} />
                      <span className={`text-[12px] font-medium ${statusTextClass[status] || 'text-slate-500'}`}>
                        {releaseStatusText[status] || status}
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="px-5 py-8 text-center text-[13px] text-slate-400">暂无发布记录</div>
            )}
          </div>
        </div>

        <div className="tech-card rounded-xl p-5">
          <div className="mb-2">
            <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">提交合规率</h2>
            <p className="mt-0.5 text-[12px] text-slate-500">本周提交规范审查</p>
          </div>
          <ComplianceRing rate={complianceRate} />
          <div className="mt-4 space-y-2.5 border-t border-indigo-50 pt-4">
            {[
              ['合规', passCommits, 'bg-emerald-400'],
              ['警告', warningCommits, 'bg-amber-400'],
              ['不合规', illegalCommits, 'bg-rose-400'],
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
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="tech-card rounded-xl lg:col-span-2">
          <div className="flex items-center justify-between border-b border-indigo-50 px-5 py-4">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">我的待办</h2>
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-600">
                {todoItems.length}
              </span>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-indigo-100 bg-indigo-50/40 p-0.5">
              <button className="rounded-md bg-white px-2.5 py-1 text-[12px] font-medium text-indigo-600 shadow-sm">全部</button>
              <button className="rounded-md px-2.5 py-1 text-[12px] font-medium text-slate-500 transition-colors hover:text-slate-700">审批</button>
              <button className="rounded-md px-2.5 py-1 text-[12px] font-medium text-slate-500 transition-colors hover:text-slate-700">构建</button>
            </div>
          </div>
          <div className="divide-y divide-indigo-50/50">
            {todoItems.length > 0 ? (
              todoItems.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.key} className="group flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-indigo-50/30">
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${item.iconClass}`}>
                      <Icon className="h-4 w-4" strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-medium text-slate-900">{item.title}</span>
                        <span className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[10px] font-medium text-slate-500">
                          {item.project}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-400">{item.meta}</div>
                    </div>
                    <div className="shrink-0">{item.actions}</div>
                  </div>
                );
              })
            ) : (
              <div className="px-5 py-8 text-center text-[13px] text-slate-400">暂无待办任务</div>
            )}
          </div>
        </div>

        <div className="tech-card rounded-xl p-5">
          <div className="mb-4">
            <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">构建趋势</h2>
            <p className="mt-0.5 text-[12px] text-slate-500">最近 7 天</p>
          </div>
          <div className="flex h-[160px] items-end gap-2">
            {buildBars.map((bar) => {
              const max = Math.max(...buildBars.map((item) => item.success + item.failed));
              const successHeight = Math.max(12, Math.round((bar.success / max) * 130));
              const failedHeight = Math.max(4, Math.round((bar.failed / max) * 130));
              return (
                <div key={bar.day} className="flex flex-1 flex-col items-center gap-2">
                  <div className="flex h-[132px] w-full items-end justify-center gap-1">
                    <div className="w-2 rounded-t bg-emerald-400" style={{ height: successHeight }} />
                    <div className="w-2 rounded-t bg-rose-400" style={{ height: failedHeight }} />
                  </div>
                  <span className="text-[10px] text-slate-400">{bar.day.slice(1)}</span>
                </div>
              );
            })}
          </div>
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
            <span className="text-[11px] text-slate-400">平均构建时长</span>
            <span className="font-mono text-[13px] font-medium text-cyan-600">4m 12s</span>
          </div>
        </div>
      </div>
    </div>
  );
}
