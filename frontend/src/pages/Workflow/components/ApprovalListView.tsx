import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Rocket } from 'lucide-react';
import dayjs from 'dayjs';
import { workflowApi } from '@/api/workflow';
import { getAvatarColor } from '@/utils/avatar';
import { tabItems, releaseTypeText } from '../constants';
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
    sourceBranch: row.source_branch,
    targetBranch: (row as WorkflowTask).target_branch,
    buildNumber: (row as WorkflowTask).build_number,
    applicant: row.applicant,
    projectName: row.project_name,
    submitTime: row.submit_time,
    currentNode: row.current_node,
    mode: (row as WorkflowTask).mode,
    readOnly: tab !== 'todo',
  };
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

      {/* 列表卡片 */}
      <div className="tech-card overflow-hidden rounded-xl">
        {/* 表头 */}
        <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
          <div className="col-span-3">标题</div>
          <div className="col-span-2">项目</div>
          <div className="col-span-2">申请人</div>
          <div className="col-span-2">当前节点</div>
          <div className="col-span-2">提交时间</div>
          <div className="col-span-1 text-right">操作</div>
        </div>

        {/* 行 */}
        <div className="divide-y divide-indigo-50/50">
          {loading ? (
            <div className="px-5 py-10 text-center text-[13px] text-slate-400">加载中…</div>
          ) : results.length === 0 ? (
            <div className="px-5 py-10 text-center text-[13px] text-slate-400">暂无数据</div>
          ) : (
            results.map((row) => {
              const active = activeTab !== 'done';
              return (
                <div
                  key={row.id}
                  onClick={() => onOpenDetail(toDetail(row, activeTab))}
                  className="grid cursor-pointer grid-cols-12 items-center gap-3 px-5 py-3.5 transition-colors hover:bg-indigo-50/30"
                >
                  <div className="col-span-12 flex items-center gap-2.5 md:col-span-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg icon-indigo">
                      <Rocket className="h-4 w-4" strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-slate-900">
                        {row.title}
                        {row.version ? <span className="font-mono"> {row.version}</span> : null}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        发布审批{row.release_type ? ` · ${releaseTypeText[row.release_type as ReleaseType]}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="col-span-6 truncate text-[12px] text-slate-600 md:col-span-2">
                    {row.project_name || '-'}
                  </div>
                  <div className="col-span-6 flex items-center gap-1.5 md:col-span-2">
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                      style={{ background: getAvatarColor(row.applicant) }}
                    >
                      {(row.applicant || 'U').charAt(0)}
                    </span>
                    <span className="text-[12px] text-slate-600">{row.applicant || '-'}</span>
                  </div>
                  <div className="col-span-6 md:col-span-2">
                    <span
                      className={
                        active
                          ? 'inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700'
                          : 'inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-500'
                      }
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-amber-500 pulse-dot' : 'bg-slate-400'}`} />
                      {row.current_node || '-'}
                    </span>
                  </div>
                  <div className="col-span-6 text-[12px] text-slate-500 md:col-span-2">
                    {row.submit_time ? dayjs(row.submit_time).format('MM-DD HH:mm') : '-'}
                  </div>
                  <div className="col-span-6 flex items-center justify-end md:col-span-1">
                    <ArrowRight className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />
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
                className="rounded-md border border-slate-200 px-2 py-1 text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
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
                className="rounded-md border border-slate-200 px-2 py-1 text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
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
