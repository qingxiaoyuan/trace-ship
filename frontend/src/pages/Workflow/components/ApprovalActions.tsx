import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Forward, MessageSquareText, Undo2 as RollbackIcon, X } from 'lucide-react';
import { Select, Button } from 'antd';
import dayjs from 'dayjs';
import { workflowApi } from '@/api/workflow';
import { accountApi } from '@/api/account';
import { useAppMessage } from '@/hooks/useAppMessage';
import { workflowStatusMap } from '../constants';
import type { DetailSource } from '../types';
import type { AccountUser } from '@/api/account';
import type { WorkflowInstance, WorkflowTask } from '@/types';

interface ApprovalActionsProps {
  source: DetailSource;
  instance: WorkflowInstance | null;
  onBack: () => void;
}

const historyActionIcons: Partial<Record<WorkflowTask['status'], typeof Check>> = {
  approved: Check,
  rejected: X,
  transferred: Forward,
  rollbacked: RollbackIcon,
  revoked: X,
  returned: RollbackIcon,
};
const historyActionTone = {
  success: 'text-emerald-600',
  danger: 'text-rose-500',
  info: 'text-slate-400',
  warning: 'text-amber-600',
};

/** 审批意见历史 */
function ApprovalHistory({ tasks, returnedBy }: { tasks: WorkflowTask[]; returnedBy?: string }) {
  const getTaskTime = (t: WorkflowTask) =>
    new Date(t.action_time || t.created_at || t.submit_time || 0).getTime();
  const history = (tasks || [])
    .filter((t) => t.status !== 'pending')
    .sort((a, b) => getTaskTime(b) - getTaskTime(a));

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <MessageSquareText className="h-4 w-4 text-slate-400" strokeWidth={1.5} aria-hidden="true" />
        <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">审批意见</h3>
        {history.length ? <span className="ml-auto text-xs tabular-nums text-slate-400">{history.length} 条处理记录</span> : null}
      </div>
      {!history.length ? <div className="text-[12px] text-slate-400">暂无审批意见</div> : (
        <div className="overflow-hidden rounded-lg border border-slate-200/80">
          <div className="hidden grid-cols-[minmax(140px,1fr)_88px_minmax(0,1.5fr)_90px] gap-x-4 border-b border-slate-200/70 bg-slate-50/80 px-4 py-2.5 text-xs font-medium text-slate-500 xl:grid" aria-hidden="true">
            <span>审批人</span><span>处理结果</span><span>审批意见</span><span className="text-right">处理时间</span>
          </div>
          <ol className="divide-y divide-slate-100">
            {history.map((item) => {
              const action = workflowStatusMap[item.status];
              const ActionIcon = historyActionIcons[item.status];
              const approver = item.status === 'returned' && returnedBy ? returnedBy : item.approver_name || item.approver_username || '-';
              return (
                <li key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-3 xl:grid-cols-[minmax(140px,1fr)_88px_minmax(0,1.5fr)_90px] xl:gap-x-4 xl:px-4">
                  <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2.5 xl:row-span-1">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-medium text-slate-500" aria-hidden="true">{approver.charAt(0)}</span>
                    <span className="break-words text-[13px] font-medium leading-5 text-slate-800 [overflow-wrap:anywhere]">{approver}</span>
                  </div>
                  <div className="col-start-2 row-start-1">
                    {action && ActionIcon ? (
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-600">
                        <ActionIcon className={`h-3.5 w-3.5 ${historyActionTone[action.status]}`} strokeWidth={1.8} aria-hidden="true" />
                        {action.text}
                      </span>
                    ) : null}
                  </div>
                  <div className="col-span-2 col-start-1 row-start-3 min-w-0 max-xl:pl-[42px] xl:col-span-1 xl:col-start-3 xl:row-start-1">
                    {item.comment ? (
                      <p className="whitespace-pre-wrap text-[13px] leading-6 text-slate-600 [overflow-wrap:anywhere]">{item.comment}</p>
                    ) : <span className="hidden text-slate-300 xl:inline" aria-label="未填写意见">—</span>}
                  </div>
                  <div className="col-start-1 row-start-2 pl-[42px] leading-none xl:col-start-4 xl:row-start-1 xl:pl-0 xl:text-right">
                    {item.action_time ? (
                      <time className="text-xs tabular-nums text-slate-400" dateTime={item.action_time} title={dayjs(item.action_time).format('YYYY-MM-DD HH:mm:ss')}>
                        {dayjs(item.action_time).format('MM-DD HH:mm')}
                      </time>
                    ) : <span className="hidden text-xs text-slate-300 xl:inline" aria-label="处理时间未记录">—</span>}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </>
  );
}

/** 审批意见区：历史 + 操作（通过 / 驳回 / 转交） */
export function ApprovalActions({ source, instance, onBack }: ApprovalActionsProps) {
  const queryClient = useQueryClient();
  const { message } = useAppMessage();
  const [comment, setComment] = useState('');
  const [toUserId, setToUserId] = useState('');
  const [transferMode, setTransferMode] = useState(false);

  const taskId = source.taskId;
  const canApprove = !source.readOnly && !!taskId && instance?.tasks?.some((task) => task.id === taskId && task.can_act === true);
  const { data: usersData } = useQuery({
    queryKey: ['users-for-transfer'],
    queryFn: () => accountApi.getUsers({ page_size: 1000 }),
    enabled: transferMode,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['workflow-todo'] });
    queryClient.invalidateQueries({ queryKey: ['workflow-done'] });
    queryClient.invalidateQueries({ queryKey: ['workflow-initiated'] });
    queryClient.invalidateQueries({ queryKey: ['workflow-stats'] });
    queryClient.invalidateQueries({ queryKey: ['workflow-history'] });
  };

  const onDone = (msg: string) => {
    message.success(msg);
    invalidateAll();
    onBack();
  };

  const approveMutation = useMutation({
    mutationFn: (c: string) => workflowApi.approveTask(taskId!, { comment: c }),
    onSuccess: () => onDone('审批通过'),
  });
  const rejectMutation = useMutation({
    mutationFn: (c: string) => workflowApi.rejectTask(taskId!, { comment: c }),
    onSuccess: () => onDone('审批驳回'),
  });
  const transferMutation = useMutation({
    mutationFn: (vars: { toUserId: string; comment: string }) =>
      workflowApi.transferTask(taskId!, { to_user_id: vars.toUserId, comment: vars.comment }),
    onSuccess: () => onDone('转交成功'),
  });
  const resetModes = () => {
    setTransferMode(false);
  };

  return (
    <section aria-label="审批意见" className="border-t border-slate-100 pt-6">
      <ApprovalHistory tasks={instance?.tasks || []} returnedBy={instance?.returned_by_name} />

      {canApprove ? (
        <div className="mt-4 border-t border-indigo-50 pt-4">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="请输入审批意见…"
            rows={3}
            className="w-full resize-none rounded-lg border border-indigo-100 bg-white px-3 py-2.5 text-[13px] text-slate-700 placeholder-slate-400 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
          <div className="mt-3 flex items-center gap-2 max-md:flex-wrap">
            {transferMode ? (
              <>
                <Select
                  placeholder="选择转交人"
                  className="w-full sm:w-[180px]"
                  value={toUserId || undefined}
                  onChange={setToUserId}
                  options={(usersData?.results || []).map((u: AccountUser) => ({
                    value: u.id,
                    label: `${u.nickname || u.username} (${u.username})`,
                  }))}
                />
                <Button onClick={() => setTransferMode(false)}>取消</Button>
                <Button
                  icon={<Forward className="h-3.5 w-3.5" strokeWidth={1.5} />}
                  disabled={!toUserId}
                  onClick={() => {
                    transferMutation.mutate({ toUserId, comment });
                    resetModes();
                  }}
                >
                  确认转交
                </Button>
              </>
            ) : (
              <>
                {canApprove ? <Button
                  icon={<Forward className="h-3.5 w-3.5" strokeWidth={1.5} />}
                  onClick={() => setTransferMode(true)}
                >
                  转交
                </Button> : null}
                {canApprove ? <Button
                  danger
                  icon={<X className="h-3.5 w-3.5" strokeWidth={1.5} />}
                  onClick={() => rejectMutation.mutate(comment)}
                >
                  驳回
                </Button> : null}
                {canApprove ? <button
                  type="button"
                  onClick={() => approveMutation.mutate(comment)}
                  className="btn-glow ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white"
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                  通过
                </button> : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
