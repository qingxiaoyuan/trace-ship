import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  FolderTree,
  GitBranch,
  History,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react';
import dayjs from 'dayjs';
import { repositoryApi } from '@/api/repository';
import { releaseApi } from '@/api/release';
import { commitApi } from '@/api/commit';
import { useAppMessage } from '@/hooks/useAppMessage';
import { TsModal } from '@/components/TsModal';
import { formatRelativeTime } from '@/utils/time';
import {
  releaseStatusText,
  statusBadge,
} from '@/pages/Release/constants';
import type {
  CommitRecord,
  ParsedCommit,
  Release,
  ReleaseCommit,
  RepoComplianceStat,
  ReviewStatus,
} from '@/types';

/** 三个审查板块 */
type Sect = 'release-ing' | 'released' | 'repo';

/** 审查状态展示元数据 */
const reviewMeta: Record<
  ReviewStatus,
  { label: string; badge: string; dot: string; Icon: typeof Check }
> = {
  pass: {
    label: '通过',
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    dot: 'bg-emerald-500',
    Icon: Check,
  },
  warning: {
    label: '警告',
    badge: 'border-amber-200 bg-amber-50 text-amber-600',
    dot: 'bg-amber-400',
    Icon: AlertTriangle,
  },
  illegal: {
    label: '非法',
    badge: 'border-rose-200 bg-rose-50 text-rose-600',
    dot: 'bg-rose-500',
    Icon: XCircle,
  },
  unreviewed: {
    label: '未审查',
    badge: 'border-slate-200 bg-slate-50 text-slate-500',
    dot: 'bg-slate-300',
    Icon: CircleSlash,
  },
};

/** 提交行统一视图模型 */
interface CommitRowVM {
  id: string;
  commit_hash: string;
  author: string;
  message: string;
  review_status: ReviewStatus;
  review_reason?: string;
  parsed_result?: ParsedCommit;
  committed_at: string;
}

/** 更新内容类型标记颜色：A/F 为规范，其余标红 */
function updateTypeColor(type?: string): string {
  return type === 'A' || type === 'F' ? 'text-indigo-500' : 'text-rose-500';
}

/** 把发布提交 / 仓库提交归一化为行视图模型 */
function toRowVM(c: ReleaseCommit | CommitRecord): CommitRowVM {
  if ('commit_id' in c) {
    return {
      id: c.commit_id || c.id,
      commit_hash: c.commit_hash,
      author: c.author,
      message: c.message,
      review_status: c.review_status,
      review_reason: c.review_reason,
      parsed_result: c.parsed_result,
      committed_at: c.committed_at,
    };
  }
  return {
    id: c.id,
    commit_hash: c.commit_hash,
    author: c.author,
    message: c.message,
    review_status: c.review_status,
    review_reason: c.review_reason,
    parsed_result: c.parsed_result,
    committed_at: c.committed_at,
  };
}

/** 阻断/回溯/警告等级：illegal 最严重 */
function rowTone(illegal: number, warning: number): 'rose' | 'amber' | 'emerald' {
  if (illegal > 0) return 'rose';
  if (warning > 0) return 'amber';
  return 'emerald';
}

const toneDot: Record<'rose' | 'amber' | 'emerald', string> = {
  rose: 'bg-rose-500',
  amber: 'bg-amber-400',
  emerald: 'bg-emerald-500',
};

export default function CommitReview() {
  const [sect, setSect] = useState<Sect>('release-ing');

  return (
    <div className="space-y-5">
      {/* 页面标题 */}
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">提交审查</h1>
        <p className="mt-1 text-[13px] text-slate-500">
          基于「变更类型 + A/F 更新内容」规范，审查发布中、已发布与仓库提交的合规性
        </p>
      </div>

      {/* 三块 Tab */}
      <div className="flex flex-wrap items-center gap-1.5">
        <SectTab
          active={sect === 'release-ing'}
          onClick={() => setSect('release-ing')}
          icon={LoaderCircle}
          label="发布中审查"
          countKey="release-ing"
        />
        <SectTab
          active={sect === 'released'}
          onClick={() => setSect('released')}
          icon={History}
          label="已发布回溯"
          countKey="released"
        />
        <SectTab
          active={sect === 'repo'}
          onClick={() => setSect('repo')}
          icon={GitBranch}
          label="仓库合规扫描"
          countKey="repo"
        />
      </div>

      {sect === 'release-ing' && <ReleaseReviewSection kind="ing" />}
      {sect === 'released' && <ReleaseReviewSection kind="released" />}
      {sect === 'repo' && <RepoScanSection />}
    </div>
  );
}

/* ============================================================
 * 板块 Tab（含计数徽标）
 * ============================================================ */
