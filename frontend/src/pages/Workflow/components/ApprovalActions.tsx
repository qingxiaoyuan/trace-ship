import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Forward, Undo2 as RollbackIcon, X } from 'lucide-react';
import { Select, Button } from 'antd';
import dayjs from 'dayjs';
import { workflowApi } from '@/api/workflow';
import { accountApi } from '@/api/account';
import { useAppMessage } from '@/hooks/useAppMessage';
import { workflowStatusMap } from '../constants';
import { StatusTag } from '@/components/StatusTag';
import type { DetailSource } from '../types';
import type { AccountUser } from '@/api/account';
import type { WorkflowInstance, WorkflowTask } from '@/types';

interface ApprovalActionsProps {
  source: DetailSource;
  instance: WorkflowInstance | null;
  onBack: () => void;
}

/** 审批意见历史 */
function ApprovalHistory({ tasks }: { tasks: WorkflowTask[] }) {
  const getTaskTime = (t: WorkflowTask) =>
    new Date(t.action_time || t.created_at || t.submit_time || 0).getTime();
  const history = (tasks || [])
    .filter((t) => t.status !== 'pending')
    .sort((a, b) => getTaskTime(b) - getTaskTime(a));

  if (!history.length) {
    return <div className="text-[12px] text-slate-400">暂无审批意见</div>;
  }

  return (
    <div className="space-y-3">
      {history.map((item) => {
        const action = workflowStatusMap[item.status];
        return (
          <div key={item.id} className="flex items-start gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[11px] font-semibold text-indigo-600">
              {(item.approver_name || item.approver_username || 'U').charAt(0)}
            </div>
            <div className="flex-1 rounded-lg border border-indigo-100 bg-white p-3">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-slate-900">
                  {item.approver_name || item.approver_username || '-'}
                </span>
                {action ? <StatusTag status={action.status}>{action.text}</StatusTag> : null}
              </div>
              {item.comment ? (
                <div className="mt-1 text-[12px] text-slate-600">{item.comment}</div>
              ) : null}
              {item.action_time ? (
                <div className="mt-1.5 text-[10px] text-slate-400 max-md:text-xs">
                  {dayjs(item.action_time).format('MM-DD HH:mm')}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 审批意见区：历史 + 操作（通过 / 驳回 / 转交 / 回退） */
export function ApprovalActions({ source, instance, onBack }: ApprovalActionsProps) {
  const queryClient = useQueryClient();
  const { message } = useAppMessage();
  const [comment, setComment] = useState('');
  const [toUserId, setToUserId] = useState('');
  const [transferMode, setTransferMode] = useState(false);
  const [rollbackMode, setRollbackMode] = useState(false);

  const taskId = source.taskId;
  const canApprove = !source.readOnly && !!taskId;

  // 回退：当前节点不是第一个审批节点时才允许
  const approvalNodes = (instance?.graph_data?.nodes || []).filter(
    (n) => n.type === 'approval-node',
  );
  const currentNodeIndex = approvalNodes.findIndex((n) => n.id === instance?.current_node_id);
  const canRollback = currentNodeIndex > 0;

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
  const rollbackMutation = useMutation({
    mutationFn: (c: string) => workflowApi.rollbackTask(taskId!, { comment: c }),
    onSuccess: () => onDone('回退成功'),
  });

  const resetModes = () => {
    setTransferMode(false);
    setRollbackMode(false);
  };

  return (
    <div className="tech-card rounded-xl p-5">
      <h3 className="mb-4 text-[15px] font-semibold tracking-tight text-slate-900">审批意见</h3>
      <ApprovalHistory tasks={instance?.tasks || []} />

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
            ) : rollbackMode ? (
              <>
                <Button onClick={() => setRollbackMode(false)}>取消</Button>
                <Button
                  icon={<RollbackIcon className="h-3.5 w-3.5" strokeWidth={1.5} />}
                  style={{ color: '#F59E0B', borderColor: '#F59E0B' }}
                  onClick={() => {
                    rollbackMutation.mutate(comment);
                    resetModes();
                  }}
                >
                  确认回退
                </Button>
              </>
            ) : (
              <>
                <Button
                  icon={<Forward className="h-3.5 w-3.5" strokeWidth={1.5} />}
                  onClick={() => setTransferMode(true)}
                >
                  转交
                </Button>
                <Button
                  danger
                  icon={<X className="h-3.5 w-3.5" strokeWidth={1.5} />}
                  onClick={() => rejectMutation.mutate(comment)}
                >
                  驳回
                </Button>
                {canRollback ? (
                  <Button
                    icon={<RollbackIcon className="h-3.5 w-3.5" strokeWidth={1.5} />}
                    onClick={() => setRollbackMode(true)}
                  >
                    回退
                  </Button>
                ) : null}
                <button
                  type="button"
                  onClick={() => approveMutation.mutate(comment)}
                  className="btn-glow ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white"
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                  通过
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
