import { useEffect, useId, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, FileText, GitCompareArrows, Sparkles } from 'lucide-react';
import dayjs from 'dayjs';
import { workflowApi } from '@/api/workflow';
import { WorkflowTerminateButton } from '@/components/WorkflowTerminateButton';
import { WorkflowHistory } from '@/components/WorkflowHistory';
import { usePageMetaStore } from '@/stores/pageMetaStore';
import { useAuthStore } from '@/stores/authStore';
import { recordVisit } from '@/hooks/useRecentVisits';
import { instanceStatusMap, releaseTypeText } from '../constants';
import { ApprovalActions } from './ApprovalActions';
import { ReleaseSummary } from './ReleaseSummary';
import { ReleaseDocCard } from './ReleaseDocCard';
import { ReviewScope } from './ReviewScope';
import { AiReviewReport } from './AiReviewReport';
import type { DetailSource } from '../types';
import type { ReleaseType } from '@/types';
import type { NormalizedError } from '@/api/request';

interface ApprovalDetailViewProps {
  source: DetailSource;
  onBack: () => void;
}

/** 审批详情视图：面包屑 + 左主区（审批头/流程/意见）+ 右侧摘要 */
export function ApprovalDetailView({ source, onBack }: ApprovalDetailViewProps) {
  const [activeTab, setActiveTab] = useState<'document' | 'review' | 'scope'>('document');
  const tabId = useId();
  const setEntityTitle = usePageMetaStore((state) => state.setEntityTitle);
  const sessionVersion = useAuthStore((state) => state.sessionVersion);
  const detail = useQuery({
    queryKey: ['workflow-instance-for-detail', source.instanceId, sessionVersion],
    queryFn: () => workflowApi.getInstance(source.instanceId),
    enabled: !!source.instanceId,
    retry: false,
    gcTime: 0,
  });
  const instance = detail.error ? undefined : detail.data;

  // 面包屑实体名 + 最近访问埋点（实例详情返回后触发）
  useEffect(() => {
    if (!instance) return;
    const title = instance.title || '发布审批';
    setEntityTitle(title);
    recordVisit({
      type: 'workflow',
      id: instance.id,
      title,
      subtitle: `审批 · ${[instance.project_name, instance.repository_name].filter(Boolean).join(' / ') || '-'}`,
      path: `/workflows/${instance.id}`,
    });
    return () => setEntityTitle(null);
  }, [instance, setEntityTitle]);

  if (detail.isLoading || (detail.isFetching && !detail.isFetchedAfterMount)) {
    return <div className="py-6 text-center text-sm text-slate-500">正在读取审批详情…</div>;
  }
  if (detail.error || !instance) {
    const error = detail.error as unknown as NormalizedError | null;
    return <div role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">
      审批详情读取失败：{error?.friendlyMessage || error?.message || '不存在或无权查看'}
      <button type="button" className="ml-2 underline" onClick={() => void detail.refetch()}>重试</button>
      <button type="button" className="ml-2 underline" onClick={onBack}>返回审批中心</button>
    </div>;
  }

  const statusInfo = instanceStatusMap[instance?.status || 'running'] || instanceStatusMap.running;
  const isRunning = instance?.status === 'running';
  const detailSource: DetailSource = {
    ...source,
    title: instance.title || '发布审批',
    version: instance.version || '',
    releaseType: instance.release_type as ReleaseType | undefined,
    branch: instance.branch || '',
    packageStatus: instance.package_status || '',
    applicant: instance.applicant || '',
    projectName: instance.project_name || '',
    softwareName: instance.repository_name || '',
    submitTime: instance.submit_time || '',
    currentNode: instance.current_node || '',
    mode: instance.tasks?.find((task) => task.id === source.taskId && task.can_act === true)?.mode,
    readOnly: !instance.tasks?.some((task) => task.id === source.taskId && task.can_act === true),
  };

  return (
    <div className="space-y-5">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-[13px]">
        <button
          type="button"
          onClick={onBack}
          className="text-slate-400 transition-colors hover:text-indigo-600"
        >
          审批中心
        </button>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" strokeWidth={1.5} />
        <span className="font-medium text-slate-800">{detailSource.title}</span>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="break-words text-[24px] font-semibold tracking-tight text-slate-900">{detailSource.title}{detailSource.version && !detailSource.title.includes(detailSource.version) ? <span className="font-mono"> {detailSource.version}</span> : null}</h1>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${statusInfo.badge}`}>{statusInfo.text}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-slate-500">
            <span>{detailSource.projectName || '-'}</span><span className="text-slate-300">/</span><span>{detailSource.softwareName || '-'}</span>
            <span className="text-slate-300">·</span><span>{detailSource.releaseType ? releaseTypeText[detailSource.releaseType as ReleaseType] + '发布' : '发布审批'}</span>
            <span className="text-slate-300">·</span><span>申请人 {detailSource.applicant || '-'}</span>
            <span className="text-slate-300">·</span><span>提交于 {detailSource.submitTime ? dayjs(detailSource.submitTime).format('MM-DD HH:mm') : '-'}</span>
          </div>
        </div>
        <WorkflowTerminateButton instance={instance} />
      </div>
      <div className="grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_285px]">
        <div className="min-w-0 space-y-5">
          {instance?.biz_type === 'release' ? <WorkflowHistory releaseId={instance.biz_id} /> : null}
          {instance && !instance.has_config_snapshot ? (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">历史流程没有保存提审时的配置快照，不能还原当时配置。</div>
          ) : null}
          {instance && !instance.is_current && !isRunning ? (
            <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">这是历史审批记录，发布摘要显示的是当前申请信息。</div>
          ) : null}

          <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/30">
            <div role="tablist" aria-label="审批详情" className="flex overflow-x-auto whitespace-nowrap border-b border-slate-100 px-3 sm:px-6">
              {([
                { key: 'document' as const, label: '变更文档与审批', icon: FileText },
                ...(instance.biz_type === 'release' ? [
                  { key: 'review' as const, label: 'AI 审查', icon: Sparkles },
                  { key: 'scope' as const, label: '审查范围', icon: GitCompareArrows },
                ] : []),
              ]).map(({ key, label, icon: Icon }, index, tabs) => (
                <button
                  key={key} type="button" role="tab" id={`${tabId}-${key}`} aria-selected={activeTab === key}
                  aria-controls={`${tabId}-${key}-panel`} tabIndex={activeTab === key ? 0 : -1}
                  onClick={() => setActiveTab(key)}
                  onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                    let next: number;
                    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
                    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
                    else if (event.key === 'Home') next = 0;
                    else if (event.key === 'End') next = tabs.length - 1;
                    else return;
                    event.preventDefault();
                    setActiveTab(tabs[next].key);
                    document.getElementById(`${tabId}-${tabs[next].key}`)?.focus();
                  }}
                  className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-4 text-sm focus-visible:outline-2 focus-visible:outline-indigo-500 ${activeTab === key ? 'border-indigo-600 font-medium text-indigo-700' : 'border-transparent text-slate-500 hover:text-indigo-600'}`}
                ><Icon className="h-4 w-4" strokeWidth={1.5} />{label}</button>
              ))}
            </div>
            <div id={`${tabId}-document-panel`} role="tabpanel" aria-labelledby={`${tabId}-document`} hidden={activeTab !== 'document'} className="space-y-6 p-5 sm:p-6">
              {instance.is_current || isRunning ? <ReleaseDocCard doc={instance.release_doc} /> : null}
              <ApprovalActions key={instance.id} source={detailSource} instance={instance} onBack={onBack} />
            </div>
            {instance.biz_type === 'release' ? <>
              <div id={`${tabId}-review-panel`} role="tabpanel" aria-labelledby={`${tabId}-review`} hidden={activeTab !== 'review'} className="min-w-0 p-5 sm:p-6"><AiReviewReport key={`ai-${instance.id}`} instanceId={instance.id} active={activeTab === 'review'} /></div>
              <div id={`${tabId}-scope-panel`} role="tabpanel" aria-labelledby={`${tabId}-scope`} hidden={activeTab !== 'scope'} className="min-w-0 p-5 sm:p-6">{activeTab === 'scope' ? <ReviewScope key={instance.id} instanceId={instance.id} /> : null}</div>
            </> : null}
          </section>
        </div>

        {/* 右侧信息 */}
        <ReleaseSummary source={detailSource} instance={instance ?? null} />
      </div>
    </div>
  );
}
