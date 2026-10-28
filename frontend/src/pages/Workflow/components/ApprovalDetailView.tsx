import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, GitPullRequestArrow } from 'lucide-react';
import dayjs from 'dayjs';
import { workflowApi } from '@/api/workflow';
import { WorkflowTerminateButton } from '@/components/WorkflowTerminateButton';
import { WorkflowHistory } from '@/components/WorkflowHistory';
import { usePageMetaStore } from '@/stores/pageMetaStore';
import { useAuthStore } from '@/stores/authStore';
import { recordVisit } from '@/hooks/useRecentVisits';
import { instanceStatusMap, releaseTypeText } from '../constants';
import { ApprovalTimeline } from './ApprovalTimeline';
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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* 左侧主区域 */}
        <div className="space-y-5 lg:col-span-2">
          {/* 审批头 */}
          <div className="tech-card rounded-xl p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl icon-amber">
                <GitPullRequestArrow className="h-6 w-6" strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-[20px] font-semibold tracking-tight text-slate-900">
                    {detailSource.title}
                    {detailSource.version ? <span className="font-mono"> {detailSource.version}</span> : null}
                  </h1>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${statusInfo.badge}`}
                  >
                    {isRunning ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 pulse-dot" />
                    ) : null}
                    {statusInfo.text}
                  </span>
                  <WorkflowTerminateButton instance={instance} />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
                  <span className="font-medium text-slate-700">{detailSource.projectName || '-'}</span>
                  <span className="h-1 w-1 rounded-full bg-slate-300" />
                  <span className="font-medium text-slate-700">{detailSource.softwareName || '-'}</span>
                  <span className="h-1 w-1 rounded-full bg-slate-300" />
                  <span>
                    {detailSource.releaseType ? releaseTypeText[detailSource.releaseType as ReleaseType] + '发布' : '发布审批'}
                  </span>
                  <span className="h-1 w-1 rounded-full bg-slate-300" />
                  <span>申请人 {detailSource.applicant || '-'}</span>
                  <span className="h-1 w-1 rounded-full bg-slate-300" />
                  <span>提交于 {detailSource.submitTime ? dayjs(detailSource.submitTime).format('MM-DD HH:mm') : '-'}</span>
                </div>
              </div>
            </div>
            {/* 分支 / 打包状态 小信息栏 */}
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-indigo-50 pt-4 md:grid-cols-3">
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-slate-500">分支</span>
                <span className="font-mono text-[12px] font-semibold text-slate-900">
                  {detailSource.branch || '-'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-slate-500">打包状态</span>
                <span className="font-mono text-[12px] font-semibold text-slate-900">
                  {detailSource.packageStatus || '-'}
                </span>
              </div>
            </div>
          </div>

          {instance?.biz_type === 'release' ? <WorkflowHistory releaseId={instance.biz_id} /> : null}
          {instance && !instance.has_config_snapshot ? (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">历史流程没有保存提审时的配置快照，不能还原当时配置。</div>
          ) : null}
          {instance && !instance.is_current && !isRunning ? (
            <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">这是历史审批记录，发布摘要显示的是当前申请信息。</div>
          ) : null}

          {/* 流程节点 */}
          <div className="tech-card rounded-xl p-5">
            <h3 className="mb-4 text-[15px] font-semibold tracking-tight text-slate-900">审批流程</h3>
            {instance ? (
              <ApprovalTimeline instance={instance} />
            ) : (
              <div className="py-6 text-center text-[13px] text-slate-400">暂无流程数据</div>
            )}
          </div>

          {/* 变更文档 */}
          {instance && (instance.is_current || isRunning) ? <ReleaseDocCard doc={instance.release_doc} /> : null}
          {instance?.biz_type === 'release' ? <ReviewScope key={instance.id} instanceId={instance.id} /> : null}
          {instance?.biz_type === 'release' ? <AiReviewReport key={`ai-${instance.id}`} instanceId={instance.id} /> : null}

          {/* 审批意见 + 操作 */}
          <ApprovalActions source={detailSource} instance={instance ?? null} onBack={onBack} />
        </div>

        {/* 右侧信息 */}
        <ReleaseSummary source={detailSource} instance={instance ?? null} />
      </div>
    </div>
  );
}
