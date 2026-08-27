import { useQuery } from '@tanstack/react-query';
import { ChevronRight, GitPullRequestArrow } from 'lucide-react';
import dayjs from 'dayjs';
import { workflowApi } from '@/api/workflow';
import { instanceStatusMap, releaseTypeText } from '../constants';
import { ApprovalTimeline } from './ApprovalTimeline';
import { ApprovalActions } from './ApprovalActions';
import { ReleaseSummary } from './ReleaseSummary';
import { ReleaseDocCard } from './ReleaseDocCard';
import type { DetailSource } from '../types';
import type { ReleaseType } from '@/types';

interface ApprovalDetailViewProps {
  source: DetailSource;
  onBack: () => void;
}

/** 审批详情视图：面包屑 + 左主区（审批头/流程/意见）+ 右侧摘要 */
export function ApprovalDetailView({ source, onBack }: ApprovalDetailViewProps) {
  const { data: instance, isLoading } = useQuery({
    queryKey: ['workflow-instance-for-detail', source.instanceId],
    queryFn: () => workflowApi.getInstance(source.instanceId),
    enabled: !!source.instanceId,
  });

  const statusInfo = instanceStatusMap[instance?.status || 'running'] || instanceStatusMap.running;
  const isRunning = instance?.status === 'running';
  const detailSource: DetailSource = {
    ...source,
    title: instance?.title || source.title,
    version: instance?.version || source.version,
    releaseType: (instance?.release_type as ReleaseType | undefined) || source.releaseType,
    branch: instance?.branch || source.branch,
    packageStatus: instance?.package_status || source.packageStatus,
    applicant: instance?.applicant || source.applicant,
    projectName: instance?.project_name || source.projectName,
    submitTime: instance?.submit_time || source.submitTime,
    currentNode: instance?.current_node || source.currentNode,
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
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
                  <span className="font-medium text-slate-700">{detailSource.projectName || '-'}</span>
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

          {/* 流程节点 */}
          <div className="tech-card rounded-xl p-5">
            <h3 className="mb-4 text-[15px] font-semibold tracking-tight text-slate-900">审批流程</h3>
            {isLoading ? (
              <div className="py-6 text-center text-[13px] text-slate-400">加载中…</div>
            ) : instance ? (
              <ApprovalTimeline instance={instance} />
            ) : (
              <div className="py-6 text-center text-[13px] text-slate-400">暂无流程数据</div>
            )}
          </div>

          {/* 变更文档 */}
          <ReleaseDocCard doc={instance?.release_doc} />

          {/* 审批意见 + 操作 */}
          <ApprovalActions source={detailSource} instance={instance ?? null} onBack={onBack} />
        </div>

        {/* 右侧信息 */}
        <ReleaseSummary source={detailSource} instance={instance ?? null} />
      </div>
    </div>
  );
}
