import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ChevronRight, GitBranch, Rocket } from 'lucide-react';
import dayjs from 'dayjs';
import { workflowApi } from '@/api/workflow';
import { getAvatarColor } from '@/utils/avatar';
import { PermissionAlert } from '@/components/PermissionAlert';
import { tabItems, releaseTypeText, releaseTypeBadge, instanceStatusMap, workflowStatusMap } from '../constants';
import type { TabKey } from '../constants';
import type { DetailSource } from '../types';
import type { WorkflowTask, WorkflowInstanceListItem, ReleaseType } from '@/types';

interface ApprovalListViewProps {
  onOpenDetail: (src: DetailSource) => void;
}

/** 将列表行统一构造为详情数据来源 */
function toDetail(
  row: WorkflowTask | WorkflowInstanceListItem,
  tab: TabKey,
): DetailSource {
  // instance 列表项的 id 即实例 ID；task 的 instance 字段为实例 ID
  const isInstance = tab === 'initiated';
  const instanceId = isInstance
    ? (row as WorkflowInstanceListItem).id
    : (row as WorkflowTask).instance || '';
  return {
    instanceId,
    taskId: isInstance ? undefined : (row as WorkflowTask).id,
    title: row.title,
    version: row.version,
    releaseType: row.release_type as ReleaseType | undefined,
    branch: row.branch,
    packageStatus: (row as WorkflowTask).package_status,
    applicant: row.applicant,
    projectName: row.project_name,
    softwareName: row.repository_name || '',
    submitTime: row.submit_time,
    currentNode: row.current_node,
    mode: (row as WorkflowTask).mode,
    readOnly: tab !== 'todo',
  };
}

const taskBadgeTone = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  danger: 'border-rose-200 bg-rose-50 text-rose-600',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  info: 'border-slate-200 bg-slate-50 text-slate-500',
};

/** 流程状态与个人处理结果分开解释，结束流程没有当前节点。 */
function rowProgress(row: WorkflowTask | WorkflowInstanceListItem, tab: TabKey) {
  const isInstance = tab === 'initiated';
  const instanceState = isInstance ? instanceStatusMap[row.status] : undefined;
  const taskState = !isInstance ? workflowStatusMap[row.status] : undefined;
  const running = isInstance ? row.status === 'running' : row.status === 'pending';
  return {
    text: instanceState?.text || taskState?.text || '状态未知',
    badge: instanceState?.badge || (taskState ? taskBadgeTone[taskState.status] : taskBadgeTone.info),
    node: isInstance ? (running ? row.current_node || '当前节点未记录' : '') : row.current_node || '',
    running,
  };
}

