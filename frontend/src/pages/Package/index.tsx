import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Drawer, Form, Input, Modal, Select, Switch } from 'antd';
import {
  Activity,
  Boxes,
  ChevronRight,
  Download,
  ExternalLink,
  FileArchive,
  Hammer,
  Loader,
  Package as PackageIcon,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Square,
  Terminal,
} from 'lucide-react';
import dayjs from 'dayjs';
import { useNavigate, useParams } from 'react-router-dom';
import { packageApi } from '@/api/package';
import { projectApi } from '@/api/project';
import { releaseApi } from '@/api/release';
import { repositoryApi } from '@/api/repository';
import { getAvatarColor } from '@/utils/avatar';
import { formatRelativeTime } from '@/utils/time';
import type {
  PackageArtifact,
  PackageBuildType,
  PackageConfig,
  PackageMode,
  PackageTask,
  PackageTaskStatus,
} from '@/types';

const stageLabels: Record<string, string> = {
  checkout: '拉取源码',
  build: '构建打包',
  artifacts: '扫描产物',
  done: '已完成',
};

interface StatusMeta {
  label: string;
  dot: string;
  text: string;
  border: string;
  bg: string;
  pulse?: boolean;
}

const statusMeta: Record<PackageTaskStatus, StatusMeta> = {
  queued: { label: '排队中', dot: 'bg-slate-400', text: 'text-slate-500', border: 'border-slate-200', bg: 'bg-slate-50' },
  running: { label: '打包中', dot: 'bg-cyan-500', text: 'text-cyan-700', border: 'border-cyan-200', bg: 'bg-cyan-50', pulse: true },
  success: { label: '成功', dot: 'bg-emerald-500', text: 'text-emerald-700', border: 'border-emerald-200', bg: 'bg-emerald-50' },
  failure: { label: '失败', dot: 'bg-rose-500', text: 'text-rose-600', border: 'border-rose-200', bg: 'bg-rose-50' },
  canceled: { label: '已取消', dot: 'bg-slate-400', text: 'text-slate-500', border: 'border-slate-200', bg: 'bg-slate-50' },
};

const iconColors = ['icon-indigo', 'icon-violet', 'icon-cyan', 'icon-rose', 'icon-amber', 'icon-emerald'];

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '-';
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min}m${String(sec).padStart(2, '0')}s`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr}h${String(remMin).padStart(2, '0')}m`;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function isRunning(status: PackageTaskStatus): boolean {
  return status === 'running' || status === 'queued';
}

