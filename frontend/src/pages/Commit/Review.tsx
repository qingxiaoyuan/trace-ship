import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, Select as AntSelect } from 'antd';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  DownloadCloud,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  GitCompare,
  History,
  Info,
  LoaderCircle,
  Pencil,
  RefreshCw,
  ScanSearch,
  Search,
  TriangleAlert,
} from 'lucide-react';
import dayjs from 'dayjs';
import { projectApi } from '@/api/project';
import { releaseApi } from '@/api/release';
import { repositoryApi } from '@/api/repository';
import { systemApi } from '@/api/system';
import { ReleaseCommits } from '../Release/components/ReleaseCommits';
import { ReleaseReview } from '../Release/components/ReleaseReview';
import { buildMdTable, parseMdTable } from '@/utils/markdownTable';
import { highlightKeywords, parseKeywords } from '@/utils/highlight';
import { PermissionAlert } from '@/components/PermissionAlert';
import { useAppMessage } from '@/hooks/useAppMessage';
import { useProjectRole } from '@/hooks/useProjectRole';
import { AutoResizeTextarea, CheckboxField } from '../Release/components/ReleaseDocField';
import { getAvatarColor } from '@/utils/avatar';
import {
  applyCheckboxChange,
  isCheckboxField,
} from '../Release/components/releaseDocUtils';
import type {
  MdTableRow,
} from '@/utils/markdownTable';
import type {
  Project,
  Release,
  ReleaseType,
  Repository,
  ReviewRangeItem,
  ReviewRangeResult,
  ReviewStatus,
  SvnSyncResult,
} from '@/types';

/** 三个审查板块 */
type Sect = 'pending' | 'released' | 'fetch';

/** 发布类型筛选选项 */
type TypeFilter = 'all' | ReleaseType;

const typeFilterLabels: Record<TypeFilter, string> = {
  all: '全部',
  formal: '正式',
  beta: '测试',
  rc: 'RC',
};

/** 整改状态筛选选项（open=待整改，replied=待复核） */
type ReviewFilter = 'all' | 'open' | 'replied';

const reviewFilterLabels: Record<ReviewFilter, string> = {
  all: '全部',
  open: '待整改',
  replied: '待复核',
};

/** 审查状态归一为 正常 / 警告（illegal 归入警告） */
function isWarning(status: ReviewStatus): boolean {
  return status === 'warning' || status === 'illegal';
}

export default function CommitReview() {
  const [sect, setSect] = useState<Sect>('pending');

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">提交审查</h1>
        <p className="mt-1 text-[13px] text-slate-500">
          审查审批中与已发布版本的变更合规性，也可主动拉取任意 Tag 区间的提交进行合规检查
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <SectTab active={sect === 'pending'} onClick={() => setSect('pending')} icon={ClipboardCheck} label="审批中审查" status="pending" />
        <SectTab active={sect === 'released'} onClick={() => setSect('released')} icon={History} label="已发布回溯" status="released" />
        <button
          onClick={() => setSect('fetch')}
          className={[
            'inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[13px] font-medium transition-colors',
            sect === 'fetch'
              ? 'border-indigo-500 bg-indigo-50 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-indigo-600',
          ].join(' ')}
        >
          <RefreshCw className="h-4 w-4" strokeWidth={1.5} />
          主动拉取审查
        </button>
      </div>

      {sect === 'pending' && <ReleaseReviewSection status="pending" />}
      {sect === 'released' && <ReleaseReviewSection status="released" />}
      {sect === 'fetch' && <FetchReviewSection />}
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
  status,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Check;
  label: string;
  status: 'pending' | 'released';
}) {
  const { data } = useQuery({
    queryKey: ['releases', 'count', status],
    queryFn: () => releaseApi.getReleases({ status, page: 1, page_size: 1 }),
  });
  const count = data?.total ?? 0;
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
      <span className={`font-mono text-[11px] ${active ? 'text-indigo-400' : 'text-slate-400'}`}>
        {count}
      </span>
    </button>
  );
}

/* ============================================================
 * 第一/二块：审批中审查 / 已发布回溯
 * ============================================================ */