function RowProgress({ value }: { value: ReturnType<typeof rowProgress> }) {
  return <div className="min-w-0 space-y-1">
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium max-md:text-xs ${value.badge}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full bg-current ${value.running ? 'pulse-dot' : ''}`} />{value.text}
    </span>
    {value.node ? <p className="truncate text-[12px] leading-5 text-slate-500" title={value.node}>{value.node}</p> : null}
  </div>;
}

/** 审批中心列表视图：标题区 + Tab + 列表 */
export function ApprovalListView({ onOpenDetail }: ApprovalListViewProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('todo');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const enabled = { todo: activeTab === 'todo', initiated: activeTab === 'initiated', done: activeTab === 'done' };

  const todoQuery = useQuery({
    queryKey: ['workflow-todo', page, pageSize],
    queryFn: () => workflowApi.getTodoTasks({ page, page_size: pageSize }),
    enabled: enabled.todo,
  });
  const initiatedQuery = useQuery({
    queryKey: ['workflow-initiated', page, pageSize],
    queryFn: () => workflowApi.getInitiatedInstances({ page, page_size: pageSize }),
    enabled: enabled.initiated,
  });
  const doneQuery = useQuery({
    queryKey: ['workflow-done', page, pageSize],
    queryFn: () => workflowApi.getDoneTasks({ page, page_size: pageSize }),
    enabled: enabled.done,
  });

  const activeQuery = activeTab === 'todo' ? todoQuery : activeTab === 'initiated' ? initiatedQuery : doneQuery;
  const results = (activeQuery.data?.results || []) as Array<WorkflowTask | WorkflowInstanceListItem>;
  const total = activeQuery.data?.total || 0;
  const loading = activeQuery.isLoading;

  const switchTab = (key: TabKey) => {
    setActiveTab(key);
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      {/* 标题区 */}
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">审批中心</h1>
        <p className="mt-1 text-[13px] text-slate-500">处理发布审批任务，支持转交、驳回、回退</p>
      </div>

      {/* Tab 切换 */}
      <div className="flex w-fit items-center gap-1 rounded-lg border border-indigo-100 bg-indigo-50/40 p-0.5">
        {tabItems.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => switchTab(tab.key)}
            className={
              activeTab === tab.key
                ? 'rounded-md bg-white px-3 py-1.5 text-[12px] font-medium text-indigo-600 shadow-sm'
                : 'rounded-md px-3 py-1.5 text-[12px] font-medium text-slate-500 transition-colors hover:text-slate-700'
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      <PermissionAlert error={activeQuery.error} className="rounded-xl" />

      {/* 列表卡片 */}
      <div className="tech-card overflow-hidden rounded-xl">
        {/* 表头 */}
        <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
          <div className="col-span-3">标题</div>
          <div className="col-span-2">项目</div>
          <div className="col-span-2">软件</div>
          <div className="col-span-1">申请人</div>
          <div className="col-span-2">{activeTab === 'initiated' ? '流程状态 / 当前节点' : activeTab === 'todo' ? '任务状态 / 审批节点' : '处理结果 / 审批节点'}</div>
          <div className="col-span-1">提交时间</div>
          <div className="col-span-1 text-right">操作</div>
        </div>

        {/* 行 */}
        <div className="divide-y divide-indigo-50/50 max-md:divide-y-0 max-md:space-y-3 max-md:p-3">
          {loading ? (
            <div className="px-5 py-10 text-center text-[13px] text-slate-400">加载中…</div>
          ) : results.length === 0 ? (
            <div className="px-5 py-10 text-center text-[13px] text-slate-400">暂无数据</div>
          ) : (
            results.map((row) => {
              const progress = rowProgress(row, activeTab);
              const applicantLabel = row.applicant || '-';
              return (
                <div
                  key={row.id}
                  data-workflow-id={row.id}
                  onClick={() => onOpenDetail(toDetail(row, activeTab))}
                  className="cursor-pointer transition-colors hover:bg-indigo-50/30 max-md:rounded-xl max-md:border max-md:border-indigo-100/70 max-md:bg-white max-md:p-4"
                >
                  {/* 桌面端网格行 */}
                  <div className="hidden grid-cols-12 items-center gap-3 px-5 py-3.5 md:grid">
                    <div className="col-span-12 flex items-center gap-2.5 md:col-span-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg icon-indigo">
                        <Rocket className="h-4 w-4" strokeWidth={1.5} />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium text-slate-900">
                          {row.title}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          发布审批{row.release_type ? ` · ${releaseTypeText[row.release_type as ReleaseType]}` : ''}
                        </div>
                      </div>
                    </div>
                    <div className="col-span-6 truncate text-[12px] text-slate-600 md:col-span-2">
                      {row.project_name || '-'}
                    </div>
                    <div className="col-span-6 truncate text-[12px] text-slate-600 md:col-span-2" title={row.repository_name || ''}>
                      {row.repository_name || '-'}
                    </div>
                    <div className="col-span-6 flex items-center gap-1.5 md:col-span-1">
                      <span
                        className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                        style={{ background: getAvatarColor(row.applicant) }}
                      >
                        {(row.applicant || 'U').charAt(0)}
                      </span>
                      <span className="text-[12px] text-slate-600">{row.applicant || '-'}</span>
                    </div>
                    <div className="col-span-6 min-w-0 md:col-span-2"><RowProgress value={progress} /></div>
                    <div className="col-span-6 text-[12px] text-slate-500 md:col-span-1">
                      {row.submit_time ? dayjs(row.submit_time).format('MM-DD HH:mm') : '-'}
                    </div>
                    <div className="col-span-6 flex items-center justify-end md:col-span-1">
                      <ArrowRight className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />
                    </div>
                  </div>

                  {/* 移动端卡片（参考 docs/ui/mobile/mobile-release.html） */}
                  <div className="md:hidden">
                    <div className="flex items-start justify-between gap-2">
                      <RowProgress value={progress} />
                      {row.release_type ? (
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${releaseTypeBadge[row.release_type as ReleaseType]}`}>
                          {releaseTypeText[row.release_type as ReleaseType]}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 min-w-0 space-y-1">
                      <p className="truncate text-[15px] font-semibold tracking-tight text-slate-900">
                        {row.title}
                      </p>
                      <p className="truncate text-[12px] text-slate-400">
                        {[row.project_name, row.repository_name].filter(Boolean).join(' · ') || '-'}
                      </p>
                    </div>
                    {row.branch ? (
                      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                        <GitBranch className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                        <span className="truncate font-mono">{row.branch}</span>
                      </div>
                    ) : null}
                    <div className="mt-3 flex items-center justify-between border-t border-indigo-50 pt-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold text-white"
                          style={{ background: getAvatarColor(row.applicant) }}
                        >
                          {(row.applicant || 'U').charAt(0)}
                        </span>
                        <span className="truncate text-[12px] text-slate-500">
                          {applicantLabel} · {row.submit_time ? dayjs(row.submit_time).format('MM-DD HH:mm') : '-'}
                        </span>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" strokeWidth={1.5} />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 分页 */}
        {total > 0 ? (
          <div className="flex items-center justify-between border-t border-indigo-50 px-5 py-3 text-[12px] text-slate-500">
            <span>共 {total} 条</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-md border border-slate-200 px-2 py-1 text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 max-md:px-3 max-md:py-2"
              >
                上一页
              </button>
              <span className="text-slate-600">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-slate-200 px-2 py-1 text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 max-md:px-3 max-md:py-2"
              >
                下一页
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
