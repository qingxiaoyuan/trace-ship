import { useQuery } from '@tanstack/react-query';
import { workflowApi } from '@/api/workflow';

/**
 * 当前用户待审批任务数，驱动侧边栏「审批中心」徽标。
 * 接口未就绪或异常时返回 0（不显示徽标），60s 轮询一次。
 */
export function useWorkflowTodoCount(): number {
  const { data } = useQuery({
    queryKey: ['workflow-todo-count'],
    queryFn: () => workflowApi.getTodoCount(),
    refetchInterval: 60_000,
    retry: false,
  });
  return data?.count ?? 0;
}