function ReleaseReviewSection({ status }: { status: 'pending' | 'released' }) {
  const [keyword, setKeyword] = useState('');
  const [projectId, setProjectId] = useState('');
  const [repoId, setRepoId] = useState('');
  // 已发布回溯默认只看正式版，审批中审查保持全部
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(status === 'released' ? 'formal' : 'all');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [selected, setSelected] = useState<Release | null>(null);

  // 项目列表
  const projectsQ = useQuery({
    queryKey: ['projects', 'all'],
    queryFn: () => projectApi.getProjects({ page: 1, page_size: 200 }),
  });

  // 仓库列表（按项目筛选）
  const reposQ = useQuery({
    queryKey: ['repositories', 'filter', projectId],
    queryFn: () =>
      repositoryApi.getRepositories({
        ...(projectId ? { project: projectId } : {}),
        page: 1,
        page_size: 200,
      }),
  });

  // 发布列表
  const releasesQ = useQuery({
    queryKey: ['releases', 'review', status, projectId, repoId, typeFilter, reviewFilter],
    queryFn: () =>
      releaseApi.getReleases({
        status,
        page: 1,
        page_size: 100,
        ...(projectId ? { project: projectId } : {}),
        ...(repoId ? { repository: repoId } : {}),
        ...(typeFilter !== 'all' ? { release_type: typeFilter } : {}),
        ...(reviewFilter !== 'all' ? { review_status: reviewFilter } : {}),
      }),
  });

  const rows = useMemo(() => {
    const all = releasesQ.data?.results ?? [];
    const kw = keyword.trim().toLowerCase();
    if (!kw) return all;
    return all.filter(
      (r) =>
        r.version?.toLowerCase().includes(kw) ||
        r.project_name?.toLowerCase().includes(kw),
    );
  }, [releasesQ.data, keyword]);

  if (selected) {
    return <ReleaseReviewDetail release={selected} status={status} onBack={() => setSelected(null)} />;
  }

  const loading = releasesQ.isLoading;

  return (
    <div className="space-y-5">
      <PermissionAlert error={releasesQ.error} className="rounded-xl" />

      <div className="tech-card overflow-hidden rounded-xl">
        {/* 筛选栏 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-indigo-50 px-5 py-3">
          <div className="relative w-full sm:w-[200px]">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" strokeWidth={1.5} />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索项目 / 版本号"
              className="w-full rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          {/* 项目下拉 */}
          <div className="w-full sm:w-[180px]">
            <Select
              value={projectId}
              onChange={(v) => {
                setProjectId(v);
                setRepoId('');
              }}
              placeholder="全部项目"
              options={(projectsQ.data?.results ?? []).map((p: Project) => ({
                value: p.id,
                label: p.name,
              }))}
            />
          </div>
          {/* 仓库下拉 */}
          <div className="w-full sm:w-[180px]">
            <Select
              value={repoId}
              onChange={(v) => setRepoId(v)}
              placeholder={projectId ? '全部仓库' : '先选项目'}
              disabled={!projectId}
              options={(reposQ.data?.results ?? []).map((r: Repository) => ({
                value: r.id,
                label: r.name,
              }))}
            />
          </div>
          {/* 类型按钮组 */}
          <div className="flex items-center gap-0.5 rounded-lg border border-indigo-100 bg-white p-0.5">
            {(Object.keys(typeFilterLabels) as TypeFilter[]).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={[
                  'rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
                  typeFilter === t
                    ? 'bg-indigo-50 text-indigo-600'
                    : 'text-slate-500 hover:text-indigo-600',
                ].join(' ')}
              >
                {typeFilterLabels[t]}
              </button>
            ))}
          </div>
          {/* 整改状态按钮组（仅已发布回溯） */}
          {status === 'released' && (
            <div className="flex items-center gap-0.5 rounded-lg border border-indigo-100 bg-white p-0.5">
              {(Object.keys(reviewFilterLabels) as ReviewFilter[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setReviewFilter(t)}
                  className={[
                    'rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
                    reviewFilter === t
                      ? 'bg-indigo-50 text-indigo-600'
                      : 'text-slate-500 hover:text-indigo-600',
                  ].join(' ')}
                >
                  {reviewFilterLabels[t]}
                </button>
              ))}
            </div>
          )}
          <div className="ml-auto text-[12px] text-slate-400">
            共 {rows.length} 个{status === 'released' ? '已发布' : '审批中'}
          </div>
        </div>

        {/* 表头 */}
        <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
          <div className="col-span-3">发布单</div>
          <div className="col-span-2">项目</div>
          <div className="col-span-1">类型</div>
          <div className="col-span-1 text-center">提交</div>
          <div className="col-span-1 text-center">审查</div>
          <div className="col-span-2">状态</div>
          <div className="col-span-2 text-right">操作</div>
        </div>

        {/* 列表 */}
        <div className="divide-y divide-indigo-50/50 max-md:divide-y-0 max-md:space-y-3 max-md:p-3">
          {loading ? (
            <div className="flex items-center justify-center px-5 py-16 text-[13px] text-slate-400">加载中…</div>
          ) : rows.length === 0 ? (
            <div className="flex items-center justify-center px-5 py-16 text-[13px] text-slate-400">暂无数据</div>
          ) : (
            rows.map((r) => {
              const warning = (r.warning_count ?? 0) + (r.illegal_count ?? 0);
              const noDoc = r.has_doc !== true;
              const hasWarning = warning > 0 || noDoc;
              // 存在未闭环整改意见（待整改/待复核）时不应再显示「正常」
              const hasReviewIssue = (r.open_review_count ?? 0) + (r.replied_review_count ?? 0) > 0;
              const publisherLabel = r.publisher_name || r.publisher || '-';
              return (
                <div
                  key={r.id}
                  onClick={() => setSelected(r)}
                  className="cursor-pointer transition-colors hover:bg-indigo-50/30 max-md:rounded-xl max-md:border max-md:border-indigo-100/70 max-md:bg-white max-md:p-4"
                >
                  {/* 桌面端网格行 */}
                  <div className="hidden grid-cols-12 items-center gap-3 px-5 py-3.5 md:grid">
                    <div className="col-span-12 flex items-center gap-2 md:col-span-3">
                      <span className={`inline-flex h-2 w-2 rounded-full ${hasWarning || hasReviewIssue ? 'bg-amber-400' : 'bg-emerald-500'}`} />
                      <div>
                        <div className="font-mono text-[13px] font-medium text-slate-900">{r.version}</div>
                        <div className="text-[11px] text-slate-400">{r.repository_name || '-'}</div>
                      </div>
                    </div>
                    <div className="col-span-6 text-[13px] text-slate-700 md:col-span-2">{r.project_name || '-'}</div>
                    <div className="col-span-3 md:col-span-1">
                      <ReleaseTypeBadge type={r.release_type} />
                    </div>
                    <div className="col-span-3 text-center font-mono text-[13px] text-slate-700 md:col-span-1">
                      {r.commit_total ?? 0}
                    </div>
                    <div className="col-span-3 text-center md:col-span-1">
                      <div className="flex flex-col items-center gap-1">
                        {hasWarning ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-600">
                            {noDoc ? '无文档' : `${warning} 警告`}
                          </span>
                        ) : !hasReviewIssue ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">正常</span>
                        ) : null}
                        {(r.open_review_count ?? 0) > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-600">
                            待整改 {r.open_review_count}
                          </span>
                        )}
                        {(r.replied_review_count ?? 0) > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-600">
                            待复核 {r.replied_review_count}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="col-span-6 md:col-span-2">
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                        {r.status_display || r.status}
                      </span>
                    </div>
                    <div className="col-span-6 flex items-center justify-end gap-1.5 md:col-span-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected(r);
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-indigo-100 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                      >
                        <FileText className="h-3 w-3" strokeWidth={1.5} />
                        查看文档
                      </button>
                      <ChevronRight className="h-4 w-4 text-slate-300" strokeWidth={1.5} />
                    </div>
                  </div>

                  {/* 移动端卡片（参考 docs/ui/mobile/mobile-release.html） */}
                  <div className="md:hidden">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        {hasWarning ? (
                          <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-600">
                            {noDoc ? '无文档' : `${warning} 警告`}
                          </span>
                        ) : !hasReviewIssue ? (
                          <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-600">正常</span>
                        ) : null}
                        {(r.open_review_count ?? 0) > 0 && (
                          <span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-600">
                            待整改 {r.open_review_count}
                          </span>
                        )}
                        {(r.replied_review_count ?? 0) > 0 && (
                          <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-600">
                            待复核 {r.replied_review_count}
                          </span>
                        )}
                      </div>
                      <ReleaseTypeBadge type={r.release_type} soft />
                    </div>
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="font-mono text-[16px] font-semibold tracking-tight text-slate-900">
                        {r.version}
                      </span>
                      <span className="min-w-0 truncate text-[12px] text-slate-400">{r.project_name || '-'}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                      <GitBranch className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                      <span className="min-w-0 truncate font-mono">{r.branch || '-'}</span>
                      <span className="shrink-0 text-slate-200">|</span>
                      <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                      <span className="shrink-0">{r.commit_total ?? 0} 个提交</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-indigo-50 pt-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold text-white"
                          style={{ background: getAvatarColor(publisherLabel) }}
                        >
                          {publisherLabel.charAt(0)}
                        </span>
                        <span className="truncate text-[12px] text-slate-500">
                          {publisherLabel} · {dayjs(r.created_at).format('MM-DD')}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelected(r);
                          }}
                          className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-indigo-100 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                        >
                          <FileText className="h-3 w-3" strokeWidth={1.5} />
                          查看文档
                        </button>
                        <ChevronRight className="h-4 w-4 text-slate-300" strokeWidth={1.5} />
                      </div>
                    </div>
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

/* ============================================================
 * 发布审查详情（第一/二块共用）：发布说明两列表格
 * ============================================================ */
function ReleaseReviewDetail({
  release,
  status,
  onBack,
}: {
  release: Release;
  status: 'pending' | 'released';
  onBack: () => void;
}) {
  const [tab, setTab] = useState<'doc' | 'commits' | 'review'>('doc');
  // 拉取完整 release 详情（含 release_doc / base_tag / 整改聚合）
  const { data: detail, isLoading } = useQuery({
    queryKey: ['release', 'detail', release.id],
    queryFn: () => releaseApi.getRelease(release.id),
  });

  // ---- 变更文档编辑（复用发布详情页的编辑模式）----
  const queryClient = useQueryClient();
  const { message } = useAppMessage();
  const [editOpen, setEditOpen] = useState(false);
  const [svnFailResults, setSvnFailResults] = useState<SvnSyncResult[]>([]);
  const [docRows, setDocRows] = useState<MdTableRow[]>([]);
  const [editContent, setEditContent] = useState('');
  const [docSaved, setDocSaved] = useState(true);
  const [tableEditMode, setTableEditMode] = useState(true);

  // 修改发布说明需 developer 及以上项目角色
  const { data: project } = useQuery({
    queryKey: ['project', release.project_id],
    queryFn: () => projectApi.getProject(release.project_id),
    enabled: !!release.project_id,
  });
  const { canDevelop } = useProjectRole(project);

  // 审查员查看变更文档时高亮关键字（关键字在系统配置维护，纯前端渲染）
  const { data: publicConfigs } = useQuery({
    queryKey: ['system-public-configs'],
    queryFn: () => systemApi.getPublicConfigs(),
    enabled: detail?.can_review === true,
  });
  const highlightKws = detail?.can_review
    ? parseKeywords(publicConfigs?.review_doc_highlight_keywords)
    : [];

  const updateDocMutation = useMutation({
    mutationFn: (doc: string) => releaseApi.updateDoc(release.id, doc),
    onSuccess: (data) => {
      const syncResults = data?.svn_sync_results || [];
      const failed = syncResults.filter((r) => !r.ok);
      if (failed.length > 0) {
        message.success(`文档已保存，但 ${failed.length} 个 SVN 目录同步失败`);
        setSvnFailResults(failed);
      } else if (syncResults.length > 0) {
        message.success('文档已保存，SVN 文档已同步');
      } else {
        message.success('文档已保存');
      }
      queryClient.invalidateQueries({ queryKey: ['release', 'detail', release.id] });
      setDocSaved(true);
      setEditOpen(false);
    },
  });

  const openEdit = () => {
    const md = detail?.release_doc || '';
    const parsed = parseMdTable(md);
    setDocRows(parsed);
    setEditContent(md);
    setTableEditMode(parsed.length > 0);
    setDocSaved(true);
    setEditOpen(true);
  };

  const handleRowChange = (idx: number, value: string) => {
    setDocRows((prev) => prev.map((r, i) => (i === idx ? { ...r, value } : r)));
    setDocSaved(false);
  };

  const handleCheckboxChange = (idx: number, value: string) => {
    setDocRows((prev) => applyCheckboxChange(prev, idx, value));
    setDocSaved(false);
  };

  const handleSaveDoc = () => {
    updateDocMutation.mutate(tableEditMode ? buildMdTable(docRows) : editContent);
  };

  const handleCloseEdit = () => {
    if (!docSaved) {
      const ok = window.confirm('有未保存的修改，确定要放弃吗？');
      if (!ok) return;
    }
    setEditOpen(false);
  };

  const handleCloseSvnFail = () => {
    setSvnFailResults([]);
  };

  const warningCount = (release.warning_count ?? 0) + (release.illegal_count ?? 0);
  const releaseDoc = detail?.release_doc || '';
  const rows = parseMdTable(releaseDoc);
  const hasDoc = rows.length > 0;

  const title = status === 'released' ? '已发布回溯' : '审批中审查';

  const tabBtn = (key: 'doc' | 'commits' | 'review', label: string, icon?: ReactNode) => (
    <button
      key={key}
      type="button"
      onClick={() => setTab(key)}
      className={
        tab === key
          ? 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-t-lg border-b-2 border-indigo-600 px-3 py-2.5 text-[13px] font-medium text-indigo-600'
          : 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-t-lg border-b-2 border-transparent px-3 py-2.5 text-[13px] font-medium text-slate-500 transition-colors hover:text-indigo-600'
      }
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="space-y-5">
      {/* 面包屑 */}
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-slate-400 transition-colors hover:text-indigo-600"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
          {title}
        </button>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" strokeWidth={1.5} />
        <span className="font-mono font-medium text-slate-800">{release.version}</span>
        <span className="text-[12px] text-slate-400">
          {release.project_name || '-'} · {release.release_type_display || release.release_type}
        </span>
        {!isLoading && (warningCount > 0 || !hasDoc) && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[12px] font-medium text-amber-600">
            <TriangleAlert className="h-3.5 w-3.5" strokeWidth={1.5} />
            {!hasDoc ? '无发布说明' : `${warningCount} 项警告`}
          </span>
        )}
      </div>

      {/* 主体：变更文档 / 版本提交 / 审查整改 三 Tab 切换 */}
      <div className="tech-card overflow-hidden rounded-xl">
        <div className="flex items-center gap-1 overflow-x-auto border-b border-indigo-50 px-4">
          {tabBtn('doc', '变更文档', <FileText className="h-3.5 w-3.5" strokeWidth={1.5} />)}
          {tabBtn('commits', '版本提交', <GitCommitHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />)}
          {status === 'released' && tabBtn('review', '审查整改', <ClipboardCheck className="h-3.5 w-3.5" strokeWidth={1.5} />)}
        </div>

        <div className="p-5">
          {tab === 'doc' &&
            (isLoading ? (
              <div className="flex items-center justify-center py-16 text-[13px] text-slate-400">
                加载中…
              </div>
            ) : !hasDoc ? (
              <div className="flex flex-col items-center justify-center py-16">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-amber-200 bg-amber-50">
                  <TriangleAlert className="h-6 w-6 text-amber-500" strokeWidth={1.5} />
                </div>
                <p className="mt-4 text-[14px] font-medium text-slate-700">该发布单尚未生成发布说明文档</p>
                <p className="mt-1 text-[12px] text-slate-400">
                  {canDevelop ? '可点击下方「修改文档」手动填写发布说明' : '仅项目开发或管理员可修改'}
                </p>
                {canDevelop && (
                  <button
                    type="button"
                    onClick={openEdit}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                    修改文档
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-slate-200">
                {/* 标题栏：标题 + 版本信息 + 修改文档按钮 */}
                <div className="flex items-center gap-2 border-b border-indigo-50 bg-slate-50/40 px-4 py-2.5">
                  <FileText className="h-4 w-4 shrink-0 text-indigo-500" strokeWidth={1.5} />
                  <span className="text-[13px] font-semibold text-slate-800">变更文档</span>
                  <span className="text-[12px] text-slate-400">发布说明</span>
                  {highlightKws.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-600">
                      已高亮 {highlightKws.length} 个审查关键字
                    </span>
                  )}
                  {canDevelop && (
                    <button
                      type="button"
                      onClick={openEdit}
                      className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                    >
                      <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                      修改文档
                    </button>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <tbody>
                      {rows.map((row, idx) => (
                        <DocRow key={idx} row={row} hasWarning={warningCount > 0} keywords={highlightKws} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

          {tab === 'commits' && <ReleaseCommits release={detail || release} />}

          {tab === 'review' && status === 'released' && detail && (
            <ReleaseReview release={detail} />
          )}
        </div>
      </div>

      {/* 修改发布说明弹窗 */}
      <Modal
        title="修改发布说明"
        open={editOpen}
        onCancel={handleCloseEdit}
        onOk={handleSaveDoc}
        confirmLoading={updateDocMutation.isPending}
        width={720}
        destroyOnHidden
      >
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={() => setTableEditMode((m) => !m)}
            className="inline-flex items-center gap-1 rounded-md border border-indigo-100 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500 hover:bg-indigo-50 hover:text-indigo-600"
          >
            {tableEditMode ? '切换为 Markdown 编辑' : '切换为表格编辑'}
          </button>
        </div>
        {tableEditMode ? (
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full border-collapse">
              <tbody>
                {docRows.map((row, idx) => (
                  <tr key={idx} className="border-b border-slate-100 last:border-0">
                    <td className="w-[160px] shrink-0 bg-slate-50/60 px-4 py-2 align-middle text-[12px] font-medium leading-[1.375] text-slate-500">
                      {row.key}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      {isCheckboxField(row.key) ? (
                        <CheckboxField
                          value={row.value}
                          fieldKey={row.key}
                          onChange={(value) => handleCheckboxChange(idx, value)}
                        />
                      ) : (
                        <AutoResizeTextarea
                          value={row.value}
                          onChange={(value) => handleRowChange(idx, value)}
                          className="block w-full resize-none bg-transparent border-0 p-0 text-[13px] leading-[1.375] text-slate-700 outline-none focus:bg-white"
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <textarea
            value={editContent}
            onChange={(e) => {
              setEditContent(e.target.value);
              setDocSaved(false);
            }}
            rows={16}
            placeholder="请输入 Markdown 格式的发布说明"
            className="input-field w-full resize-none rounded-lg border border-slate-200 bg-white p-3 font-mono text-[13px] leading-5 text-slate-700 outline-none"
          />
        )}
        {tableEditMode && (
          <p className="mt-2 text-[11px] text-slate-400">
            左列标题只读，右列内容可编辑；保存后将序列化为 Markdown 表格
          </p>
        )}
      </Modal>

      {/* SVN 文档同步失败提示 */}
      <Modal
        title="SVN 文档同步失败"
        open={svnFailResults.length > 0}
        onCancel={handleCloseSvnFail}
        onOk={handleCloseSvnFail}
        okText="知道了"
        cancelButtonProps={{ style: { display: 'none' } }}
      >
        <p className="mb-3 text-[13px] text-slate-600">
          发布文档已保存成功，但以下 SVN 目录的文档替换失败，请检查 SVN 凭证与连通性后手动处理：
        </p>
        <div className="space-y-2">
          {svnFailResults.map((r) => (
            <div
              key={`${r.task_name}-${r.remote_url}`}
              className="rounded-lg border border-rose-100 bg-rose-50/50 px-3 py-2 text-[12px] text-rose-600"
            >
              <div className="font-medium">{r.task_name}</div>
              <div className="mt-0.5 break-all font-mono text-[11px] text-slate-500">{r.remote_url}</div>
              <div className="mt-0.5">{r.error || '未知错误'}</div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}

/** 发布说明表格行 */
function DocRow({
  row,
  hasWarning,
  keywords = [],
}: {
  row: MdTableRow;
  hasWarning: boolean;
  /** 审查员关键字高亮列表（非审查员传空数组，不高亮） */
  keywords?: string[];
}) {
  const isChangeContent = row.key === '变更内容';
  // 变更内容按 <br> 或字面换行分行（文档存储用 \n 多行），每行尝试提取类型标记
  const lines = row.value.split(/<br>|\n/);

  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="w-[160px] shrink-0 bg-slate-50/60 px-4 py-2.5 align-top text-[12px] font-medium text-slate-500">
        {isChangeContent && hasWarning ? (
          <span className="inline-flex items-center gap-1">
            {row.key}
            <TriangleAlert className="h-3 w-3 text-amber-500" strokeWidth={1.5} />
          </span>
        ) : (
          row.key
        )}
      </td>
      <td className="px-4 py-2.5 text-[13px] text-slate-800">
        {isChangeContent ? (
          <div className="space-y-1">
            {lines.map((line, i) => {
              const m = line.trim().match(/^([AF])\s+(.*)/);
              if (m) {
                const type = m[1];
                const content = m[2];
                const typeCls =
                  type === 'A'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : type === 'F'
                      ? 'border-amber-200 bg-amber-50 text-amber-700'
                      : 'border-slate-200 bg-slate-50 text-slate-600';
                return (
                  <div key={i} className="flex items-start gap-1.5">
                    <span className={`font-mono text-[11px] rounded border px-1 py-0.5 shrink-0 ${typeCls}`}>
                      {type}
                    </span>
                    <span>{highlightKeywords(content, keywords)}</span>
                  </div>
                );
              }
              return <div key={i}>{highlightKeywords(line, keywords)}</div>;
            })}
          </div>
        ) : (
          row.value.split(/<br>|\n/).map((line, i) => (
            <div key={i}>{highlightKeywords(line, keywords)}</div>
          ))
        )}
      </td>
    </tr>
  );
}

/* ============================================================
 * 第三块：主动拉取审查
 * ============================================================ */
function FetchReviewSection() {
  const [projectId, setProjectId] = useState('');
  const [repoId, setRepoId] = useState('');
  const [baseTag, setBaseTag] = useState('');
  const [headTag, setHeadTag] = useState('');
  const [fetching, setFetching] = useState(false);
  const [result, setResult] = useState<ReviewRangeResult | null>(null);

  // 项目列表
  const projectsQ = useQuery({
    queryKey: ['projects', 'all'],
    queryFn: () => projectApi.getProjects({ page: 1, page_size: 200 }),
  });

  // 仓库列表（按项目筛选）
  const reposQ = useQuery({
    queryKey: ['repositories', 'filter', projectId],
    queryFn: () =>
      repositoryApi.getRepositories({
        ...(projectId ? { project: projectId } : {}),
        page: 1,
        page_size: 200,
      }),
    enabled: !!projectId,
  });

  // 仓库 Tag 列表
  const tagsQ = useQuery({
    queryKey: ['repository', 'tags', repoId],
    queryFn: () => repositoryApi.getTags(repoId),
    enabled: !!repoId,
  });

  const selectedRepo = reposQ.data?.results?.find((r) => r.id === repoId);
  const tagOptions = tagsQ.data ?? [];

  const handleFetch = async () => {
    if (!repoId) return;
    setFetching(true);
    try {
      const data = await repositoryApi.reviewRange(
        repoId,
        baseTag || undefined,
        headTag || undefined,
      );
      setResult(data);
    } catch {
      setResult(null);
    } finally {
      setFetching(false);
    }
  };

  const handleReset = () => {
    setProjectId('');
    setRepoId('');
    setBaseTag('');
    setHeadTag('');
    setResult(null);
  };

  return (
    <div className="space-y-5">
      {/* 选择器卡片 */}
      <div className="tech-card rounded-xl p-5">
        <div className="mb-4 flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-indigo-500" strokeWidth={1.5} />
          <h3 className="text-[14px] font-semibold text-slate-900">选择审查范围</h3>
          <span className="ml-auto text-[11px] text-slate-400">
            拉取区间内的 commits 与 MR 进行合规审查，结果仅临时展示不落库
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* 项目 */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-slate-500">
              项目
            </label>
            <Select
              value={projectId}
              onChange={(v) => {
                setProjectId(v);
                setRepoId('');
                setBaseTag('');
                setHeadTag('');
                setResult(null);
              }}
              placeholder="请选择项目"
              options={(projectsQ.data?.results ?? []).map((p: Project) => ({
                value: p.id,
                label: p.name,
              }))}
            />
          </div>
          {/* 仓库 */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-slate-500">
              仓库
            </label>
            <Select
              value={repoId}
              onChange={(v) => {
                setRepoId(v);
                setBaseTag('');
                setHeadTag('');
                setResult(null);
              }}
              placeholder={projectId ? '请选择仓库' : '先选项目'}
              disabled={!projectId}
              options={(reposQ.data?.results ?? []).map((r: Repository) => ({
                value: r.id,
                label: r.name,
              }))}
            />
          </div>
          {/* 起始 Tag */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-slate-500">
              起始 Tag
            </label>
            <Select
              value={baseTag}
              onChange={(v) => {
                setBaseTag(v);
                setResult(null);
              }}
              placeholder={repoId ? '最新 Tag（自动）' : '先选仓库'}
              disabled={!repoId}
              options={[
                { value: '', label: '最新 Tag（自动）' },
                ...tagOptions.map((t) => ({ value: t.name, label: t.name })),
              ]}
            />
          </div>
          {/* 结束 Tag */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-slate-500">
              结束 Tag
            </label>
            <Select
              value={headTag}
              onChange={(v) => {
                setHeadTag(v);
                setResult(null);
              }}
              placeholder={repoId ? '分支 HEAD（最新提交）' : '先选仓库'}
              disabled={!repoId}
              options={[
                { value: '', label: '分支 HEAD（最新提交）' },
                ...tagOptions.map((t) => ({ value: t.name, label: t.name })),
              ]}
            />
          </div>
        </div>

        {/* 拉取按钮 */}
        <div className="mt-4 flex items-center gap-3 border-t border-indigo-50 pt-4">
          <button
            onClick={handleFetch}
            disabled={!repoId || fetching}
            className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <DownloadCloud className="h-3.5 w-3.5" strokeWidth={1.5} />
            拉取并审查
          </button>
          <button
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[13px] font-medium text-slate-600 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
            重置
          </button>
          {selectedRepo && (
            <div className="ml-auto text-[11px] text-slate-400">
              区间：
              <span className="font-mono text-slate-500">
                {baseTag || '最新 Tag'} -&gt; {headTag || 'HEAD'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 结果区 */}
      {fetching ? (
        <div className="tech-card flex flex-col items-center justify-center rounded-xl py-12">
          <LoaderCircle className="h-8 w-8 animate-spin text-indigo-500" strokeWidth={1.5} />
          <p className="mt-4 text-[14px] font-medium text-slate-700">正在拉取并审查…</p>
          <p className="mt-1 text-[12px] text-slate-400">从仓库拉取 commits 与 MR，逐条校验变更类型与更新内容</p>
        </div>
      ) : result ? (
        <FetchReviewResult result={result} />
      ) : (
        <div className="tech-card flex flex-col items-center justify-center rounded-xl py-12">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-indigo-200 bg-indigo-50">
            <ScanSearch className="h-7 w-7 text-indigo-500" strokeWidth={1.5} />
          </div>
          <h3 className="mt-4 text-[15px] font-semibold text-slate-800">选择审查范围后拉取</h3>
          <p className="mt-1 text-[13px] text-slate-500">
            依次选择 项目 -&gt; 仓库 -&gt; 起始/结束 Tag，系统将拉取该区间内的所有提交与合并请求进行合规审查
          </p>
        </div>
      )}
    </div>
  );
}

/** 第三块结果展示 */
function FetchReviewResult({ result }: { result: ReviewRangeResult }) {
  const warningCount = result.stats.warning;
  const passCount = result.stats.pass;

  return (
    <div className="space-y-5">
      {/* 结果头 */}
      <div className="tech-card rounded-xl p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50">
              <GitCompare className="h-5 w-5 text-indigo-500" strokeWidth={1.5} />
            </div>
            <div>
              <h2 className="text-[18px] font-semibold tracking-tight text-slate-900">
                {result.base} → {result.head}
              </h2>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
                <span>{result.stats.total} commits</span>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span>{result.stats.mr_total} MRs</span>
              </div>
            </div>
          </div>
          {warningCount > 0 && (
            <span className="inline-flex items-center gap-1.5 self-start rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[12px] font-medium text-amber-600">
              <TriangleAlert className="h-3.5 w-3.5" strokeWidth={1.5} />
              {warningCount} 项警告
            </span>
          )}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3 border-t border-indigo-50 pt-4">
          <StatBlock icon={CheckCircle2} iconCls="border-emerald-200 bg-emerald-50 text-emerald-600" value={passCount} label="正常" />
          <StatBlock icon={TriangleAlert} iconCls="border-amber-200 bg-amber-50 text-amber-600" value={warningCount} label="警告" />
          <StatBlock icon={GitBranch} iconCls="border-cyan-200 bg-cyan-50 text-cyan-600" value={result.stats.mr_total} label="合并请求" />
        </div>
      </div>

      {/* Commits 审查 */}
      {result.commits.length > 0 && (
        <div className="tech-card overflow-hidden rounded-xl">
          <div className="flex items-center gap-2 border-b border-indigo-50 px-5 py-3">
            <FileText className="h-4 w-4 text-indigo-500" strokeWidth={1.5} />
            <h3 className="text-[14px] font-semibold text-slate-900">提交审查（{result.stats.total}）</h3>
          </div>
          <div className="divide-y divide-indigo-50/50">
            {result.commits.map((c) => (
              <FetchReviewRow key={c.hash} item={c} type="commit" />
            ))}
          </div>
        </div>
      )}

      {/* MR 审查 */}
      {result.merge_requests.length > 0 && (
        <div className="tech-card overflow-hidden rounded-xl">
          <div className="flex items-center gap-2 border-b border-indigo-50 px-5 py-3">
            <GitBranch className="h-4 w-4 text-cyan-500" strokeWidth={1.5} />
            <h3 className="text-[14px] font-semibold text-slate-900">合并请求审查（{result.stats.mr_total}）</h3>
            <span className="ml-auto text-[11px] text-slate-400">基于 MR 描述解析变更内容</span>
          </div>
          <div className="divide-y divide-indigo-50/50">
            {result.merge_requests.map((m) => (
              <FetchReviewRow key={m.number} item={m} type="mr" />
            ))}
          </div>
        </div>
      )}

      {/* 底部提示 */}
      <div className="flex items-start gap-2 rounded-lg border border-indigo-100 bg-indigo-50/30 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" strokeWidth={1.5} />
        <div className="text-[12px] leading-relaxed text-slate-600">
          本次审查结果为临时展示，不会写入数据库。如需持久化，可前往对应仓库详情页执行「同步提交」。
        </div>
      </div>
    </div>
  );
}

/** 第三块审查结果行 */
function FetchReviewRow({ item, type }: { item: ReviewRangeItem; type: 'commit' | 'mr' }) {
  const warning = isWarning(item.review_status);
  const time = item.committed_at || item.merged_at;
  const hashOrNum = type === 'commit' ? item.hash?.slice(0, 7) : `!${item.number}`;

  return (
    <div className={`px-5 py-4 transition-colors ${warning ? 'bg-amber-50/20 hover:bg-amber-50/30' : 'hover:bg-indigo-50/20'}`}>
      <div className="flex items-start gap-3">
        <span
          className={[
            'mt-1 inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium max-md:text-xs',
            warning
              ? 'border-amber-200 bg-amber-50 text-amber-600'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700',
          ].join(' ')}
        >
          {warning ? <TriangleAlert className="h-3 w-3" strokeWidth={1.5} /> : <CheckCircle2 className="h-3 w-3" strokeWidth={1.5} />}
          {warning ? '警告' : '正常'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-slate-400">{hashOrNum}</span>
            {type === 'mr' && item.title && (
              <span className="text-[13px] font-medium text-slate-900">{item.title}</span>
            )}
            <span className="text-[13px] font-medium text-slate-900">{item.author}</span>
            {time && <span className="text-[11px] text-slate-400">{dayjs(time).format('MM-DD HH:mm')}</span>}
          </div>
          {/* 原始信息 */}
          <div
            className={[
              'mt-2 rounded-md border p-3',
              warning ? 'border-amber-100 bg-amber-50/30' : 'border-slate-100 bg-slate-50/50',
            ].join(' ')}
          >
            <pre className="whitespace-pre-wrap font-mono text-[11px] text-slate-600">
              {type === 'mr' ? item.description || item.title : item.message}
            </pre>
          </div>
          {/* 警告原因 */}
          {warning && item.review_reason && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-600">
              <TriangleAlert className="h-3 w-3" strokeWidth={1.5} />
              <span>{item.review_reason}</span>
            </div>
          )}
          {/* 解析结果 */}
          {item.parsed_result?.updates && item.parsed_result.updates.length > 0 && (
            <div className="mt-2 rounded-md border border-slate-100 bg-white p-3">
              <div className="space-y-1 text-[11px]">
                {item.parsed_result.change_type && (
                  <div className="flex gap-2">
                    <span className="w-16 text-slate-400">变更类型</span>
                    <span className="text-slate-700">{item.parsed_result.change_type}</span>
                  </div>
                )}
                <div className="flex gap-2">
                  <span className="w-16 text-slate-400">更新内容</span>
                  <span className="text-slate-700">
                    {item.parsed_result.updates.map((u, i) => (
                      <span key={i}>
                        {i + 1}.{' '}
                        {u.type && (
                          <span
                            className={`font-mono ${u.type === 'A' || u.type === 'F' ? 'text-indigo-500' : 'text-rose-500'}`}
                          >
                            {u.type}
                          </span>
                        )}{' '}
                        {u.content}
                        {i < item.parsed_result!.updates!.length - 1 ? ' ' : ''}
                      </span>
                    ))}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * 小工具组件
 * ============================================================ */

/** 通用下拉选择（基于 antd Select） */
function Select({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <AntSelect
      value={value || undefined}
      onChange={(v: string) => onChange(v ?? '')}
      options={options}
      placeholder={placeholder}
      disabled={disabled}
      size="middle"
      className={className}
      style={{ width: '100%' }}
      popupMatchSelectWidth={true}
      allowClear
      onClear={() => onChange('')}
    />
  );
}

/** 发布类型徽标（soft 用于移动端软底色，去掉边框） */
function ReleaseTypeBadge({ type, soft }: { type: ReleaseType; soft?: boolean }) {
  const map: Record<ReleaseType, string> = {
    formal: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    beta: 'border-amber-200 bg-amber-50 text-amber-700',
    rc: 'border-blue-200 bg-blue-50 text-blue-700',
  };
  const labels: Record<ReleaseType, string> = { formal: '正式', beta: '测试', rc: 'RC' };
  return (
    <span className={`inline-flex items-center rounded-md ${soft ? '' : 'border'} px-1.5 py-0.5 text-[11px] font-medium ${map[type]}`}>
      {labels[type]}
    </span>
  );
}

/** 统计小块 */
function StatBlock({
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
      <div className={`flex h-8 w-8 items-center justify-center rounded-lg border ${iconCls}`}>
        <Icon className="h-4 w-4" strokeWidth={1.5} />
      </div>
      <div>
        <div className="font-mono text-[16px] font-semibold text-slate-900">{value}</div>
        <div className="text-[10px] text-slate-400">{label}</div>
      </div>
    </div>
  );
}
