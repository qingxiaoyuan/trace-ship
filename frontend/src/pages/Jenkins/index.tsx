import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Dropdown, Popconfirm } from 'antd';
import dayjs from 'dayjs';
import {
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Hammer,
  ExternalLink,
  Play,
  Pencil,
  Check,
  X,
  Square,
  Loader,
  Hash,
  Info,
  Folder,
} from 'lucide-react';
import { jenkinsApi } from '@/api/jenkins';
import { projectApi } from '@/api/project';
import type { JenkinsJob, BuildRecord, BuildStatus, JenkinsBuildLatest } from '@/types';
import { JenkinsJobModal } from './modals/JenkinsJobModal';

type View = 'list' | 'detail';

const buildStatusMeta: Record<
  BuildStatus,
  { text: string; badgeClass: string; dotClass: string }
> = {
  queue: { text: '排队中', badgeClass: 'border-slate-200 bg-slate-50 text-slate-500', dotClass: 'bg-slate-400' },
  running: { text: '构建中', badgeClass: 'border-cyan-200 bg-cyan-50 text-cyan-700', dotClass: 'bg-cyan-500' },
  success: { text: '成功', badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-700', dotClass: 'bg-emerald-500' },
  failure: { text: '失败', badgeClass: 'border-rose-200 bg-rose-50 text-rose-600', dotClass: 'bg-rose-500' },
  aborted: { text: '中止', badgeClass: 'border-slate-200 bg-slate-50 text-slate-500', dotClass: 'bg-slate-400' },
};

function formatRelative(dateStr?: string | null): string {
  if (!dateStr) return '-';
  const d = dayjs(dateStr);
  if (!d.isValid()) return '-';
  const now = dayjs();
  const diffMin = now.diff(d, 'minute');
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}小时前`;
  if (diffMin < 2880) return '昨天';
  return d.format('MM-DD HH:mm');
}

function formatDuration(ms?: number | null): string {
  if (!ms || ms <= 0) return '-';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m > 0) return `${m}m${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

function getProgress(build: BuildRecord): number | null {
  if (build.status !== 'running') return null;
  const est = build.estimated_duration;
  const dur = build.duration;
  if (!est || est <= 0 || !dur || dur <= 0) return null;
  return Math.min(99, Math.round((dur / est) * 100));
}

function getVersionFromParams(params: unknown): string {
  if (params && typeof params === 'object') {
    const p = params as Record<string, unknown>;
    return (p.VERSION as string) || (p.version as string) || '';
  }
  return '';
}

const iconClassPool = ['icon-indigo', 'icon-violet', 'icon-rose', 'icon-amber', 'icon-cyan', 'icon-emerald'];
function getJobIconClass(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return iconClassPool[Math.abs(hash) % iconClassPool.length];
}

function StatusBadge({ status, pulse }: { status: BuildStatus; pulse?: boolean }) {
  const meta = buildStatusMeta[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${meta.badgeClass}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass} ${pulse ? 'pulse-dot' : ''}`} style={pulse ? { animation: 'pulse-dot 1.8s ease-in-out infinite' } : undefined} />
      {meta.text}
    </span>
  );
}

export default function JenkinsPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const [view, setView] = useState<View>('list');
  const [selectedJob, setSelectedJob] = useState<JenkinsJob | null>(null);

  // 列表筛选
  const [keyword, setKeyword] = useState('');
  const [projectFilter, setProjectFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // 任务弹窗
  const [jobModalOpen, setJobModalOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<JenkinsJob | null>(null);

  // 详情 tab
  const [detailTab, setDetailTab] = useState<'history' | 'params' | 'config'>('history');

  const { data: projectData } = useQuery({
    queryKey: ['projects-all'],
    queryFn: () => projectApi.getProjects({ page_size: 1000 }),
  });

  const { data: jobData, isLoading: jobsLoading } = useQuery({
    queryKey: ['jenkins-jobs', projectFilter, page, pageSize],
    queryFn: () =>
      jenkinsApi.getJobs({
        project: projectFilter || undefined,
        page,
        page_size: pageSize,
      }),
    enabled: view === 'list',
  });

  const jobs = useMemo(() => jobData?.results || [], [jobData]);
  const total = jobData?.total || 0;
  const filteredJobs = useMemo(() => {
    if (!keyword.trim()) return jobs;
    const kw = keyword.toLowerCase();
    return jobs.filter((j) => j.name.toLowerCase().includes(kw) || j.job_name.toLowerCase().includes(kw));
  }, [jobs, keyword]);

  const saveMutation = useMutation({
    mutationFn: (values: Partial<JenkinsJob> & { id?: string }) => {
      if (values.id) return jenkinsApi.updateJob(values.id, values);
      return jenkinsApi.createJob(values);
    },
    onSuccess: () => {
      message.success('保存成功');
      setJobModalOpen(false);
      setEditingJob(null);
      queryClient.invalidateQueries({ queryKey: ['jenkins-jobs'] });
    },
    onError: () => message.error('保存失败'),
  });

  const triggerMutation = useMutation({
    mutationFn: (id: string) => jenkinsApi.triggerJob(id),
    onSuccess: () => {
      message.success('触发构建成功');
      queryClient.invalidateQueries({ queryKey: ['jenkins-jobs'] });
      if (selectedJob) {
        queryClient.invalidateQueries({ queryKey: ['jenkins-builds', selectedJob.id] });
      }
    },
    onError: () => message.error('触发构建失败'),
  });

  const projectOptions = (projectData?.results || []).map((p) => ({ key: p.id, label: p.name }));
  const projectMenuItems = [{ key: '', label: '全部项目' }, ...projectOptions];

  const openDetail = (job: JenkinsJob) => {
    setSelectedJob(job);
    setDetailTab('history');
    setView('detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAddJob = () => {
    setEditingJob(null);
    setJobModalOpen(true);
  };

  const handleEditJob = (job: JenkinsJob) => {
    setEditingJob(job);
    setJobModalOpen(true);
  };

  const handleSaveJob = (values: Partial<JenkinsJob>) => {
    if (editingJob?.id) {
      saveMutation.mutate({ ...values, id: editingJob.id });
    } else {
      saveMutation.mutate(values);
    }
  };

  if (view === 'detail' && selectedJob) {
    return (
      <JobDetail
        job={selectedJob}
        tab={detailTab}
        onTabChange={setDetailTab}
        onBack={() => setView('list')}
        onEdit={() => handleEditJob(selectedJob)}
        onTrigger={() => triggerMutation.mutate(selectedJob.id)}
        triggering={triggerMutation.isPending}
        onOpenLogBuild={(buildId) => navigate(`/jenkins/logs/${buildId}`)}
      />
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="space-y-5 page-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">打包任务</h1>
          <p className="mt-1 text-[13px] text-slate-500">管理构建任务，监控构建状态，查看实时日志</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['jenkins-jobs'] })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[13px] font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
            刷新
          </button>
          <button
            type="button"
            onClick={handleAddJob}
            className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
            添加任务
          </button>
        </div>
      </div>

      <div className="tech-card overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center gap-2 border-b border-indigo-50 px-5 py-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" strokeWidth={1.5} />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索任务名称"
              className="w-[220px] rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <Dropdown
            menu={{
              items: projectMenuItems,
              onClick: ({ key }) => { setProjectFilter(key); setPage(1); },
              selectable: true,
              selectedKeys: [projectFilter || 'all'],
            }}
            trigger={['click']}
            placement="bottomLeft"
          >
            <button
              type="button"
              className={[
                'inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-[13px] transition-colors',
                projectFilter
                  ? 'border-indigo-200 text-indigo-600 bg-indigo-50/40'
                  : 'border-indigo-100 text-slate-600 hover:bg-indigo-50 hover:text-indigo-600',
              ].join(' ')}
            >
              <Folder className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>{projectFilter ? projectData?.results.find((p) => p.id === projectFilter)?.name : '项目'}</span>
              <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
            </button>
          </Dropdown>
          <div className="ml-auto text-[12px] text-slate-400">共 {total} 条</div>
        </div>

        <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
          <div className="col-span-3">任务名称</div>
          <div className="col-span-2">所属项目</div>
          <div className="col-span-2">服务器</div>
          <div className="col-span-2">最近构建</div>
          <div className="col-span-2">状态</div>
          <div className="col-span-1 text-right">操作</div>
        </div>

        <div className="divide-y divide-indigo-50/50 max-h-[calc(100vh-340px)] overflow-y-auto">
          {jobsLoading ? (
            <div className="px-5 py-12 text-center text-[13px] text-slate-400">加载中…</div>
          ) : filteredJobs.length === 0 ? (
            <div className="px-5 py-12 text-center text-[13px] text-slate-400">暂无任务数据</div>
          ) : (
            filteredJobs.map((job) => {
              const latest: JenkinsBuildLatest | null = job.latest_build || null;
              const latestStatus = latest?.status;
              return (
                <div
                  key={job.id}
                  onClick={() => openDetail(job)}
                  className="grid grid-cols-12 cursor-pointer items-center gap-3 px-5 py-3 transition-colors hover:bg-indigo-50/30"
                >
                  <div className="col-span-12 flex items-center gap-2.5 md:col-span-3">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${getJobIconClass(job.name)}`}>
                      <Hammer className="h-4 w-4" strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-slate-900">{job.name}</div>
                      <div className="truncate font-mono text-[10px] text-slate-400">{job.repository_name || job.job_name}</div>
                    </div>
                  </div>
                  <div className="col-span-6 truncate text-[12px] text-slate-600 md:col-span-2">{job.project_name || '-'}</div>
                  <div className="col-span-6 truncate font-mono text-[11px] text-slate-500 md:col-span-2">{job.server_url}</div>
                  <div className="col-span-6 md:col-span-2">
                    {latest && latest.build_number ? (
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[12px] text-slate-700">#{latest.build_number}</span>
                        <span className="text-[11px] text-slate-400">{formatRelative(latest.started_at || latest.created_at)}</span>
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-400">-</span>
                    )}
                  </div>
                  <div className="col-span-6 md:col-span-2">
                    {latestStatus ? (
                      <StatusBadge status={latestStatus} pulse={latestStatus === 'running'} />
                    ) : (
                      <span className="text-[11px] text-slate-400">未构建</span>
                    )}
                  </div>
                  <div className="col-span-6 flex items-center justify-end gap-1 md:col-span-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(job.server_url, '_blank');
                      }}
                      className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                      title="打开 Jenkins"
                    >
                      <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
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
              ‹
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
                    p === page ? 'bg-indigo-500 text-white' : 'border border-indigo-100 text-slate-600 hover:bg-indigo-50',
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
              ›
            </button>
          </div>
        </div>
      </div>

      <JenkinsJobModal
        open={jobModalOpen}
        job={editingJob}
        onCancel={() => { setJobModalOpen(false); setEditingJob(null); }}
        onOk={handleSaveJob}
      />
    </div>
  );
}

