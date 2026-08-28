import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Chart } from 'chart.js';
import { ArrowRight, ChevronRight, Settings2 } from 'lucide-react';
import type { PackageTask, PackageTaskStats } from '@/types';
import { packageApi } from '@/api/package';
import { useAuthStore } from '@/stores/authStore';
import { FavoriteConfigCard } from '@/components/FavoriteConfigCard';
import type { PackageTriggerTarget } from '@/components/PackageTriggerModal';
import { formatDurationSeconds, formatRelative, getRunningElapsedSeconds, isBuildRunning } from '../utils';

interface PackageGlancePanelProps {
  /** 近 30 天打包统计（我发起的、仅终态；来自 index.tsx 的 package-task-stats 查询） */
  stats?: PackageTaskStats;
  /** 我发起的最近打包任务（复用 dashboard-package-tasks 查询结果，取前 3 条展示） */
  tasks: PackageTask[];
  onTrigger: (target: PackageTriggerTarget) => void;
}

/**
 * 工作台「打包速览」面板：近 30 天成功率环 + 最近任务 + 常用配置快捷触发。
 * 统计口径与打包看板一致（我发起的、近 30 天、仅终态任务）。
 */
export function PackageGlancePanel({ stats, tasks, onTrigger }: PackageGlancePanelProps) {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const user = useAuthStore((s) => s.user);

  const { data: favorites } = useQuery({
    // queryKey 带用户 id：SPA 内切换账号时不沿用上一账号的收藏缓存
    queryKey: ['package-favorites', user?.id],
    queryFn: () => packageApi.getFavorites(),
    staleTime: 30_000,
  });

  const total = stats?.total || 0;
  const success = stats?.success || 0;
  const failure = stats?.failure || 0;
  const canceled = stats?.canceled || 0;
  // 成功率直接消费后端聚合结果，避免多处各自计算导致口径漂移
  const successRate = stats?.success_rate ?? 0;
  const avgDuration = !stats?.avg_duration_seconds ? null : Math.round(stats.avg_duration_seconds);

  const recentTasks = useMemo(() => tasks.slice(0, 3), [tasks]);

  useEffect(() => {
    if (!canvasRef.current) return;
    chartRef.current?.destroy();
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    // 无数据时渲染一圈浅灰占位环，避免空白
    const empty = total === 0;
    chartRef.current = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: empty ? ['暂无任务'] : ['成功', '失败', '取消'],
        datasets: [
          {
            data: empty ? [1] : [success, failure, canceled],
            backgroundColor: empty ? ['#e2e8f0'] : ['#34d399', '#fb7185', '#cbd5e1'],
            borderWidth: 0,
          },
        ],
      },
      options: {
        cutout: '72%',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
      },
    });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [total, success, failure, canceled]);

  return (
    <section className="tech-card rounded-xl p-5">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">打包速览</h2>
          <p className="mt-0.5 text-[12px] text-slate-500">我发起的任务 · 统计口径近 30 天</p>
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

      <div className="grid grid-cols-1 gap-5 md:grid-cols-5">
        {/* 成功率环 + 计数 */}
        <div className="flex items-center gap-4 md:col-span-2">
          {/* canvas 必须包一层固定尺寸的 div，避免 chart.js 响应式无限增长 */}
          <div className="relative h-[120px] w-[120px] shrink-0">
            <canvas ref={canvasRef} />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[22px] font-semibold tracking-tight text-slate-900">{successRate}%</span>
              <span className="text-[10px] text-slate-400">成功率</span>
            </div>
          </div>
          <div className="space-y-2 text-[12px]">
            <p className="flex items-center gap-2 text-slate-600">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              成功 <span className="font-mono font-semibold text-slate-800">{success}</span>
            </p>
            <p className="flex items-center gap-2 text-slate-600">
              <span className="h-2 w-2 rounded-full bg-rose-400" />
              失败 <span className="font-mono font-semibold text-slate-800">{failure}</span>
            </p>
            <p className="flex items-center gap-2 text-slate-600">
              <span className="h-2 w-2 rounded-full bg-slate-300" />
              取消 <span className="font-mono font-semibold text-slate-800">{canceled}</span>
            </p>
            <p className="border-t border-slate-100 pt-2 text-[11px] text-slate-400">
              共 {total} 次 · 平均耗时 {formatDurationSeconds(avgDuration)}
            </p>
          </div>
        </div>

        {/* 最近任务（我发起的最近 3 条） */}
        <div className="md:col-span-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">最近任务</p>
          {recentTasks.length === 0 ? (
            <div className="rounded-lg border border-slate-100 px-3 py-6 text-center text-[12px] text-slate-400">
              暂无打包任务
            </div>
          ) : (
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-100">
              {recentTasks.map((task) => {
                const running = isBuildRunning(task);
                const dotClass = running
                  ? 'animate-pulse bg-cyan-500'
                  : task.status === 'success'
                    ? 'bg-emerald-500'
                    : task.status === 'failure'
                      ? 'bg-rose-500'
                      : 'bg-slate-400';
                const meta = running
                  ? task.status === 'queued'
                    ? '排队中'
                    : `已运行 ${formatDurationSeconds(getRunningElapsedSeconds(task))}`
                  : `${task.status_display || task.status} · ${formatRelative(task.finished_at || task.created_at)}`;
                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => navigate(`/packages/${task.id}`)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-indigo-50/40"
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-slate-900">
                        {task.name}{task.version ? ` / ${task.version}` : ''}
                      </span>
                      <span className="block text-[11px] text-slate-400">{meta}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" strokeWidth={1.5} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 常用配置快捷触发（二级卡片） */}
      {favorites && favorites.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">常用配置</p>
            <button
              type="button"
              onClick={() => navigate('/packages')}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 transition-colors hover:text-indigo-600"
            >
              <Settings2 className="h-3 w-3" strokeWidth={1.5} />
              管理常用
            </button>
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {favorites.map((config) => (
              <FavoriteConfigCard key={config.id} config={config} onTrigger={onTrigger} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
