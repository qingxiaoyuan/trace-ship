import dayjs from 'dayjs';
import { StatusTag } from '@/components/StatusTag';
import { tokens } from '@/styles/theme';
import type { WorkflowTask } from '@/types';
import { workflowStatusMap } from '../constants';

// 审批历史列表，展示已处理过的审批节点
export function ApprovalHistory({ tasks }: { tasks: WorkflowTask[] }) {
  const getTaskTime = (task: WorkflowTask) =>
    new Date(task.action_time || task.created_at || task.submit_time || 0).getTime();
  const history = (tasks || [])
    .filter((t) => t.status !== 'pending')
    .sort((a, b) => getTaskTime(b) - getTaskTime(a));

  if (!history.length) return null;

  return (
    <div className="mt-6">
      <h4
        className="text-sm font-bold mb-3"
        style={{ color: tokens.colors.textPrimary }}
      >
        审批历史
      </h4>
      <div className="space-y-3">
        {history.map((item) => {
          const action = workflowStatusMap[item.status];
          return (
            <div
              key={item.id}
              className="p-3 rounded-lg border"
              style={{
                borderColor: tokens.colors.border,
                background: tokens.colors.bg,
              }}
            >
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{item.current_node}</span>
                  {action && <StatusTag status={action.status}>{action.text}</StatusTag>}
                  {item.status === 'rollbacked' && item.rollback_target_node_id && (
                    <span className="text-xs text-slate-500">
                      (回退至 {item.rollback_target_node_id})
                    </span>
                  )}
                </div>
                <span className="text-xs text-slate-400">
                  {item.action_time
                    ? dayjs(item.action_time).format('MM-DD HH:mm')
                    : '-'}
                </span>
              </div>
              <div className="mt-1 text-sm text-slate-600">
                审批人：{item.approver_name || item.approver_username || '-'}
                {item.transferred_from_name && (
                  <span className="text-slate-400 ml-1">
                    （由 {item.transferred_from_name} 转交）
                  </span>
                )}
              </div>
              {item.comment && (
                <div className="mt-2 text-sm text-slate-500 bg-slate-50 p-2 rounded">
                  {item.comment}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
