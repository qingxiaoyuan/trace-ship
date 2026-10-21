import { useEffect } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Empty, Pagination, Skeleton, Spin } from 'antd';
import dayjs from 'dayjs';
import { ArrowRight, Box, CalendarDays, ChevronRight, FileText, Hammer, MessageSquareText, Rocket, Search, TriangleAlert } from 'lucide-react';
import { dashboardApi, type MaintainerPackageTask } from '@/api/dashboard';
import { releaseApi } from '@/api/release';
import { useAuthStore } from '@/stores/authStore';
import type { ReleaseType } from '@/types';
import { releaseTypeText } from './constants';
import { formatDurationSeconds, getGreeting } from './utils';
import type { KpiCard } from './types';
import { KpiCardView } from './components/KpiCardView';
import { MaintainerScopePicker } from './components/MaintainerScopePicker';
import './maintainer.css';

const packageText = { none: '未打包', queued: '排队中', running: '打包中', success: '打包成功', failure: '打包失败', canceled: '已取消' };

function releasedDate(value?: string): string {
  if (!value) return '发布时间未记录';
  const date = dayjs(value);
  if (date.isSame(dayjs(), 'day')) return '今天';
  return date.format(date.year() === dayjs().year() ? 'MM-DD' : 'YYYY-MM-DD');
}

function taskMeta(task: MaintainerPackageTask): string {
  if (task.status === 'running' || task.status === 'queued') return task.status === 'queued' ? '等待执行' : '正在执行';
  return `${dayjs(task.finished_at || task.created_at).format('MM-DD HH:mm')}${task.duration > 0 ? ` · 耗时 ${formatDurationSeconds(Math.round(task.duration / 1000))}` : ''}`;
}

