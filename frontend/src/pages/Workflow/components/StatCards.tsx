import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, GitPullRequestArrow, XCircle } from 'lucide-react';
import { workflowApi } from '@/api/workflow';

/** 统计卡片配置 */
const cards = [
  {
    key: 'todo',
    label: '待我审批',
    icon: GitPullRequestArrow,
    iconClass: 'icon-amber',
  },
  {
    key: 'initiated',
    label: '我发起的',
    icon: Clock,
    iconClass: 'icon-cyan',
  },
  {
    key: 'approved',
    label: '已通过',
    icon: CheckCircle2,
    iconClass: 'icon-emerald',
  },
  {
    key: 'rejected',
    label: '已驳回',
    icon: XCircle,
    iconClass: 'icon-rose',
  },
] as const;

/** 审批中心顶部统计卡片区 */
export function StatCards() {
  // 待我审批总数
  const { data: todoData } = useQuery({
    queryKey: ['workflow-stats', 'todo'],
    queryFn: () => workflowApi.getTodoTasks({ page: 1, page_size: 1 }),
  });
  // 我发起的进行中实例数
  const { data: initiatedData } = useQuery({
    queryKey: ['workflow-stats', 'initiated'],
    queryFn: () => workflowApi.getInitiatedInstances({ status: 'running', page: 1, page_size: 1 }),
  });
  // 已办任务（本地按状态计数已通过 / 已驳回）
  const { data: doneData } = useQuery({
    queryKey: ['workflow-stats', 'done'],
    queryFn: () => workflowApi.getDoneTasks({ page_size: 100 }),
  });

  const doneResults = doneData?.results || [];
  const counts: Record<string, number> = {
    todo: todoData?.total || 0,
    initiated: initiatedData?.total || 0,
    approved: doneResults.filter((t) => t.status === 'approved').length,
    rejected: doneResults.filter((t) => t.status === 'rejected').length,
  };

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div key={card.key} className="tech-card flex items-center gap-3 rounded-xl p-4">
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${card.iconClass}`}>
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.5} />
            </div>
            <div>
              <div className="font-mono text-[20px] font-semibold tracking-tight text-slate-900">
                {counts[card.key]}
              </div>
              <div className="text-[11px] text-slate-400">{card.label}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