function SectTab({
  active,
  onClick,
  icon: Icon,
  label,
  countKey,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Check;
  label: string;
  countKey: Sect;
}) {
  const count = useSectionCount(countKey);
  return (
    <button
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[13px] font-medium transition-colors',
        active
          ? 'border-indigo-500 bg-indigo-50 text-indigo-600'
          : 'border-transparent text-slate-500 hover:text-indigo-600',
      ].join(' ')}
    >
      <Icon className="h-4 w-4" strokeWidth={1.5} />
      {label}
      <span
        className={`font-mono text-[11px] ${active ? 'text-indigo-400' : 'text-slate-400'}`}
      >
        {count}
      </span>
    </button>
  );
}

/** 板块计数：发布中=draft+pending，已发布=released，仓库=仓库数 */
function useSectionCount(key: Sect): number {
  const draftQ = useQuery({
    queryKey: ['releases', 'count', 'draft'],
    queryFn: () => releaseApi.getReleases({ status: 'draft', page: 1, page_size: 1 }),
  });
  const pendingQ = useQuery({
    queryKey: ['releases', 'count', 'pending'],
    queryFn: () => releaseApi.getReleases({ status: 'pending', page: 1, page_size: 1 }),
  });
  const releasedQ = useQuery({
    queryKey: ['releases', 'count', 'released'],
    queryFn: () => releaseApi.getReleases({ status: 'released', page: 1, page_size: 1 }),
  });
  const repoQ = useQuery({
    queryKey: ['repositories', 'compliance-stats', 'count'],
    queryFn: () => repositoryApi.getComplianceStats(),
  });
  if (key === 'release-ing') return (draftQ.data?.total ?? 0) + (pendingQ.data?.total ?? 0);
  if (key === 'released') return releasedQ.data?.total ?? 0;
  return repoQ.data?.length ?? 0;
}

/* ============================================================
 * 第一/二块：发布中审查 / 已发布回溯
 * ============================================================ */
