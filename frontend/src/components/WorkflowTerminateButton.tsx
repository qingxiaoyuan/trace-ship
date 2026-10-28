import { Button } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { workflowApi } from '@/api/workflow';
import { useAppMessage } from '@/hooks/useAppMessage';
import type { WorkflowInstance } from '@/types';

/** 发起人终止仍在运行的流程，能力由服务端按当前项目与实例判定。 */
export function WorkflowTerminateButton({ instance }: { instance?: WorkflowInstance | null }) {
  const queryClient = useQueryClient();
  const { message, modal } = useAppMessage();
  const terminate = useMutation({
    mutationFn: () => workflowApi.revokeInstance(instance!.id),
    onSuccess: (updated) => {
      queryClient.setQueryData(['workflow-instance-for-detail', updated.id], updated);
      for (const key of ['workflow-todo', 'workflow-done', 'workflow-initiated', 'workflow-stats',
        'workflow-todo-count', 'releases', 'dashboard-stats', 'dashboard-todos']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      if (updated.biz_type === 'release') {
        void queryClient.invalidateQueries({ queryKey: ['release', updated.biz_id] });
        void queryClient.invalidateQueries({ queryKey: ['workflow-history', updated.biz_id] });
      }
      message.success('流程已终止，发布申请已恢复草稿');
    },
  });

  if (instance?.status !== 'running' || instance.can_revoke !== true) return null;
  return <Button danger loading={terminate.isPending} onClick={() => modal.confirm({
    title: '终止发布流程',
    content: '终止后剩余审批待办失效，发布申请恢复为草稿。已处理的审批历史保留，可修改后重新提交。',
    okText: '确认终止', cancelText: '取消', okButtonProps: { danger: true },
    onOk: () => terminate.mutateAsync(),
  })}>终止流程</Button>;
}