/** 维保首页复用真实发布与只读摘要接口；查询条件留在地址中，返回可恢复。 */
export function MaintainerDashboard({ projectCount }: { projectCount: number }) {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const requestedPage = Number(params.get('page') || 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const project = params.get('project') || undefined;
  const repository = project ? params.get('repository') || undefined : undefined;
  const releaseType = params.get('type') || undefined;
  const search = params.get('search') || '';
  const filtered = !!(project || releaseType || search);
  const summary = useQuery({
    queryKey: ['maintainer-summary', user?.id, projectCount], queryFn: () => dashboardApi.getMaintainerSummary(),
    refetchOnMount: 'always', refetchOnWindowFocus: true, refetchInterval: 60_000, retry: false,
  });
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['maintainer-releases', user?.id, projectCount, project, repository, releaseType, search, page],
    queryFn: () => releaseApi.getReleases({ status: 'released', ordering: '-released_at', project, repository,
      release_type: releaseType, search: search || undefined, page, page_size: 6 }),
    refetchOnMount: 'always', refetchOnWindowFocus: true, refetchInterval: 60_000, retry: false,
  });
  const updateFilters = (updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    next.delete('page');
    Object.entries(updates).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    setParams(next, { replace: true });
  };
  const reset = () => updateFilters({ project: undefined, repository: undefined, type: undefined, search: undefined });
  const from = location.pathname + location.search;
  const stats = summary.data?.stats;
  const kpiCards: KpiCard[] = [
    {
      title: '近30天发布',
      value: <span className="text-[28px] font-semibold tracking-tight text-slate-900">{stats ? stats.released_count : '—'}</span>,
      unit: '个版本 · 近30天发布',
      description: '所属项目 · 已发布版本',
      icon: Rocket,
      iconClass: 'icon-indigo',
      onClick: () => navigate('/releases'),
      footer: <span className="inline-flex items-center gap-1 text-[12px] font-medium text-indigo-600">查看发布记录<ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={1.5} /></span>,
    },
    {
      title: '失败打包任务',
      value: <span className="text-[28px] font-semibold tracking-tight text-slate-900">{stats ? stats.failed_task_count : '—'}</span>,
      unit: '个失败打包任务',
      description: '所属项目 · 失败记录不限时间',
      icon: TriangleAlert,
      iconClass: 'icon-rose',
      onClick: () => navigate('/packages'),
      footer: <span className="inline-flex items-center gap-1 text-[12px] font-medium text-indigo-600">查看打包任务<ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={1.5} /></span>,
    },
    {
      title: '打包成功率',
      value: <span className="text-[28px] font-semibold tracking-tight text-slate-900">
        <span>{stats ? stats.package_success_rate != null ? stats.package_success_rate.toFixed(1) : '暂无' : '—'}</span>
        {stats?.package_success_rate != null && <span className="text-[18px] text-slate-400">%</span>}
      </span>,
      unit: '打包成功率',
      description: stats ? stats.package_total ? `近30天共 ${stats.package_total} 个任务，${stats.package_success} 个成功` : '近30天 · 暂无统计' : '所属项目 · 近30天',
      icon: Hammer,
      iconClass: 'icon-cyan',
      onClick: () => navigate('/packages'),
      footer: <span className="inline-flex items-center gap-1 text-[12px] font-medium text-indigo-600">查看打包任务<ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={1.5} /></span>,
    },
  ];

  useEffect(() => {
    // 只在从说明详情返回时恢复该次点击前的位置，首次进入首页不滚动。
    const saved = sessionStorage.getItem(`maintainer-scroll:${from}`);
    if (data && saved !== null) {
      requestAnimationFrame(() => window.scrollTo({ top: Number(saved), behavior: 'instant' }));
      sessionStorage.removeItem(`maintainer-scroll:${from}`);
    }
  }, [data, from]);
  const rememberScroll = () => sessionStorage.setItem(`maintainer-scroll:${from}`, String(window.scrollY));

  return <div className="maintainer-dashboard">
    <header className="mnt-heading">
      <div>
        <div className="mnt-desktop-title"><h1>维保工作台</h1></div>
        <p className="mnt-greeting">{getGreeting()}，{user?.nickname || user?.username || '你好'}<span>。查看项目版本，跟进维保进展。</span></p>
        <p className="mnt-mobile-scope">你所属的 {projectCount} 个项目{summary.data && <> · {summary.data.software_count} 个软件</>}</p>
      </div>
      <div className="mnt-date"><CalendarDays size={15} aria-hidden /><p>{dayjs().format('M月D日')}{'  '}{['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][dayjs().day()]}</p></div>
    </header>

    {summary.isError && <Alert className="mnt-summary-error" type="error" showIcon title="项目总览加载失败" description="指标、项目范围和打包近况暂不可用，版本列表仍可单独查询。" action={<Button onClick={() => void summary.refetch()}>重试总览</Button>} />}
    <div className="mnt-kpis" aria-label="所属项目总览">
      {kpiCards.map((card) => <KpiCardView key={card.title} card={card} />)}
    </div>

    <div className="mnt-workspace">
      <section aria-labelledby="maintainer-releases-title" className="mnt-release-panel">
        <div className="mnt-panel-heading">
          <div><div className="mnt-title-row"><h2 id="maintainer-releases-title"><span className="mnt-pc-only">发布版本</span><span className="mnt-phone-only">最近发布</span></h2>{data && !isError && <span className="mnt-count">{data.total}<span className="mnt-phone-only"> 个版本</span></span>}</div><p>查看各项目已发布的软件与更新内容</p></div>
          <Link className="mnt-text-link mnt-pc-only" to="/releases">发布记录 <ArrowRight size={14} aria-hidden /></Link>
        </div>

        <div className="mnt-filters">
          <MaintainerScopePicker projects={summary.data?.projects || []} value={{ project, repository }} disabled={!summary.data} onApply={(scope) => updateFilters({ project: scope.project, repository: scope.repository })} />
          <label className="mnt-release-search"><Search size={16} aria-hidden /><input aria-label="搜索版本、软件或发布说明" placeholder="搜索版本号、软件或发布说明" value={search} onChange={(event) => updateFilters({ search: event.target.value })} /></label>
          <div className="mnt-type-filters" role="group" aria-label="发布类型">
            {(['', 'formal', 'rc', 'beta'] as const).map((type) => <button type="button" key={type} aria-pressed={(releaseType || '') === type} className={(releaseType || '') === type ? 'is-active' : ''} onClick={() => updateFilters({ type: type || undefined })}>{type ? releaseTypeText[type as ReleaseType] : '全部类型'}</button>)}
          </div>
          {filtered ? <button type="button" className="mnt-reset" onClick={reset}>恢复全部</button>
            : <label className="mnt-pending-filter mnt-pc-only" title="第三方问题反馈尚未接入"><input type="checkbox" disabled />仅看未关闭问题</label>}
        </div>

        {isPending ? <div role="status" className="mnt-list-state"><Spin />正在加载已发布版本…</div>
          : isError ? <div className="mnt-list-state"><Alert type="error" showIcon title="已发布版本加载失败" description="请重试获取最新版本列表。" action={<Button onClick={() => void refetch()}>重试</Button>} /></div>
          : !data?.results.length ? <div className="mnt-list-state"><Empty description={filtered ? '没有匹配的已发布版本' : '所属项目暂无已发布版本'} />{filtered && <Button onClick={reset}>恢复全部</Button>}</div>
          : <>
            <ul className="mnt-release-list">
              {data.results.map((release) => <li key={release.id} className="mnt-release-row">
                <div className="mnt-release-identity"><Box className="mnt-pc-only" size={14} aria-hidden /><span className="mnt-release-project">{release.project_name}</span><ChevronRight size={12} aria-hidden /><span className="mnt-release-software">{release.component_name || release.repository_name}</span>
                </div>
                <div className="mnt-release-version">
                  <Link onClick={rememberScroll} state={{ maintainerFrom: from }} to={`/releases/${release.id}`}>{release.version}</Link>
                  <div><span className={`mnt-type-badge ${release.release_type}`}>{releaseTypeText[release.release_type]}</span>
                    <time dateTime={release.released_at || undefined} title={release.released_at ? dayjs(release.released_at).format('YYYY-MM-DD HH:mm') : undefined}>{releasedDate(release.released_at)}</time></div>
                </div>
                <p className="mnt-release-summary">{release.update_summary || '暂无更新摘要'}</p>
                <div className="mnt-release-action"><span className="mnt-phone-only">问题单待接入</span><span className={`mnt-release-package mnt-pc-only ${release.package_summary?.status || 'none'}`}><Hammer size={13} aria-hidden />{packageText[release.package_summary?.status || 'none']}</span><Link className="mnt-text-link" aria-label={`查看 ${release.version} 的发布说明`} onClick={rememberScroll} state={{ maintainerFrom: from }} to={`/releases/${release.id}`}><FileText size={15} aria-hidden />发布说明<ArrowRight className="mnt-pc-only" size={13} aria-hidden /></Link></div>
              </li>)}
            </ul>
            <div className="mnt-pagination"><span>共 {data.total} 个版本</span><Pagination current={page} pageSize={6} total={data.total} showSizeChanger={false} size="small" responsive onChange={(next) => { const nextParams = new URLSearchParams(params); nextParams.set('page', String(next)); setParams(nextParams); }} /><small>6条 / 页</small></div>
          </>}
      </section>

      <aside className="mnt-aside">
        <section className="mnt-package-panel">
          <div className="mnt-title-row"><h2>打包近况</h2><Link className="mnt-text-link" to="/packages">查看全部 <ArrowRight size={13} aria-hidden /></Link></div><p className="mnt-panel-description">所属项目的最近任务</p>
          {summary.isPending ? <Skeleton active paragraph={{ rows: 3 }} /> : summary.isError ? <p className="mnt-aside-empty">总览暂不可用，请重试</p> : !summary.data?.recent_tasks.length ? <p className="mnt-aside-empty">暂无打包任务</p> : <ul>{summary.data.recent_tasks.map((task) => <li key={task.id}><Link to={`/packages/${task.id}`} className="mnt-task-item">
            <div><span className={`mnt-task-dot ${task.status}`} /><strong>{task.component_name}</strong><span className={`mnt-task-badge ${task.status}`}>{task.status_display}</span></div>
            <div className="mnt-task-meta"><span>{task.version || '未关联版本'} · {task.trigger_source === 'auto_release' ? '自动' : task.trigger_source === 'manual_release' ? '手动' : task.trigger_source === 'manual_branch' ? '分支' : '打包'}{task.artifact_count > 0 ? ` · ${task.artifact_count} 个产物` : ''}</span><span>{taskMeta(task)}</span></div>
          </Link></li>)}</ul>}
          <p className="mnt-package-footer">日志、产物在任务详情中查看</p>
        </section>
        <section className="mnt-attention-panel">
          <div className="mnt-title-row"><h2>问题反馈</h2><span className="mnt-count">待接入</span></div>
          <p className="mnt-panel-description">版本关联的问题反馈</p>
          <div className="mnt-attention-empty"><MessageSquareText size={22} strokeWidth={1.3} /><p>第三方问题反馈尚未接入</p><small>接入后展示版本关联的问题与处理进展</small></div>
        </section>
      </aside>
    </div>
  </div>;
}