function ReleaseReviewSection({ kind }: { kind: 'ing' | 'released' }) {
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<Release | null>(null);

  const isReleased = kind === 'released';

  // 拉取发布列表（发布中=draft+pending 两次请求合并；已发布单次，取较多条供客户端检索）
  const draftQ = useQuery({
    queryKey: ['releases', 'review', 'draft'],
    queryFn: () => releaseApi.getReleases({ status: 'draft', page: 1, page_size: 100 }),
    enabled: !isReleased,
  });
  const pendingQ = useQuery({
    queryKey: ['releases', 'review', 'pending'],
    queryFn: () => releaseApi.getReleases({ status: 'pending', page: 1, page_size: 100 }),
    enabled: !isReleased,
  });
  const releasedQ = useQuery({
    queryKey: ['releases', 'review', 'released'],
    queryFn: () => releaseApi.getReleases({ status: 'released', page: 1, page_size: 100 }),
    enabled: isReleased,
  });

  const loading = isReleased ? releasedQ.isLoading : draftQ.isLoading || pendingQ.isLoading;
  const all = useMemo(() => {
    if (isReleased) return releasedQ.data?.results ?? [];
    return [...(draftQ.data?.results ?? []), ...(pendingQ.data?.results ?? [])];
  }, [isReleased, releasedQ.data, draftQ.data, pendingQ.data]);

  const rows = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return all;
    return all.filter(
      (r) =>
        r.version?.toLowerCase().includes(kw) ||
        r.project_name?.toLowerCase().includes(kw),
    );
  }, [all, keyword]);

  if (selected) {
    return (
      <ReleaseReviewDetail
        release={selected}
        kind={kind}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="tech-card overflow-hidden rounded-xl">
        {/* 搜索栏 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-indigo-50 px-5 py-3">
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              strokeWidth={1.5}
            />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索项目 / 版本号"
              className="w-[220px] rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div className="ml-auto text-[12px] text-slate-400">
            共 {rows.length} 个{isReleased ? '已发布' : '发布中'}
          </div>
        </div>

        {/* 表头 */}
        <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
          <div className="col-span-3">发布单</div>
          <div className="col-span-2">项目</div>
          <div className="col-span-1 text-center">提交</div>
          <div className="col-span-1 text-center">通过</div>
          <div className="col-span-1 text-center">警告</div>
          <div className="col-span-1 text-center">非法</div>
          <div className="col-span-1">{isReleased ? '回溯结果' : '状态'}</div>
          <div className="col-span-1 text-right">操作</div>
        </div>

        {/* 列表 */}
        <div className="divide-y divide-indigo-50/50">
          {loading ? (
            <div className="flex items-center justify-center px-5 py-16 text-[13px] text-slate-400">
              加载中…
            </div>
          ) : rows.length === 0 ? (
            <div className="flex items-center justify-center px-5 py-16 text-[13px] text-slate-400">
              暂无数据
            </div>
          ) : (
            rows.map((r) => {
              const illegal = r.illegal_count ?? 0;
              const warning = r.warning_count ?? 0;
              const tone = rowTone(illegal, warning);
              return (
                <div
                  key={r.id}
                  onClick={() => setSelected(r)}
                  className="grid cursor-pointer grid-cols-12 items-center gap-3 px-5 py-3.5 transition-colors hover:bg-indigo-50/30"
                >
                  <div className="col-span-12 flex items-center gap-2 md:col-span-3">
                    <span className={`inline-flex h-2 w-2 rounded-full ${toneDot[tone]}`} />
                    <div>
                      <div className="font-mono text-[13px] font-medium text-slate-900">
                        {r.version}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {releaseStatusText[r.status]}
                      </div>
                    </div>
                  </div>
                  <div className="col-span-6 text-[13px] text-slate-700 md:col-span-2">
                    {r.project_name || '-'}
                  </div>
                  <div className="col-span-3 text-center font-mono text-[13px] text-slate-700 md:col-span-1">
                    {r.commit_total ?? 0}
                  </div>
                  <div className="col-span-3 text-center font-mono text-[13px] text-emerald-600 md:col-span-1">
                    {r.pass_count ?? 0}
                  </div>
                  <div className="col-span-3 text-center font-mono text-[13px] text-amber-600 md:col-span-1">
                    {warning}
                  </div>
                  <div className="col-span-3 text-center md:col-span-1">
                    {illegal > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-600">
                        {illegal} 非法
                      </span>
                    ) : (
                      <span className="font-mono text-[13px] text-slate-300">0</span>
                    )}
                  </div>
                  <div className="col-span-6 md:col-span-1">
                    {isReleased ? (
                      <ResultBadge tone={tone} />
                    ) : (
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${statusBadge[r.status]}`}
                      >
                        {r.status === 'pending' && (
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 pulse-dot" />
                        )}
                        {releaseStatusText[r.status]}
                      </span>
                    )}
                  </div>
                  <div className="col-span-6 flex items-center justify-end md:col-span-1">
                    <ChevronRight className="h-4 w-4 text-slate-300" strokeWidth={1.5} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

/** 回溯结果徽标 */
function ResultBadge({ tone }: { tone: 'rose' | 'amber' | 'emerald' }) {
  if (tone === 'rose')
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-600">
        <AlertOctagon className="h-3 w-3" strokeWidth={1.5} />存在非法
      </span>
    );
  if (tone === 'amber')
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-600">
        <AlertTriangle className="h-3 w-3" strokeWidth={1.5} />存在警告
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
      <Check className="h-3 w-3" strokeWidth={1.5} />全部合规
    </span>
  );
}

/* ============================================================
 * 发布审查详情（第一/二块共用）
 * ============================================================ */
function ReleaseReviewDetail({
  release,
  kind,
  onBack,
}: {
  release: Release;
  kind: 'ing' | 'released';
  onBack: () => void;
}) {
  const isReleased = kind === 'released';
  const [statusFilter, setStatusFilter] = useState<ReviewStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const illegal = release.illegal_count ?? 0;
  const warning = release.warning_count ?? 0;
  const pass = release.pass_count ?? 0;
  const total = release.commit_total ?? 0;

  const { data, isLoading } = useQuery({
    queryKey: ['release', 'commits', release.id, statusFilter, page, pageSize],
    queryFn: () =>
      releaseApi.getCommits(release.id, {
        page,
        page_size: pageSize,
        ...(statusFilter !== 'all' ? { review_status: statusFilter } : {}),
      }),
  });

  const commits = data?.results ?? [];
  const totalCommits = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCommits / pageSize));

  const filters: { key: ReviewStatus | 'all'; label: string; count: number }[] = [
    { key: 'all', label: '全部', count: total },
    { key: 'illegal', label: '非法', count: illegal },
    { key: 'warning', label: '警告', count: warning },
    { key: 'pass', label: '通过', count: pass },
  ];

  return (
    <div className="space-y-5">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-[13px]">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-slate-400 transition-colors hover:text-indigo-600"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
          {isReleased ? '已发布回溯' : '发布中审查'}
        </button>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" strokeWidth={1.5} />
        <span className="font-mono font-medium text-slate-800">{release.version}</span>
      </div>

      {/* 概要卡 */}
      <div className="tech-card rounded-xl p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                isReleased ? 'icon-indigo' : 'icon-rose'
              }`}
            >
              {isReleased ? (
                <History className="h-5 w-5" strokeWidth={1.5} />
              ) : (
                <LoaderCircle className="h-5 w-5" strokeWidth={1.5} />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[20px] font-semibold tracking-tight text-slate-900">
                  {release.version}
                </h2>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${statusBadge[release.status]}`}
                >
                  {release.status === 'pending' && (
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500 pulse-dot" />
                  )}
                  {releaseStatusText[release.status]}
                </span>
              </div>
              <div className="mt-0.5 text-[12px] text-slate-500">
                {release.project_name || '-'} · {total} 个提交
                {illegal > 0
                  ? ` · 含 ${illegal} 个非法提交（将阻断审批）`
                  : warning > 0
                    ? ` · 含 ${warning} 个警告`
                    : ' · 全部通过'}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-3 border-t border-indigo-50 pt-4">
          <Stat icon={Check} iconCls="icon-emerald" value={pass} label="通过" />
          <Stat icon={AlertTriangle} iconCls="icon-amber" value={warning} label="警告" />
          <Stat icon={XCircle} iconCls="icon-rose" value={illegal} label="非法" />
          <Stat icon={CircleSlash} iconCls="icon-indigo" value={total} label="总计" />
        </div>
      </div>

      {/* 阻断 / 回溯提示 */}
      {illegal > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50/50 p-4">
          {isReleased ? (
            <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" strokeWidth={1.5} />
          ) : (
            <Ban className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" strokeWidth={1.5} />
          )}
          <div className="text-[12px] leading-relaxed text-slate-600">
            {isReleased ? (
              <>
                <span className="font-medium text-rose-600">
                  回溯发现 {illegal} 个非法提交已发布到生产环境。
                </span>
                该提交在发布时未通过规则审查但仍被纳入发布说明，建议排查原因并完善审查流程。
              </>
            ) : (
              <>
                <span className="font-medium text-rose-600">
                  存在 {illegal} 个非法提交，将阻断审批流程。
                </span>
                请通知对应开发者修正提交信息后重新生成发布说明，或人工复核标记为通过 / 警告。
              </>
            )}
          </div>
        </div>
      )}

      {/* 提交列表 */}
      <div className="tech-card overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center gap-2 border-b border-indigo-50 px-5 py-3">
          <h3 className="text-[14px] font-semibold text-slate-900">提交列表（{total}）</h3>
          <div className="ml-auto flex flex-wrap items-center gap-1">
            {filters.map((f) => (
              <FilterChip
                key={f.key}
                active={statusFilter === f.key}
                onClick={() => {
                  setStatusFilter(f.key);
                  setPage(1);
                }}
              >
                {f.label} {f.count}
              </FilterChip>
            ))}
          </div>
        </div>
        <CommitList rows={commits.map(toRowVM)} loading={isLoading} />
        {(totalCommits > 0 || page > 1) && (
          <Pager
            page={page}
            totalPages={totalPages}
            total={totalCommits}
            pageSize={pageSize}
            onChange={setPage}
          />
        )}
      </div>
    </div>
  );
}

/* ============================================================
 * 第三块：仓库合规扫描
 * ============================================================ */
function RepoScanSection() {
  const [keyword, setKeyword] = useState('');
  const [vendor, setVendor] = useState('all');
  const [selected, setSelected] = useState<RepoComplianceStat | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['repositories', 'compliance-stats'],
    queryFn: () => repositoryApi.getComplianceStats(),
  });

  const rows = useMemo(() => {
    const list = data ?? [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r) => {
      if (vendor !== 'all' && r.vendor !== vendor) return false;
      if (kw && !r.name?.toLowerCase().includes(kw) && !r.project_name?.toLowerCase().includes(kw))
        return false;
      return true;
    });
  }, [data, keyword, vendor]);

  if (selected) {
    return <RepoScanDetail repo={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="space-y-5">
      <div className="tech-card overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center gap-2 border-b border-indigo-50 px-5 py-3">
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              strokeWidth={1.5}
            />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索仓库名称"
              className="w-[220px] rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <VendorSelect value={vendor} onChange={setVendor} />
          <div className="ml-auto text-[12px] text-slate-400">共 {rows.length} 个仓库</div>
        </div>

        <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
          <div className="col-span-3">仓库</div>
          <div className="col-span-2">项目</div>
          <div className="col-span-1 text-center">提交</div>
          <div className="col-span-1 text-center">通过</div>
          <div className="col-span-1 text-center">警告</div>
          <div className="col-span-1 text-center">非法</div>
          <div className="col-span-1">最近同步</div>
          <div className="col-span-1 text-right">操作</div>
        </div>

        <div className="divide-y divide-indigo-50/50">
          {isLoading ? (
            <div className="flex items-center justify-center px-5 py-16 text-[13px] text-slate-400">
              加载中…
            </div>
          ) : rows.length === 0 ? (
            <div className="flex items-center justify-center px-5 py-16 text-[13px] text-slate-400">
              暂无仓库
            </div>
          ) : (
            rows.map((r) => (
              <RepoListRow key={r.id} repo={r} onClick={() => setSelected(r)} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function RepoListRow({ repo, onClick }: { repo: RepoComplianceStat; onClick: () => void }) {
  const queryClient = useQueryClient();
  const { message } = useAppMessage();
  const syncMut = useMutation({
    mutationFn: () => repositoryApi.syncCommits(repo.id),
    onSuccess: () => {
      message.success('已触发同步，稍后刷新查看结果');
      queryClient.invalidateQueries({ queryKey: ['repositories', 'compliance-stats'] });
      queryClient.invalidateQueries({ queryKey: ['repository', 'commits', repo.id] });
    },
    onError: (err: unknown) => {
      message.error((err as { message?: string })?.message || '同步失败');
    },
  });
  const syncing = syncMut.isPending;
  return (
    <div
      onClick={onClick}
      className="grid cursor-pointer grid-cols-12 items-center gap-3 px-5 py-3.5 transition-colors hover:bg-indigo-50/30"
    >
      <div className="col-span-12 flex items-center gap-2 md:col-span-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-md icon-indigo">
          {repo.repo_type === 'svn' ? (
            <FolderTree className="h-3.5 w-3.5" strokeWidth={1.5} />
          ) : (
            <GitBranch className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
        </div>
        <div>
          <div className="text-[13px] font-medium text-slate-900">{repo.name}</div>
          <div className="text-[11px] text-slate-400">
            {repo.vendor} · {repo.default_branch}
          </div>
        </div>
      </div>
      <div className="col-span-6 text-[13px] text-slate-700 md:col-span-2">
        {repo.project_name || '-'}
      </div>
      <div className="col-span-3 text-center font-mono text-[13px] text-slate-700 md:col-span-1">
        {repo.commit_total.toLocaleString()}
      </div>
      <div className="col-span-3 text-center font-mono text-[13px] text-emerald-600 md:col-span-1">
        {repo.pass_count.toLocaleString()}
      </div>
      <div className="col-span-3 text-center font-mono text-[13px] text-amber-600 md:col-span-1">
        {repo.warning_count.toLocaleString()}
      </div>
      <div className="col-span-3 text-center font-mono text-[13px] text-rose-600 md:col-span-1">
        {repo.illegal_count.toLocaleString()}
      </div>
      <div className="col-span-6 flex items-center gap-1 text-[12px] text-slate-500 md:col-span-1">
        {syncing ? (
          <>
            <LoaderCircle className="h-3 w-3 animate-spin text-amber-500" strokeWidth={1.5} />
            同步中
          </>
        ) : (
          <>
            <RefreshCw className="h-3 w-3 text-emerald-500" strokeWidth={1.5} />
            {formatRelativeTime(repo.last_sync_at || undefined)}
          </>
        )}
      </div>
      <div className="col-span-6 flex items-center justify-end gap-1 md:col-span-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            syncMut.mutate();
          }}
          disabled={syncing}
          title="同步扫描"
          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} strokeWidth={1.5} />
        </button>
        <ChevronRight className="h-4 w-4 text-slate-300" strokeWidth={1.5} />
      </div>
    </div>
  );
}

function RepoScanDetail({ repo, onBack }: { repo: RepoComplianceStat; onBack: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = useAppMessage();
  const [statusFilter, setStatusFilter] = useState<ReviewStatus | 'all'>('all');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const { data, isLoading } = useQuery({
    queryKey: ['repository', 'commits', repo.id, statusFilter, page, pageSize],
    queryFn: () =>
      repositoryApi.getRepositoryCommits(repo.id, {
        page,
        page_size: pageSize,
        ...(statusFilter !== 'all' ? { review_status: statusFilter } : {}),
      }),
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // 客户端在当前页内按关键字检索（message / hash / author）
  const rows = useMemo(() => {
    const allCommits = data?.results ?? [];
    const kw = keyword.trim().toLowerCase();
    if (!kw) return allCommits;
    return allCommits.filter(
      (c) =>
        c.message?.toLowerCase().includes(kw) ||
        c.commit_hash?.toLowerCase().includes(kw) ||
        c.author?.toLowerCase().includes(kw),
    );
  }, [data, keyword]);

  const complianceRate =
    repo.commit_total > 0
      ? ((repo.pass_count / repo.commit_total) * 100).toFixed(1)
      : '0.0';

  const syncMut = useMutation({
    mutationFn: () => repositoryApi.syncCommits(repo.id),
    onSuccess: () => {
      message.success('已触发同步并扫描，稍后刷新查看结果');
      queryClient.invalidateQueries({ queryKey: ['repositories', 'compliance-stats'] });
      queryClient.invalidateQueries({ queryKey: ['repository', 'commits', repo.id] });
    },
    onError: (err: unknown) => {
      message.error((err as { message?: string })?.message || '同步失败');
    },
  });

  const filters: { key: ReviewStatus | 'all'; label: string; count: number }[] = [
    { key: 'all', label: '全部', count: repo.commit_total },
    { key: 'illegal', label: '非法', count: repo.illegal_count },
    { key: 'warning', label: '警告', count: repo.warning_count },
    { key: 'pass', label: '通过', count: repo.pass_count },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-[13px]">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-slate-400 transition-colors hover:text-indigo-600"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
          仓库合规扫描
        </button>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" strokeWidth={1.5} />
        <span className="font-medium text-slate-800">{repo.name}</span>
      </div>

      {/* 概要卡 */}
      <div className="tech-card rounded-xl p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl icon-indigo">
              {repo.repo_type === 'svn' ? (
                <FolderTree className="h-5 w-5" strokeWidth={1.5} />
              ) : (
                <GitBranch className="h-5 w-5" strokeWidth={1.5} />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[20px] font-semibold tracking-tight text-slate-900">
                  {repo.name}
                </h2>
                <span className="inline-flex items-center rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-600">
                  {repo.vendor}
                </span>
              </div>
              <div className="mt-0.5 text-[12px] text-slate-500">
                {repo.project_name || '-'} · {repo.default_branch} ·{' '}
                {repo.commit_total.toLocaleString()} commits · 合规率 {complianceRate}%
              </div>
            </div>
          </div>
          <button
            onClick={() => syncMut.mutate()}
            disabled={syncMut.isPending}
            className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncMut.isPending ? 'animate-spin' : ''}`} strokeWidth={1.5} />
            同步并扫描
          </button>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-3 border-t border-indigo-50 pt-4">
          <Stat icon={Check} iconCls="icon-emerald" value={repo.pass_count} label="通过" />
          <Stat icon={AlertTriangle} iconCls="icon-amber" value={repo.warning_count} label="警告" />
          <Stat icon={XCircle} iconCls="icon-rose" value={repo.illegal_count} label="非法" />
          <Stat
            icon={CircleSlash}
            iconCls="icon-cyan"
            value={repo.unreviewed_count}
            label="未审查"
          />
        </div>
      </div>

      {/* 提交列表 */}
      <div className="tech-card overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center gap-2 border-b border-indigo-50 px-5 py-3">
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              strokeWidth={1.5}
            />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索提交信息 / hash（当前页）"
              className="w-[220px] rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {filters.map((f) => (
              <FilterChip
                key={f.key}
                active={statusFilter === f.key}
                onClick={() => {
                  setStatusFilter(f.key);
                  setPage(1);
                  setKeyword('');
                }}
              >
                {f.label} {f.key === 'all' ? repo.commit_total : f.count}
              </FilterChip>
            ))}
          </div>
          <div className="ml-auto text-[12px] text-slate-400">
            第 {total === 0 ? 0 : (page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)} 条 /{' '}
            共 {total} 条
          </div>
        </div>
        <CommitList
          rows={rows.map(toRowVM)}
          loading={isLoading}
          onHashClick={(id) => navigate(`/commits/${id}`)}
        />
        {(total > 0 || page > 1) && (
          <Pager
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={pageSize}
            onChange={setPage}
          />
        )}
      </div>
    </div>
  );
}

/* ============================================================
 * 通用：提交列表 + 解析结果面板 + 人工复核
 * ============================================================ */
function CommitList({
  rows,
  loading,
  onHashClick,
}: {
  rows: CommitRowVM[];
  loading: boolean;
  onHashClick?: (id: string) => void;
}) {
  const [reviewing, setReviewing] = useState<CommitRowVM | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center px-5 py-16 text-[13px] text-slate-400">
        加载中…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center px-5 py-16 text-[13px] text-slate-400">
        暂无提交
      </div>
    );
  }

  return (
    <>
      <div className="divide-y divide-indigo-50/50">
        {rows.map((c) => (
          <CommitRow
            key={c.id + c.commit_hash}
            row={c}
            onReview={() => setReviewing(c)}
            onHashClick={onHashClick}
          />
        ))}
      </div>
      <ReviewModal
        commit={reviewing}
        onClose={() => setReviewing(null)}
      />
    </>
  );
}

function CommitRow({
  row,
  onReview,
  onHashClick,
}: {
  row: CommitRowVM;
  onReview: () => void;
  onHashClick?: (id: string) => void;
}) {
  const meta = reviewMeta[row.review_status] ?? reviewMeta.unreviewed;
  const { Icon } = meta;
  const parsed = row.parsed_result;
  const hasStructured = !!parsed && (parsed.updates?.length ?? 0) > 0;
  const reasonLine =
    row.review_reason || (parsed?.errors?.length ? parsed.errors.join(' · ') : '');

  return (
    <div className="px-5 py-4 transition-colors hover:bg-indigo-50/20">
      <div className="flex items-start gap-3">
        <span
          className={`mt-1 inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${meta.badge}`}
        >
          <Icon className="h-3 w-3" strokeWidth={1.5} />
          {meta.label}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onHashClick?.(row.id)}
              disabled={!onHashClick}
              className="font-mono text-[11px] text-slate-400 transition-colors hover:text-indigo-600 disabled:hover:text-slate-400"
            >
              {row.commit_hash.slice(0, 7)}
            </button>
            <span className="text-[13px] font-medium text-slate-900">{row.author}</span>
            <span className="text-[11px] text-slate-400">
              {dayjs(row.committed_at).format('MM-DD HH:mm')}
            </span>
          </div>

          {hasStructured ? (
            <ParsedPanel parsed={parsed!} status={row.review_status} />
          ) : (
            <div
              className={`mt-2 rounded-md border p-3 ${
                row.review_status === 'illegal'
                  ? 'border-rose-100 bg-rose-50/30'
                  : 'border-slate-100 bg-slate-50/50'
              }`}
            >
              <pre className="whitespace-pre-wrap font-mono text-[11px] text-slate-600">
                {row.message}
              </pre>
            </div>
          )}

          {reasonLine && (
            <div
              className={`mt-2 flex items-center gap-1.5 text-[11px] ${
                row.review_status === 'illegal'
                  ? 'text-rose-600'
                  : row.review_status === 'warning'
                    ? 'text-amber-600'
                    : 'text-slate-500'
              }`}
            >
              <AlertOctagon className="h-3 w-3" strokeWidth={1.5} />
              <span>{reasonLine}</span>
            </div>
          )}
        </div>
        <button
          onClick={onReview}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-indigo-100 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
        >
          <Pencil className="h-3 w-3" strokeWidth={1.5} />
          人工复核
        </button>
      </div>
    </div>
  );
}