/* ============================ 详情页 ============================ */

interface JobDetailProps {
  job: JenkinsJob;
  tab: 'history' | 'params' | 'config';
  onTabChange: (t: 'history' | 'params' | 'config') => void;
  onBack: () => void;
  onEdit: () => void;
  onTrigger: () => void;
  triggering: boolean;
  onOpenLogBuild: (buildId: string) => void;
}

function JobDetail({ job, tab, onTabChange, onBack, onEdit, onTrigger, triggering, onOpenLogBuild }: JobDetailProps) {
  const { data: jobDetail } = useQuery({
    queryKey: ['jenkins-job', job.id],
    queryFn: () => jenkinsApi.getJob(job.id),
    enabled: !!job.id,
  });
  const currentJob = jobDetail || job;

  const { data: buildsData, isLoading: buildsLoading } = useQuery({
    queryKey: ['jenkins-builds', job.id],
    queryFn: () => jenkinsApi.getBuilds({ job: job.id, page_size: 50 }),
  });
  const builds = useMemo<BuildRecord[]>(() => buildsData?.results || [], [buildsData]);

  // 选中的构建（默认最近一条）；未显式选择时回退到第一条
  const [selectedBuildId, setSelectedBuildId] = useState<string | null>(null);
  const effectiveSelectedBuildId =
    selectedBuildId && builds.some((b) => b.id === selectedBuildId)
      ? selectedBuildId
      : builds[0]?.id || null;

  const selectedBuild = builds.find((b) => b.id === effectiveSelectedBuildId) || builds[0] || null;

  const tabs = [
    { key: 'history' as const, label: '构建历史' },
    { key: 'params' as const, label: '参数模板' },
    { key: 'config' as const, label: '任务配置' },
  ];

  const paramsTemplateStr = useMemo(() => {
    try {
      return JSON.stringify(currentJob.params_template || {}, null, 2);
    } catch {
      return '{}';
    }
  }, [currentJob.params_template]);

  const paramsEntries = useMemo(() => {
    try {
      const obj = currentJob.params_template as Record<string, unknown> | undefined;
      if (!obj || typeof obj !== 'object') return [];
      return Object.entries(obj);
    } catch {
      return [];
    }
  }, [currentJob.params_template]);

  const credentialModeText: Record<string, string> = {
    personal: '个人',
    project: '项目',
  };

  return (
    <div className="space-y-5 page-fade-in">
      <div className="flex items-center gap-2 text-[13px]">
        <button type="button" onClick={onBack} className="text-slate-400 transition-colors hover:text-indigo-600">
          打包任务
        </button>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" strokeWidth={1.5} />
        <span className="font-medium text-slate-800">{currentJob.name}</span>
      </div>

      {/* 任务头部卡片 */}
      <div className="tech-card rounded-xl p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${getJobIconClass(currentJob.name)}`}>
              <Hammer className="h-6 w-6" strokeWidth={1.5} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">{currentJob.name}</h1>
                {currentJob.is_active ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    已启用
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                    已停用
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
                <span className="font-mono">{currentJob.server_url}</span>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span>{currentJob.project_name || '-'}</span>
                {currentJob.repository_name ? (
                  <>
                    <span className="h-1 w-1 rounded-full bg-slate-300" />
                    <span>关联 {currentJob.repository_name}</span>
                  </>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[13px] font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
              编辑
            </button>
            <Popconfirm title="确定触发构建？" onConfirm={onTrigger}>
              <button
                type="button"
                disabled={triggering}
                className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white disabled:opacity-60"
              >
                <Play className="h-3.5 w-3.5" strokeWidth={1.5} />
                触发构建
              </button>
            </Popconfirm>
            <button
              type="button"
              onClick={() => window.open(currentJob.server_url, '_blank')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[13px] font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
              Jenkins
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        {/* 左侧：tab 内容 */}
        <div className="tech-card overflow-hidden lg:col-span-3">
          <div className="scrollbar-thin flex items-center gap-1 overflow-x-auto border-b border-indigo-50 px-4">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => onTabChange(t.key)}
                className={[
                  'whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors',
                  tab === t.key
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-indigo-600',
                ].join(' ')}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-5">
            {tab === 'history' ? (
              <BuildHistory
                builds={builds}
                loading={buildsLoading}
                selectedBuildId={selectedBuild?.id || null}
                onSelectBuild={(id) => setSelectedBuildId(id)}
                onOpenLogBuild={onOpenLogBuild}
              />
            ) : null}

            {tab === 'params' ? (
              <div>
                <div className="scrollbar-thin overflow-x-auto rounded-lg border border-indigo-100 bg-slate-50/50 p-3 font-mono text-[12px] leading-relaxed text-slate-600">
                  <pre className="whitespace-pre">{paramsTemplateStr}</pre>
                </div>
                {paramsEntries.length > 0 ? (
                  <div className="mt-4 space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">参数说明</div>
                    {paramsEntries.map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between border-b border-indigo-50 py-2 last:border-0">
                        <span className="font-mono text-[13px] text-indigo-500">{key}</span>
                        <span className="text-[12px] text-slate-500">默认值：{String(value)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {tab === 'config' ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <ConfigRow label="任务名称" value={currentJob.name} mono />
                  <ConfigRow label="Jenkins Job" value={currentJob.job_name} mono />
                  <ConfigRow label="服务器" value={currentJob.server_url} mono />
                  <ConfigRow label="关联仓库" value={currentJob.repository_name || '-'} />
                  <ConfigRow label="凭证模式" value={credentialModeText[currentJob.credential_mode || ''] || currentJob.credential_mode || '-'} />
                  <ConfigRow label="是否启用" value={currentJob.is_active ? '启用' : '停用'} />
                </div>
                <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-4">
                  <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-indigo-700">
                    <Info className="h-3.5 w-3.5" strokeWidth={1.5} />
                    轮询机制
                  </div>
                  <p className="text-[12px] leading-relaxed text-slate-500">
                    触发构建后，Celery 每 10 秒轮询 Jenkins 构建状态。成功则发布进入审批，失败则自动驳回。
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* 右侧：日志面板 */}
        <div className="tech-card flex flex-col overflow-hidden lg:col-span-2">
          <LogPanel build={selectedBuild} onOpenExternal={onOpenLogBuild} />
        </div>
      </div>
    </div>
  );
}

function ConfigRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-indigo-50 py-2 last:border-0">
      <span className="text-[13px] text-slate-500">{label}</span>
      <span className={mono ? 'font-mono text-[13px] text-slate-800' : 'text-[13px] text-slate-800'}>{value}</span>
    </div>
  );
}

/* ============================ 构建历史 ============================ */

interface BuildHistoryProps {
  builds: BuildRecord[];
  loading: boolean;
  selectedBuildId: string | null;
  onSelectBuild: (id: string) => void;
  onOpenLogBuild: (id: string) => void;
}

function BuildHistory({ builds, loading, selectedBuildId, onSelectBuild, onOpenLogBuild }: BuildHistoryProps) {
  if (loading) {
    return <div className="py-12 text-center text-[13px] text-slate-400">加载中…</div>;
  }
  if (builds.length === 0) {
    return <div className="py-12 text-center text-[13px] text-slate-400">暂无构建记录</div>;
  }
  return (
    <div className="divide-y divide-indigo-50/50">
      {builds.map((build) => {
        const meta = buildStatusMeta[build.status];
        const progress = getProgress(build);
        const version = getVersionFromParams(build.params);
        const isSelected = build.id === selectedBuildId;
        return (
          <div
            key={build.id}
            onClick={() => onSelectBuild(build.id)}
            className={[
              'flex cursor-pointer items-center gap-3 px-3 py-3 transition-colors -mx-3 rounded-r',
              isSelected ? 'bg-cyan-50/30 border-l-2 border-cyan-400' : 'hover:bg-indigo-50/30',
            ].join(' ')}
          >
            <div className={[
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
              build.status === 'success' ? 'icon-emerald'
                : build.status === 'failure' ? 'icon-rose'
                : build.status === 'running' ? 'icon-cyan'
                : 'border border-slate-200 bg-slate-100 text-slate-400',
            ].join(' ')}>
              {build.status === 'success' ? <Check className="h-4 w-4" strokeWidth={2} />
                : build.status === 'failure' ? <X className="h-4 w-4" strokeWidth={2} />
                : build.status === 'running' ? <Loader className="h-4 w-4 spin-slow" strokeWidth={2} />
                : build.status === 'aborted' ? <Square className="h-3.5 w-3.5" strokeWidth={2} />
                : <Hash className="h-4 w-4" strokeWidth={2} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[13px] font-medium text-slate-900">#{build.build_number || build.queue_id || '-'}</span>
                <span className="text-[12px] text-slate-500">{build.triggered_by_name || '-'}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
                {version ? <span className="font-mono">{version}</span> : null}
                {version ? <span className="h-1 w-1 rounded-full bg-slate-300" /> : null}
                <span className={build.status === 'failure' ? 'text-rose-500' : ''}>
                  {formatRelative(build.started_at || build.created_at)}
                  {build.status === 'running' && progress != null ? ` · ${progress}%` : ''}
                  {build.status !== 'running' && build.duration ? ` · ${formatDuration(build.duration)}` : ''}
                </span>
              </div>
            </div>
            {build.status === 'running' && progress != null ? (
              <div className="w-20">
                <div className="h-1 w-full rounded-full bg-cyan-100">
                  <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-indigo-400" style={{ width: `${progress}%` }} />
                </div>
              </div>
            ) : (
              <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${meta.badgeClass}`}>{meta.text}</span>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpenLogBuild(build.id); }}
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
              title="查看日志"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ============================ 日志面板（轮询） ============================ */

function LogPanel({ build, onOpenExternal }: { build: BuildRecord | null; onOpenExternal: (id: string) => void }) {
  const [logContent, setLogContent] = useState('');
  const [logLoading, setLogLoading] = useState(false);
  const logBoxRef = useRef<HTMLDivElement>(null);
  const buildId = build?.id;

  const isRunning = build?.status === 'running' || build?.status === 'queue';

  // 轮询时复用的日志拉取函数
  const fetchLog = async () => {
    if (!buildId) return;
    setLogLoading(true);
    try {
      const res = await jenkinsApi.getBuildLog(buildId);
      setLogContent(res.content || '');
    } catch {
      setLogContent('日志获取失败');
    } finally {
      setLogLoading(false);
    }
  };

  // buildId 变化时拉取日志
  useEffect(() => {
    if (!buildId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildId]);

  // 构建进行中时轮询日志
  useEffect(() => {
    if (!buildId || !isRunning) return;
    const timer = setInterval(() => {
      fetchLog();
    }, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildId, isRunning]);

  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [logContent]);

  const lines = useMemo(() => (logContent || '').split('\n'), [logContent]);

  return (
    <>
      <div className="flex items-center justify-between border-b border-indigo-50 px-4 py-3">
        <div className="flex items-center gap-2">
          {build ? (
            <span className="font-mono text-[13px] font-medium text-slate-900">#{build.build_number || build.queue_id || '-'}</span>
          ) : (
            <span className="text-[13px] text-slate-400">未选择构建</span>
          )}
          {build ? <StatusBadge status={build.status} pulse={isRunning} /> : null}
        </div>
        <div className="flex items-center gap-1">
          {isRunning ? (
            <span className="mr-1 flex items-center gap-1 text-[11px] text-cyan-600">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" style={{ animation: 'pulse-dot 1.8s ease-in-out infinite' }} />
              实时刷新
            </span>
          ) : null}
          {build ? (
            <button
              type="button"
              onClick={() => onOpenExternal(build.id)}
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
              title="打开日志详情"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          ) : null}
        </div>
      </div>
      <div
        ref={logBoxRef}
        className="terminal scrollbar-thin flex-1 overflow-y-auto p-4 text-[11.5px] leading-relaxed"
        style={{ minHeight: 380, maxHeight: 480, background: '#0B1020', color: '#94A3B8', fontFamily: '"JetBrains Mono","SF Mono",Consolas,monospace' }}
      >
        {!build ? (
          <div className="text-slate-500">请选择一条构建记录</div>
        ) : logLoading && !logContent ? (
          <div className="text-slate-500">加载日志中…</div>
        ) : lines.length === 0 || (lines.length === 1 && !lines[0]) ? (
          <div className="text-slate-500">暂无日志</div>
        ) : (
          lines.map((line, idx) => (
            <div key={idx} className={classifyLogLine(line)}>{line || '\u00A0'}</div>
          ))
        )}
      </div>
    </>
  );
}

function classifyLogLine(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes('error') || lower.includes('failed') || lower.includes('failure')) return 'text-rose-400';
  if (lower.includes('warn')) return 'text-amber-400';
  if (lower.includes('success') || lower.includes('✓') || lower.includes('compiled')) return 'text-emerald-400';
  if (lower.startsWith('[') && lower.includes(']')) return 'text-blue-400';
  return '';
}