function StatusBadge({ status }: { status: PackageTaskStatus }) {
  const m = statusMeta[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border ${m.border} ${m.bg} px-1.5 py-0.5 text-[11px] font-medium ${m.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot} ${m.pulse ? 'pulse-dot' : ''}`} />
      {m.label}
    </span>
  );
}

function ProgressBar({ progress, status }: { progress: number; status: PackageTaskStatus }) {
  const pct = status === 'success' ? 100 : Math.max(0, Math.min(100, progress || 0));
  const barClass = isRunning(status) ? 'stage-line' : status === 'success' ? 'bg-emerald-400' : status === 'failure' ? 'bg-rose-400' : 'bg-slate-300';
  const textClass = isRunning(status) ? 'text-cyan-600' : status === 'success' ? 'text-emerald-600' : 'text-slate-400';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-indigo-50 overflow-hidden">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`font-mono text-[11px] font-medium shrink-0 ${textClass}`}>{pct}%</span>
    </div>
  );
}

function UserAvatar({ name, size = 16 }: { name?: string; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full text-white font-medium"
      style={{ width: size, height: size, background: getAvatarColor(name), fontSize: size * 0.55 }}
    >
      {(name || 'U').charAt(0)}
    </span>
  );
}

function LogLine({ line }: { line: string }) {
  let cls = '';
  if (/✓|success|完成/.test(line)) cls = 'text-emerald-400';
  else if (/\[WARN\]|\[warning\]/i.test(line)) cls = 'text-amber-400';
  else if (/\[ERROR\]|fail|错误/i.test(line)) cls = 'text-rose-400';
  else if (/\[INFO\]|\[INFO\]/.test(line)) cls = 'text-blue-400';
  else if (/^\[?\d{4}-\d{2}-\d{2}/.test(line)) cls = 'text-slate-500';
  return <div className={cls}>{line}</div>;
}

function TerminalLog({ text }: { text: string }) {
  const lines = text ? text.split('\n') : [];
  return (
    <div className="terminal p-4 text-[11.5px] leading-relaxed overflow-y-auto scrollbar-thin" style={{ minHeight: 420, maxHeight: 560 }}>
      {lines.length === 0 ? (
        <div className="text-slate-600">暂无日志</div>
      ) : (
        lines.map((line, i) => <LogLine key={i} line={line} />)
      )}
    </div>
  );
}

function ArtifactRow({ artifact, taskId }: { artifact: PackageArtifact; taskId: string }) {
  const { message } = App.useApp();
  const [downloading, setDownloading] = useState(false);
  const handleDownload = async () => {
    setDownloading(true);
    try {
      const blob = await packageApi.downloadArtifact(taskId, artifact.id);
      saveBlob(blob, artifact.name);
    } catch {
      message.error('下载失败');
    } finally {
      setDownloading(false);
    }
  };
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-indigo-100 px-3 py-2.5 hover:bg-indigo-50/30">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg icon-emerald shrink-0">
        <FileArchive className="h-[18px] w-[18px]" strokeWidth={1.5} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-slate-900 truncate">{artifact.name}</div>
        <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
          <span className="font-mono">{formatSize(artifact.size)}</span>
          <span className="h-1 w-1 rounded-full bg-slate-300" />
          <span className="font-mono truncate">{artifact.path}</span>
        </div>
      </div>
      <Button size="small" loading={downloading} icon={<Download className="h-3 w-3" strokeWidth={1.5} />} onClick={handleDownload} className="shrink-0">
        下载
      </Button>
    </div>
  );
}

function RunningTab({ tasks, onOpen }: { tasks: PackageTask[]; onOpen: (task: PackageTask) => void }) {
  const running = tasks.filter((t) => isRunning(t.status));
  if (running.length === 0) {
    return (
      <div className="tech-card rounded-xl p-12 text-center">
        <Activity className="mx-auto h-10 w-10 text-slate-300" strokeWidth={1.5} />
        <p className="mt-3 text-[13px] text-slate-400">当前没有进行中的打包任务</p>
      </div>
    );
  }
  return (
    <div className="tech-card rounded-xl overflow-hidden">
      <div className="hidden md:grid grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        <div className="col-span-4">任务 / 版本</div>
        <div className="col-span-2">当前阶段</div>
        <div className="col-span-3">进度</div>
        <div className="col-span-2">触发人 · 耗时</div>
        <div className="col-span-1 text-right">操作</div>
      </div>
      <div className="divide-y divide-indigo-50/50">
        {running.map((task) => {
          const stage = (task.stage_info as { stage?: string } | undefined)?.stage;
          const stageLabel = stage ? (stageLabels[stage] || stage) : '打包中';
          return (
            <div
              key={task.id}
              className="group grid grid-cols-12 gap-3 items-center px-5 py-3 hover:bg-indigo-50/30 cursor-pointer"
              onClick={() => onOpen(task)}
            >
              <div className="col-span-12 md:col-span-4 flex items-center gap-2.5">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-500 pulse-dot shrink-0" />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-slate-900 truncate">{task.name}</div>
                  <div className="font-mono text-[10px] text-slate-400 truncate">{task.version} · {task.repository_name || '-'}</div>
                </div>
              </div>
              <div className="col-span-6 md:col-span-2">
                <span className={`inline-flex items-center gap-1.5 rounded-md border ${statusMeta[task.status].border} ${statusMeta[task.status].bg} px-1.5 py-0.5 text-[11px] font-medium ${statusMeta[task.status].text}`}>
                  <Hammer className="h-3 w-3" strokeWidth={1.5} />
                  {stageLabel}
                </span>
              </div>
              <div className="col-span-6 md:col-span-3">
                <ProgressBar progress={task.progress || 0} status={task.status} />
              </div>
              <div className="col-span-6 md:col-span-2 flex items-center gap-1.5 text-[11px] text-slate-500">
                <UserAvatar name={task.triggered_by_name} size={16} />
                <span>{task.triggered_by_name || '-'}</span>
                <span className="text-slate-300">·</span>
                <span className="font-mono">{task.started_at ? formatDuration(task.duration) : '-'}</span>
              </div>
              <div className="col-span-6 md:col-span-1 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
                <ExternalLink className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface JobsTabProps {
  tasks: PackageTask[];
  loading: boolean;
  onOpen: (task: PackageTask) => void;
}

function JobsTab({ tasks, loading, onOpen }: JobsTabProps) {
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<PackageTaskStatus | ''>('');

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (keyword) {
        const kw = keyword.toLowerCase();
        const txt = `${t.name} ${t.repository_name || ''} ${t.version}`.toLowerCase();
        if (!txt.includes(kw)) return false;
      }
      if (statusFilter && t.status !== statusFilter) return false;
      return true;
    });
  }, [tasks, keyword, statusFilter]);

  return (
    <div className="tech-card rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-indigo-50 px-5 py-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />
          <input
            type="text"
            placeholder="搜索任务名称 / 仓库"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="w-[240px] rounded-lg border border-indigo-100 bg-white pl-8 pr-3 py-1.5 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as PackageTaskStatus | '')}
          className="rounded-lg border border-indigo-100 bg-white px-3 py-1.5 text-[13px] text-slate-600 outline-none hover:bg-indigo-50 hover:text-indigo-600 cursor-pointer"
        >
          <option value="">全部状态</option>
          <option value="queued">排队中</option>
          <option value="running">打包中</option>
          <option value="success">成功</option>
          <option value="failure">失败</option>
          <option value="canceled">已取消</option>
        </select>
        <div className="ml-auto text-[12px] text-slate-400">共 {filtered.length} 条</div>
      </div>
      <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
        <div className="col-span-3">任务名称</div>
        <div className="col-span-2">所属项目</div>
        <div className="col-span-2">关联仓库</div>
        <div className="col-span-2">版本 / Tag</div>
        <div className="col-span-2">最近打包</div>
        <div className="col-span-1 text-right">状态</div>
      </div>
      {loading ? (
        <div className="px-5 py-12 text-center text-[13px] text-slate-400">加载中…</div>
      ) : filtered.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <Boxes className="mx-auto h-10 w-10 text-slate-300" strokeWidth={1.5} />
          <p className="mt-3 text-[13px] text-slate-400">暂无打包任务记录</p>
        </div>
      ) : (
        <div className="divide-y divide-indigo-50/50">
          {filtered.map((task, idx) => (
            <div
              key={task.id}
              className="grid grid-cols-12 gap-3 items-center px-5 py-3 hover:bg-indigo-50/30 cursor-pointer"
              onClick={() => onOpen(task)}
            >
              <div className="col-span-12 md:col-span-3 flex items-center gap-2.5">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconColors[idx % iconColors.length]}`}>
                  <PackageIcon className="h-4 w-4" strokeWidth={1.5} />
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-slate-900 truncate">{task.name}</div>
                  <div className="font-mono text-[10px] text-slate-400">{task.repository_name || '-'}</div>
                </div>
              </div>
              <div className="col-span-6 md:col-span-2 text-[12px] text-slate-600 truncate">{task.project_name || '-'}</div>
              <div className="col-span-6 md:col-span-2 font-mono text-[11px] text-slate-500 truncate">{task.repository_name || '-'}</div>
              <div className="col-span-6 md:col-span-2">
                <span className="font-mono text-[12px] text-slate-700">{task.version}</span>
              </div>
              <div className="col-span-6 md:col-span-2">
                <span className="text-[11px] text-slate-400">{formatRelativeTime(task.created_at)}</span>
              </div>
              <div className="col-span-6 md:col-span-1 flex items-center justify-end">
                <StatusBadge status={task.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface DetailViewProps {
  task: PackageTask;
  builds: PackageTask[];
  logText: string;
  onBack: () => void;
  onLoadTaskLog: (taskId: string) => Promise<{ task: PackageTask; logText: string }>;
  onCancel: (task: PackageTask) => void;
  onEditConfig: () => void;
  onTriggerBuild: () => void;
}

function DetailView({ task, builds, logText, onBack, onLoadTaskLog, onCancel, onEditConfig, onTriggerBuild }: DetailViewProps) {
  const [activeTab, setActiveTab] = useState<'log' | 'artifacts'>('log');
  const [activeBuild, setActiveBuild] = useState<PackageTask>(task);
  const [activeLogText, setActiveLogText] = useState<string>(logText);

  const loadLog = useCallback(async (taskId: string) => {
    const { task: t, logText: text } = await onLoadTaskLog(taskId);
    setActiveBuild(t);
    setActiveLogText(text);
  }, [onLoadTaskLog]);

  useEffect(() => {
    const id = task.id;
    const timer = window.setTimeout(() => loadLog(id), 0);
    return () => window.clearTimeout(timer);
  }, [task.id, loadLog]);

  useEffect(() => {
    if (!isRunning(activeBuild.status)) return;
    const timer = window.setInterval(() => loadLog(activeBuild.id), 3000);
    return () => window.clearInterval(timer);
  }, [activeBuild.id, activeBuild.status, loadLog]);

  const artifacts = activeBuild.artifact_info || [];

  return (
    <div className="space-y-5 page-fade-in">
      <div className="flex items-center gap-2 text-[13px]">
        <button onClick={onBack} className="text-slate-400 hover:text-indigo-600 cursor-pointer">打包看板</button>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" strokeWidth={1.5} />
        <span className="font-medium text-slate-800">{task.name}</span>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg icon-indigo">
            <PackageIcon className="h-[18px] w-[18px]" strokeWidth={1.5} />
          </div>
          <div>
            <div className="text-[15px] font-semibold tracking-tight text-slate-900">{task.name}</div>
            <div className="font-mono text-[10px] text-slate-400">{task.repository_name || '-'} · {task.project_name || '-'}</div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {task.config && (
            <button
              className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium text-white"
              onClick={onTriggerBuild}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
              新建打包
            </button>
          )}
          <Button icon={<Settings2 className="h-3.5 w-3.5" strokeWidth={1.5} />} onClick={onEditConfig}>打包配置</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="lg:col-span-1 tech-card rounded-xl overflow-hidden flex flex-col min-w-0">
          <div className="flex items-center justify-between border-b border-indigo-50 px-3 py-2.5">
            <h3 className="text-[12px] font-semibold tracking-tight text-slate-900">构建历史</h3>
            <span className="text-[10px] text-slate-400">{builds.length}</span>
          </div>
          <div className="divide-y divide-indigo-50/50 overflow-y-auto scrollbar-thin" style={{ maxHeight: 560 }}>
            {builds.length === 0 ? (
              <div className="px-3 py-8 text-center text-[12px] text-slate-400">暂无构建记录</div>
            ) : (
              builds.map((b) => {
                const isActive = b.id === activeBuild.id;
                const buildStage = (b.stage_info as { stage?: string } | undefined)?.stage;
                const buildStageLabel = buildStage ? (stageLabels[buildStage] || buildStage) : '';
                return (
                  <div
                    key={b.id}
                    className={`px-2.5 py-2 hover:bg-indigo-50/30 cursor-pointer ${isActive ? 'bg-indigo-50/40' : ''}`}
                    onClick={() => loadLog(b.id)}
                  >
                    <div className="flex items-center gap-1.5">
                      {isActive && <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0" />}
                      <span className={`font-mono text-[12px] font-medium ${isActive ? 'text-indigo-700' : 'text-slate-900'}`}>{b.version}</span>
                      <span className="text-[10px] text-slate-400 truncate">{b.triggered_by_name || '-'}</span>
                      <span className="ml-auto text-[10px] text-slate-400 shrink-0">{b.started_at ? formatDuration(b.duration) : '-'}</span>
                    </div>
                    {isRunning(b.status) ? (
                      <div className="mt-1.5 space-y-1">
                        <ProgressBar progress={b.progress || 0} status={b.status} />
                        <div className="flex items-center justify-between">
                          <span className="inline-flex items-center gap-1 text-[10px] text-cyan-600">
                            <span className="h-1 w-1 rounded-full bg-cyan-500 pulse-dot" />
                            {buildStageLabel || '打包中'}
                          </span>
                          <button
                            className="inline-flex items-center gap-0.5 rounded border border-rose-200 bg-white px-1 py-0 text-[10px] font-medium text-rose-600 hover:bg-rose-50"
                            onClick={(e) => { e.stopPropagation(); onCancel(b); }}
                          >
                            <Square className="h-2.5 w-2.5" strokeWidth={1.5} />停止
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-1.5 flex items-center justify-between">
                        <StatusBadge status={b.status} />
                        <span className="text-[10px] text-slate-400">{formatRelativeTime(b.finished_at || b.created_at)}</span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="lg:col-span-4 tech-card rounded-xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between border-b border-indigo-50 px-4">
            <div className="flex items-center gap-1">
              <button
                className={`lt-tab whitespace-nowrap border-b-2 px-3 py-3 text-[13px] font-medium ${activeTab === 'log' ? 'on' : 'text-slate-500 border-transparent hover:text-indigo-600'}`}
                onClick={() => setActiveTab('log')}
              >
                构建日志
              </button>
              <button
                className={`lt-tab whitespace-nowrap border-b-2 px-3 py-3 text-[13px] font-medium ${activeTab === 'artifacts' ? 'on' : 'text-slate-500 border-transparent hover:text-indigo-600'}`}
                onClick={() => setActiveTab('artifacts')}
              >
                打包产物
                {artifacts.length > 0 && <span className="ml-1 rounded bg-slate-100 px-1 py-0 text-[10px] font-medium text-slate-500">{artifacts.length}</span>}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[12px] text-slate-500">{activeBuild.version}</span>
              <StatusBadge status={activeBuild.status} />
            </div>
          </div>
          {activeTab === 'log' ? (
            <TerminalLog text={activeLogText} />
          ) : (
            <div className="p-4 space-y-3 scrollbar-thin" style={{ minHeight: 420, maxHeight: 560, overflowY: 'auto' }}>
              {artifacts.length === 0 ? (
                <div className="text-center py-12 text-[13px] text-slate-400">暂无产物</div>
              ) : (
                artifacts.map((a) => <ArtifactRow key={a.id} artifact={a} taskId={activeBuild.id} />)
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface BuildViewProps {
  task: PackageTask;
  logText: string;
  onBack: () => void;
  onCancel: (task: PackageTask) => void;
}

function BuildView({ task, logText, onBack, onCancel }: BuildViewProps) {
  const artifacts = task.artifact_info || [];
  const stage = (task.stage_info as { stage?: string } | undefined)?.stage;
  const stageLabel = stage ? (stageLabels[stage] || stage) : '打包中';
  const running = isRunning(task.status);

  return (
    <div className="space-y-5 page-fade-in">
      <div className="flex items-center gap-2 text-[13px]">
        <button onClick={onBack} className="text-slate-400 hover:text-indigo-600 cursor-pointer">打包看板</button>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" strokeWidth={1.5} />
        <span className="font-medium text-slate-800">{task.version} · {task.name}</span>
      </div>

      <div className="tech-card rounded-xl p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl icon-cyan">
              {running ? <Loader className="h-5 w-5 spin-slow" strokeWidth={1.5} /> : <PackageIcon className="h-5 w-5" strokeWidth={1.5} />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[20px] font-semibold tracking-tight text-slate-900">{task.version}</h1>
                <StatusBadge status={task.status} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
                <span className="font-mono">{task.name}</span>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span className="font-mono">{task.tag_name}</span>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span>{task.triggered_by_name || '-'}</span>
                {task.started_at && (
                  <>
                    <span className="h-1 w-1 rounded-full bg-slate-300" />
                    <span>{dayjs(task.started_at).format('YYYY-MM-DD HH:mm')}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          {running && (
            <Button danger icon={<Square className="h-3.5 w-3.5" strokeWidth={1.5} />} onClick={() => onCancel(task)}>
              停止构建
            </Button>
          )}
        </div>
        {running && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-[12px] text-slate-500 mb-1.5">
              <span>{stageLabel} · {task.progress || 0}%</span>
              <span className="font-mono text-cyan-600">{formatDuration(task.duration)}</span>
            </div>
            <div className="h-2 w-full rounded-full bg-indigo-50 overflow-hidden">
              <div className="h-full rounded-full stage-line" style={{ width: `${task.progress || 0}%` }} />
            </div>
          </div>
        )}
        {task.error_message && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] text-rose-700">
            {task.error_message}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3 tech-card rounded-xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between border-b border-indigo-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-indigo-400" strokeWidth={1.5} />
              <h3 className="text-[13px] font-semibold tracking-tight text-slate-900">构建日志</h3>
            </div>
          </div>
          <TerminalLog text={logText} />
        </div>

        <div className="lg:col-span-2 tech-card rounded-xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between border-b border-indigo-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <PackageIcon className="h-4 w-4 text-indigo-400" strokeWidth={1.5} />
              <h3 className="text-[13px] font-semibold tracking-tight text-slate-900">打包产物</h3>
            </div>
            <span className="text-[10px] text-slate-400">{artifacts.length} 个</span>
          </div>
          <div className="divide-y divide-indigo-50/50 flex-1 overflow-y-auto scrollbar-thin" style={{ maxHeight: 560 }}>
            {artifacts.length === 0 ? (
              <div className="px-4 py-12 text-center text-[13px] text-slate-400">暂无产物</div>
            ) : (
              artifacts.map((a) => (
                <div key={a.id} className="px-4 py-3 hover:bg-indigo-50/30">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg icon-emerald shrink-0">
                      <FileArchive className="h-4 w-4" strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-slate-900 truncate">{a.name}</div>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                        <span className="font-mono">{formatSize(a.size)}</span>
                        <span className="h-1 w-1 rounded-full bg-slate-300" />
                        <span className="font-mono truncate">{a.path}</span>
                      </div>
                    </div>
                    <ArtifactDownloadButton artifact={a} taskId={task.id} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ArtifactDownloadButton({ artifact, taskId }: { artifact: PackageArtifact; taskId: string }) {
  const { message } = App.useApp();
  const [downloading, setDownloading] = useState(false);
  const handleDownload = async () => {
    setDownloading(true);
    try {
      const blob = await packageApi.downloadArtifact(taskId, artifact.id);
      saveBlob(blob, artifact.name);
    } catch {
      message.error('下载失败');
    } finally {
      setDownloading(false);
    }
  };
  return (
    <button
      className="rounded-md p-1.5 text-slate-400 hover:bg-indigo-100 hover:text-indigo-600 shrink-0 disabled:opacity-50"
      onClick={handleDownload}
      disabled={downloading}
    >
      <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
    </button>
  );
}

interface ConfigDrawerProps {
  open: boolean;
  editing: PackageConfig | null;
  onClose: () => void;
}

const modeOptions = [
  { label: '简易打包', value: 'simple' },
  { label: '本地脚本', value: 'local' },
];

const buildTypeOptions = [
  { label: 'Web', value: 'web' },
  { label: 'Qt', value: 'qt' },
];

function ConfigDrawer({ open, editing, onClose }: ConfigDrawerProps) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<Partial<PackageConfig>>();
  const mode = (Form.useWatch('mode', form) || 'simple') as PackageMode;
  const buildType = (Form.useWatch('build_type', form) || 'web') as PackageBuildType;

  const { data: projectsData } = useQuery({
    queryKey: ['package-drawer-projects'],
    queryFn: () => projectApi.getProjects({ page: 1, page_size: 1000 }),
    enabled: open,
  });

  const projectId = Form.useWatch('project', form);

  const { data: reposData } = useQuery({
    queryKey: ['package-drawer-repos', projectId],
    queryFn: () => repositoryApi.getRepositories({ project: projectId, repo_type: 'git', page_size: 1000 }),
    enabled: open && !!projectId,
  });

  const { data: imagesData } = useQuery({
    queryKey: ['package-drawer-images', buildType],
    queryFn: () => packageApi.getImages({ build_type: buildType, is_active: true, page_size: 1000 }),
    enabled: open && mode === 'simple',
  });

  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.setFieldsValue({ ...editing, image: editing.image_id || editing.image || undefined });
    } else {
      form.setFieldsValue({
        mode: 'simple',
        build_type: 'web',
        build_path: '.',
        output_path: 'dist',
        env_vars: {},
        auto_package_on_release: true,
        is_active: true,
      });
    }
  }, [editing, form, open]);

  const saveMutation = useMutation({
    mutationFn: (values: Partial<PackageConfig>) => {
      if (editing) return packageApi.updateConfig(editing.id, values);
      return packageApi.createConfig(values);
    },
    onSuccess: () => {
      message.success('保存成功');
      onClose();
      queryClient.invalidateQueries({ queryKey: ['package-configs'] });
      queryClient.invalidateQueries({ queryKey: ['package-tasks'] });
    },
    onError: () => message.error('保存失败'),
  });

  const projectOptions = (projectsData?.results || []).map((p) => ({ label: p.name, value: p.id }));
  const repoOptions = (reposData?.results || []).map((r) => ({ label: r.name, value: r.id }));
  const imageOptions = (imagesData?.results || []).map((img) => ({ label: `${img.name} / ${img.image}`, value: img.id }));

  return (
    <Drawer
      title={
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-indigo-500" strokeWidth={1.5} />
          <span className="text-[15px] font-semibold tracking-tight text-slate-900">
            {editing ? '打包配置' : '新建打包任务'}
          </span>
        </div>
      }
      width={420}
      open={open}
      onClose={onClose}
      destroyOnClose
      extra={
        <div className="flex items-center gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saveMutation.isPending} onClick={() => form.submit()}>
            保存
          </Button>
        </div>
      }
    >
      <Form form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)}>
        <Form.Item name="name" label="任务名称" rules={[{ required: true, message: '请输入任务名称' }]}>
          <Input placeholder="输入任务名称" />
        </Form.Item>
        <Form.Item name="project" label="所属项目" rules={[{ required: true, message: '请选择项目' }]}>
          <Select options={projectOptions} placeholder="选择项目" showSearch optionFilterProp="label" />
        </Form.Item>
        <Form.Item name="repository" label="关联仓库" rules={[{ required: true, message: '请选择仓库' }]}>
          <Select
            options={repoOptions}
            placeholder={projectId ? '选择仓库' : '请先选择项目'}
            disabled={!projectId}
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>
        <div className="grid grid-cols-2 gap-3">
          <Form.Item name="mode" label="打包模式" rules={[{ required: true }]}>
            <Select options={modeOptions} />
          </Form.Item>
          <Form.Item name="build_type" label="打包类型" rules={[{ required: true }]}>
            <Select options={buildTypeOptions} />
          </Form.Item>
        </div>
        {mode === 'simple' ? (
          <Form.Item name="image" label="打包镜像" rules={[{ required: true, message: '请选择打包镜像' }]}>
            <Select options={imageOptions} placeholder="按打包类型选择镜像" showSearch optionFilterProp="label" />
          </Form.Item>
        ) : (
          <Form.Item name="local_script" label="本地打包脚本" rules={[{ required: true, message: '请填写打包脚本' }]}>
            <Input.TextArea rows={4} placeholder="npm ci && npm run build" />
          </Form.Item>
        )}
        <Form.Item name="build_path" label="构建目录" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="output_path" label="产物目录" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <div className="grid grid-cols-2 gap-3">
          <Form.Item name="auto_package_on_release" label="发布后自动打包" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="is_active" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </div>
      </Form>
    </Drawer>
  );
}

export default function PackageTaskPage() {
  const navigate = useNavigate();
  const { id: routeTaskId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();

  const [userView, setUserView] = useState<'list' | 'detail' | 'build'>('list');
  const view: 'list' | 'detail' | 'build' = routeTaskId ? 'build' : userView;
  const [activeTab, setActiveTab] = useState<'running' | 'jobs'>('running');
  const [selectedTask, setSelectedTask] = useState<PackageTask | null>(null);
  const [logText, setLogText] = useState('');
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<PackageConfig | null>(null);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [triggerConfig, setTriggerConfig] = useState<PackageConfig | null>(null);
  const [triggerForm] = Form.useForm<{ release_id: string }>();

  const { data: releasedData, isLoading: releasesLoading } = useQuery({
    queryKey: ['package-trigger-releases', triggerConfig?.project, triggerConfig?.repository],
    queryFn: () =>
      releaseApi.getReleases({
        project: triggerConfig?.project,
        repository: triggerConfig?.repository,
        status: 'released',
        page_size: 1000,
      }),
    enabled: triggerOpen && !!triggerConfig?.project && !!triggerConfig?.repository,
  });

  const releaseOptions = (releasedData?.results || []).map((release) => ({
    label: `${release.version} / ${release.tag_name}`,
    value: release.id,
  }));

  const triggerMutation = useMutation({
    mutationFn: ({ configId, releaseId }: { configId: string; releaseId: string }) =>
      packageApi.triggerConfig(configId, releaseId),
    onSuccess: (task) => {
      if (task.status === 'failure') {
        message.warning(task.error_message || '打包任务创建成功，但任务投递失败');
      } else {
        message.success('已创建打包任务');
        navigate(`/packages/${task.id}`);
      }
      setTriggerOpen(false);
      setTriggerConfig(null);
      triggerForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['package-tasks'] });
    },
    onError: () => message.error('触发打包失败'),
  });

  const pageSize = 100;
  const page = 1;

  const { data: tasksData, isLoading: tasksLoading } = useQuery({
    queryKey: ['package-tasks', page],
    queryFn: () => packageApi.getTasks({ page, page_size: pageSize }),
  });

  const tasks = useMemo(() => tasksData?.results || [], [tasksData]);
  const runningCount = tasks.filter((t) => isRunning(t.status)).length;

  const selectedTaskId = selectedTask?.id;
  const shouldPoll = !!selectedTask && isRunning(selectedTask.status);

  const loadTaskDetail = useCallback(async (taskId: string) => {
    const [task, blob] = await Promise.all([
      packageApi.getTask(taskId),
      packageApi.getTaskLog(taskId).catch(() => new Blob([''])),
    ]);
    const logText = await blob.text();
    setSelectedTask(task);
    setLogText(logText);
    if (!isRunning(task.status)) {
      queryClient.invalidateQueries({ queryKey: ['package-tasks'] });
    }
    return { task, logText };
  }, [queryClient]);

  useEffect(() => {
    if (!routeTaskId) return;
    let ignore = false;
    const load = async () => {
      try {
        await loadTaskDetail(routeTaskId);
      } catch {
        if (!ignore) message.error('加载任务失败');
      }
    };
    load();
    return () => { ignore = true; };
  }, [routeTaskId, loadTaskDetail, message]);

  useEffect(() => {
    if (!selectedTaskId || !shouldPoll) return;
    let ignore = false;
    const timer = window.setInterval(async () => {
      try {
        await loadTaskDetail(selectedTaskId);
      } catch {
        if (!ignore) { /* keep polling */ }
      }
    }, 3000);
    return () => {
      ignore = true;
      window.clearInterval(timer);
    };
  }, [selectedTaskId, shouldPoll, loadTaskDetail]);

  const cancelMutation = useMutation({
    mutationFn: (taskId: string) => packageApi.cancelTask(taskId),
    onSuccess: () => {
      message.success('已发送取消请求');
      queryClient.invalidateQueries({ queryKey: ['package-tasks'] });
      if (selectedTaskId) loadTaskDetail(selectedTaskId);
    },
    onError: () => message.error('取消失败'),
  });

  const handleCancel = (task: PackageTask) => {
    modal.confirm({
      title: '停止构建',
      content: `确定要停止「${task.name}」吗？`,
      onOk: () => cancelMutation.mutate(task.id),
    });
  };

  const openBuild = (task: PackageTask) => {
    setSelectedTask(task);
    setUserView('build');
    navigate(`/packages/${task.id}`);
    loadTaskDetail(task.id);
  };

  const openDetail = (task: PackageTask) => {
    setSelectedTask(task);
    setUserView('detail');
    loadTaskDetail(task.id);
  };

  const backToList = () => {
    setUserView('list');
    setSelectedTask(null);
    setLogText('');
    if (routeTaskId) navigate('/packages');
  };

  const openNewConfig = () => {
    setEditingConfig(null);
    setConfigDrawerOpen(true);
  };

  const openEditConfig = async () => {
    if (!selectedTask?.config) {
      message.warning('该任务没有关联的打包配置');
      return;
    }
    try {
      const config = await packageApi.getConfig(selectedTask.config);
      setEditingConfig(config);
      setConfigDrawerOpen(true);
    } catch {
      message.error('加载打包配置失败');
    }
  };

  const openTriggerBuild = () => {
    if (!selectedTask?.config) {
      message.warning('该任务没有关联的打包配置');
      return;
    }
    setTriggerConfig({
      id: selectedTask.config,
      project: selectedTask.project,
      repository: selectedTask.repository,
      name: selectedTask.config_name || selectedTask.name,
      repository_name: selectedTask.repository_name || '',
    } as PackageConfig);
    setTriggerOpen(true);
    triggerForm.resetFields();
  };

  const builds = useMemo(() => {
    if (!selectedTask) return [];
    return tasks
      .filter((t) => t.config === selectedTask.config || t.name === selectedTask.name)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [tasks, selectedTask]);

  return (
    <div className="space-y-5">
      {view === 'list' && (
        <div className="space-y-5 page-fade-in">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">打包看板</h1>
              <p className="mt-1 text-[13px] text-slate-500">管理打包任务，监控打包进度，查看实时日志与产物</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                icon={<RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />}
                onClick={() => queryClient.invalidateQueries({ queryKey: ['package-tasks'] })}
              >
                刷新
              </Button>
              <button
                className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white"
                onClick={openNewConfig}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                添加打包任务
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="seg inline-flex items-center gap-0.5 rounded-lg p-0.5">
              <button
                className={`seg-btn inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium ${activeTab === 'running' ? 'on' : ''}`}
                onClick={() => setActiveTab('running')}
              >
                <Activity className="h-3.5 w-3.5" strokeWidth={1.5} />
                进行中
                {runningCount > 0 && (
                  <span className="rounded bg-cyan-100 px-1 py-0.5 text-[10px] font-medium text-cyan-700">{runningCount}</span>
                )}
              </button>
              <button
                className={`seg-btn inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium ${activeTab === 'jobs' ? 'on' : ''}`}
                onClick={() => setActiveTab('jobs')}
              >
                <Boxes className="h-3.5 w-3.5" strokeWidth={1.5} />
                打包任务
              </button>
            </div>
          </div>

          {activeTab === 'running' ? (
            <RunningTab tasks={tasks} onOpen={openBuild} />
          ) : (
            <JobsTab tasks={tasks} loading={tasksLoading} onOpen={openDetail} />
          )}
        </div>
      )}

      {view === 'detail' && selectedTask && (
        <DetailView
          task={selectedTask}
          builds={builds}
          logText={logText}
          onBack={backToList}
          onLoadTaskLog={loadTaskDetail}
          onCancel={handleCancel}
          onEditConfig={openEditConfig}
          onTriggerBuild={openTriggerBuild}
        />
      )}

      {view === 'build' && selectedTask && (
        <BuildView
          task={selectedTask}
          logText={logText}
          onBack={backToList}
          onCancel={handleCancel}
        />
      )}

      <Modal
        title="新建打包"
        open={triggerOpen}
        onCancel={() => {
          setTriggerOpen(false);
          setTriggerConfig(null);
          triggerForm.resetFields();
        }}
        onOk={() => triggerForm.submit()}
        confirmLoading={triggerMutation.isPending}
        destroyOnHidden
      >
        <div className="mb-3 rounded-lg border border-indigo-100 bg-indigo-50/40 p-3 text-[12px] text-slate-600">
          <div>打包配置：{triggerConfig?.name || '-'}</div>
          <div>关联仓库：{triggerConfig?.repository_name || '-'}</div>
        </div>
        <Form
          form={triggerForm}
          layout="vertical"
          onFinish={(values) => {
            if (!triggerConfig) return;
            triggerMutation.mutate({ configId: triggerConfig.id, releaseId: values.release_id });
          }}
        >
          <Form.Item name="release_id" label="选择已发布 Tag" rules={[{ required: true, message: '请选择已发布 Tag' }]}>
            <Select
              showSearch
              loading={releasesLoading}
              options={releaseOptions}
              placeholder="选择已发布版本 / Tag"
              optionFilterProp="label"
              notFoundContent={releasesLoading ? '加载中...' : '暂无可打包的已发布 Tag'}
            />
          </Form.Item>
        </Form>
      </Modal>

      <ConfigDrawer
        open={configDrawerOpen}
        editing={editingConfig}
        onClose={() => {
          setConfigDrawerOpen(false);
          setEditingConfig(null);
        }}
      />
    </div>
  );
}