/** 解析结果结构化面板 */
function ParsedPanel({ parsed, status }: { parsed: ParsedCommit; status: ReviewStatus }) {
  const tone =
    status === 'illegal'
      ? 'border-rose-100 bg-rose-50/30'
      : status === 'warning'
        ? 'border-amber-100 bg-amber-50/20'
        : 'border-emerald-100 bg-emerald-50/20';
  const labelTone =
    status === 'illegal' ? 'text-rose-600' : status === 'warning' ? 'text-amber-600' : 'text-emerald-600';
  return (
    <div className={`mt-2 rounded-md border p-3 ${tone}`}>
      <div className={`mb-1 text-[10px] font-medium ${labelTone}`}>解析结果</div>
      <div className="space-y-1 text-[11px]">
        {parsed.change_type && (
          <div className="flex gap-2">
            <span className="w-16 text-slate-400">变更类型</span>
            <span className="text-slate-700">{parsed.change_type}</span>
          </div>
        )}
        {parsed.updates && parsed.updates.length > 0 && (
          <div className="flex gap-2">
            <span className="w-16 text-slate-400">更新内容</span>
            <span className="text-slate-700">
              {parsed.updates.map((u, i) => (
                <span key={i}>
                  {i + 1}.{' '}
                  {u.type && (
                    <span className={`font-mono ${updateTypeColor(u.type)}`}>{u.type}</span>
                  )}{' '}
                  {u.content}
                  {i < parsed.updates!.length - 1 ? ' ' : ''}
                </span>
              ))}
            </span>
          </div>
        )}
        {parsed.config_changes && Object.keys(parsed.config_changes).length > 0 && (
          <div className="flex gap-2">
            <span className="w-16 text-slate-400">配置项</span>
            <span className="font-mono text-slate-700">
              {Object.entries(parsed.config_changes).flatMap(([section, kvs]) =>
                Object.entries(kvs || {}).map(([k, v]) => `[${section}] ${k}=${v}`),
              ).join('  ')}
            </span>
          </div>
        )}
        {parsed.related_changes && Object.keys(parsed.related_changes).length > 0 && (
          <div className="flex gap-2">
            <span className="w-16 text-slate-400">关联改动</span>
            <span className="font-mono text-slate-700">
              {Object.entries(parsed.related_changes)
                .map(([k, v]) => `${k}: ${v}`)
                .join('  ')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** 人工复核弹窗：commit 变化时通过 key 重挂载，初始状态由 useState 初始化器读取 */
function ReviewModal({
  commit,
  onClose,
}: {
  commit: CommitRowVM | null;
  onClose: () => void;
}) {
  if (!commit) return null;
  return <ReviewModalInner key={commit.id} commit={commit} onClose={onClose} />;
}

function ReviewModalInner({
  commit,
  onClose,
}: {
  commit: CommitRowVM;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { message } = useAppMessage();
  const [status, setStatus] = useState<ReviewStatus>(
    commit.review_status === 'unreviewed' ? 'pass' : commit.review_status,
  );
  const [reason, setReason] = useState(commit.review_reason || '');

  const mut = useMutation({
    mutationFn: () => commitApi.reviewCommit(commit.id, { review_status: status, reason }),
    onSuccess: () => {
      message.success('已提交人工复核');
      queryClient.invalidateQueries({ queryKey: ['release', 'commits'] });
      queryClient.invalidateQueries({ queryKey: ['repository', 'commits'] });
      queryClient.invalidateQueries({ queryKey: ['repositories', 'compliance-stats'] });
      queryClient.invalidateQueries({ queryKey: ['releases', 'review'] });
      onClose();
    },
    onError: (err: unknown) => {
      message.error((err as { message?: string })?.message || '复核失败，可能无权操作');
    },
  });

  const options: { key: ReviewStatus; label: string; cls: string }[] = [
    { key: 'pass', label: '通过', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
    { key: 'warning', label: '警告', cls: 'border-amber-200 bg-amber-50 text-amber-600' },
    { key: 'illegal', label: '非法', cls: 'border-rose-200 bg-rose-50 text-rose-600' },
  ];

  return (
    <TsModal
      title="人工复核"
      open
      onCancel={onClose}
      onOk={() => mut.mutate()}
      confirmLoading={mut.isPending}
      width={480}
    >
      <div className="space-y-4">
        <div className="rounded-md border border-slate-100 bg-slate-50/60 p-3">
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span className="font-mono">{commit.commit_hash.slice(0, 7)}</span>
            <span className="text-slate-500">{commit.author}</span>
            <span>{dayjs(commit.committed_at).format('MM-DD HH:mm')}</span>
          </div>
          <pre className="mt-1.5 whitespace-pre-wrap font-mono text-[11px] text-slate-600">
            {commit.message}
          </pre>
        </div>
        <div>
          <div className="mb-2 text-[12px] font-medium text-slate-600">审查结果</div>
          <div className="flex items-center gap-2">
            {options.map((o) => (
              <button
                key={o.key}
                onClick={() => setStatus(o.key)}
                className={[
                  'inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-[12px] font-medium transition-all',
                  status === o.key
                    ? `${o.cls} ring-2 ring-offset-0 ring-current/20`
                    : 'border-slate-200 bg-white text-slate-500 hover:border-indigo-200 hover:text-indigo-600',
                ].join(' ')}
              >
                {reviewMeta[o.key].label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-[12px] font-medium text-slate-600">复核说明（可选）</div>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="填写复核意见…"
            className="w-full resize-none rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[13px] text-slate-700 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
      </div>
    </TsModal>
  );
}

/* ============================================================
 * 小工具组件
 * ============================================================ */
function Stat({
  icon: Icon,
  iconCls,
  value,
  label,
}: {
  icon: typeof Check;
  iconCls: string;
  value: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconCls}`}>
        <Icon className="h-4 w-4" strokeWidth={1.5} />
      </div>
      <div>
        <div className="font-mono text-[16px] font-semibold text-slate-900">
          {value.toLocaleString()}
        </div>
        <div className="text-[10px] text-slate-400">{label}</div>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium transition-colors',
        active
          ? 'border-indigo-200 bg-indigo-50 text-indigo-600'
          : 'border-indigo-100 bg-white text-slate-500 hover:text-indigo-600',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function VendorSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const opts = [
    { value: 'all', label: '全部供应商' },
    { value: 'gitlab', label: 'GitLab' },
    { value: 'gitea', label: 'Gitea' },
    { value: 'github', label: 'GitHub' },
    { value: 'gitee', label: 'Gitee' },
    { value: 'svn', label: 'SVN' },
  ];
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-indigo-100 bg-white px-3 py-1.5 text-[13px] text-slate-600 outline-none transition-colors hover:border-indigo-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
    >
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Pager({
  page,
  totalPages,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onChange: (p: number) => void;
}) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const pages = useMemo(() => {
    const max = 5;
    const half = Math.floor(max / 2);
    let s = Math.max(1, page - half);
    const e = Math.min(totalPages, s + max - 1);
    s = Math.max(1, e - max + 1);
    const arr: number[] = [];
    for (let i = s; i <= e; i++) arr.push(i);
    return arr;
  }, [page, totalPages]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-indigo-50 px-5 py-3">
      <div className="text-[12px] text-slate-400">
        第 {start}-{end} 条 / 共 {total} 条
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-indigo-100 text-slate-400 transition-colors hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
        {pages.map((p) => (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={[
              'flex h-7 w-7 items-center justify-center rounded-md text-[12px] font-medium transition-colors',
              p === page
                ? 'bg-indigo-500 text-white'
                : 'border border-indigo-100 text-slate-600 hover:bg-indigo-50',
            ].join(' ')}
          >
            {p}
          </button>
        ))}
        <button
          onClick={() => onChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-indigo-100 text-slate-400 transition-colors hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
