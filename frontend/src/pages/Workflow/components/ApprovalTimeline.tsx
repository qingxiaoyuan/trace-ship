import { Check, Tag, UserCheck } from 'lucide-react';
import dayjs from 'dayjs';
import type { LucideIcon } from 'lucide-react';
import type { WorkflowInstance, WorkflowTask } from '@/types';

/** 流程图节点（后端 _build_graph_data 生成的结构） */
interface GraphNode {
  id: string;
  type: string;
  text?: string | { value: string };
  properties?: Record<string, unknown>;
}

/** 节点审批人配置项（properties._approvers 的元素） */
interface ApproverConfig {
  type?: string;
  role?: string;
  user_id?: string;
}

/** 节点展示状态 */
type NodeState = 'done' | 'running' | 'pending';

/** 项目成员角色文案（与 WorkflowTab 的 ROLE_LABELS 对齐） */
const ROLE_LABELS: Record<string, string> = {
  developer: '开发人员',
  tester: '测试人员',
  manager: '项目管理员',
  auditor: '审核人',
  viewer: '只读人员',
};

/** 取节点名称：text 可能是字符串或 { value } */
function nodeName(node: GraphNode): string {
  const text = node.text;
  const raw = typeof text === 'string' ? text : text?.value || '';
  // 后端 approval 节点 text 形如 "技术负责人审批\n(会签)"，取首行
  return raw.split('\n')[0] || node.id;
}

/** 取节点审批模式 */
function nodeMode(node: GraphNode): 'any' | 'all' | undefined {
  return node.properties?.mode as 'any' | 'all' | undefined;
}

/** 节点尚未生成审批任务时，从配置的审批人（properties._approvers）推导展示文案 */
function configuredApproverText(node: GraphNode): string {
  const configs = (node.properties?._approvers || []) as ApproverConfig[];
  const labels = configs.map((config) => {
    if (config.type === 'leader') return '项目负责人';
    if (config.type === 'self') return '发起人';
    if (config.type === 'role') return ROLE_LABELS[config.role || ''] || config.role || '指定角色';
    return '指定用户';
  });
  return [...new Set(labels)].join('、');
}

/** 审批流程节点时间线 */
export function ApprovalTimeline({ instance }: { instance: WorkflowInstance }) {
  const nodes = (instance.graph_data?.nodes || []) as unknown as GraphNode[];
  const nodeStatus = instance.node_status || {};
  const tasks = instance.tasks || [];

  if (nodes.length === 0) return null;

  /** 判断单个节点状态 */
  const stateOf = (node: GraphNode): NodeState => {
    if (node.type === 'start-node') return 'done';
    if (node.type === 'end-node') {
      return instance.status === 'completed' ? 'done' : 'pending';
    }
    if (nodeStatus[node.id] === 'approved') return 'done';
    if (node.id === instance.current_node_id && instance.status === 'running') return 'running';
    return 'pending';
  };

  /** 取该节点的全部审批任务（会签/或签时一个审批人一条任务） */
  const tasksOf = (node: GraphNode): WorkflowTask[] =>
    tasks.filter((t) => t.node_id === node.id);

  return (
    <div className="space-y-0">
      {nodes.map((node, index) => {
        const state = stateOf(node);
        const isLast = index === nodes.length - 1;
        return (
          <TimelineNode
            key={node.id}
            name={nodeName(node)}
            state={state}
            mode={nodeMode(node)}
            tasks={tasksOf(node)}
            node={node}
            isLast={isLast}
            nodeType={node.type}
          />
        );
      })}
    </div>
  );
}

/** 单个时间线节点 */
function TimelineNode({
  name,
  state,
  mode,
  tasks,
  node,
  isLast,
  nodeType,
}: {
  name: string;
  state: NodeState;
  mode?: 'any' | 'all';
  tasks: WorkflowTask[];
  node: GraphNode;
  isLast: boolean;
  nodeType: string;
}) {
  const Icon: LucideIcon = nodeType === 'start-node' ? Check : nodeType === 'end-node' ? Tag : UserCheck;

  const dotClass = {
    done: 'bg-emerald-500 text-white',
    running: 'bg-amber-500 text-white pulse-dot ring-4 ring-amber-100',
    pending: 'border-2 border-slate-200 bg-white text-slate-300',
  }[state];

  const badge = {
    done: { text: nodeType === 'start-node' ? '已完成' : '已通过', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
    running: { text: '进行中', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
    pending: { text: '待处理', cls: 'border-slate-200 bg-slate-50 text-slate-400' },
  }[state];

  const nameClass = state === 'pending' ? 'text-slate-400' : state === 'running' ? 'text-amber-700' : 'text-slate-900';

  // 审批人展示：聚合该节点全部任务的审批人；尚无任务（未激活节点）时回退到配置的审批人
  const approverNames = [
    ...new Set(
      tasks
        .map((t) => t.approver_name || t.approver_username)
        .filter((n): n is string => Boolean(n)),
    ),
  ];
  const approverText = approverNames.length
    ? approverNames.join('、')
    : configuredApproverText(node) || '待分配审批人';
  const latestActionTime = tasks
    .map((t) => t.action_time)
    .filter((t): t is string => Boolean(t))
    .sort()
    .pop();

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`flex h-8 w-8 items-center justify-center rounded-full ${dotClass}`}>
          <Icon className="h-4 w-4" strokeWidth={state === 'done' ? 2 : 1.5} />
        </div>
        {!isLast ? <div className="mt-1 w-px flex-1 bg-indigo-100" /> : null}
      </div>
      <div className={`flex-1 ${isLast ? '' : 'pb-5'}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className={`text-[13px] font-medium ${nameClass}`}>{name}</div>
            <div className="mt-0.5 text-[11px] text-slate-400">
              {nodeType === 'approval-node'
                ? [
                    approverText,
                    mode ? (mode === 'all' ? '会签模式' : '或签模式') : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : nodeType === 'start-node'
                  ? '发起申请'
                  : '自动执行'}
            </div>
          </div>
          <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium max-md:text-xs ${badge.cls}`}>
            {badge.text}
          </span>
        </div>
        {latestActionTime ? (
          <div className="mt-0.5 text-[11px] text-slate-400">
            {dayjs(latestActionTime).format('MM-DD HH:mm')}
          </div>
        ) : null}
      </div>
    </div>
  );
}
