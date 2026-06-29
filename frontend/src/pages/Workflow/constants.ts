// 审批工作流相关的常量与共享类型

// 审批状态到展示状态/文案的映射
export const workflowStatusMap: Record<
  string,
  { status: 'success' | 'danger' | 'info' | 'warning'; text: string }
> = {
  approved: { status: 'success', text: '已通过' },
  rejected: { status: 'danger', text: '已驳回' },
  transferred: { status: 'info', text: '已转交' },
  rollbacked: { status: 'warning', text: '已回退' },
};

// 工作流页面 Tab 标识
export type TabKey = 'todo' | 'done';

// 工作流页面 Tab 配置
export const tabItems: { key: TabKey; label: string }[] = [
  { key: 'todo', label: '我的待办' },
  { key: 'done', label: '我的已办' },
];
