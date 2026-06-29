import { Check, GitPullRequestArrow, Rocket, Tag } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Release } from '@/types';

/** 流程节点状态 */
type NodeState = 'done' | 'running' | 'pending';

/** 发布流程节点定义：根据 release.status 判断每个节点状态 */
const flowNodes: {
  key: string;
  name: string;
  icon: LucideIcon;
  /** 根据发布状态计算该节点状态 */
  stateOf: (status: Release['status']) => NodeState;
  /** 节点副文案 */
  sub: (release: Release) => string;
}[] = [
  {
    key: 'create',
    name: '创建发布',
    icon: Rocket,
    stateOf: () => 'done',
    sub: (r) => `${r.publisher_name || r.publisher || '-'} · ${r.created_at ? new Date(r.created_at).toLocaleString('zh-CN', { hour12: false }).slice(5, 16) : '-'}`,
  },
  {
    key: 'doc',
    name: '生成发布说明',
    icon: Check,
    stateOf: (s) => (s === 'draft' ? 'running' : 'done'),
    sub: (r) => (r.release_doc ? '已生成' : '待生成'),
  },
  {
    key: 'audit',
    name: '提交审批',
    icon: GitPullRequestArrow,
    stateOf: (s) => (s === 'draft' ? 'pending' : s === 'pending' ? 'running' : 'done'),
    sub: (r) => (r.status === 'pending' ? '等待审批' : r.status === 'released' ? '审批通过' : r.status === 'rejected' ? '审批驳回' : '待提交'),
  },
  {
    key: 'tag',
    name: '推送 Tag',
    icon: Tag,
    stateOf: (s) => (s === 'released' ? 'done' : 'pending'),
    sub: (r) => (r.status === 'released' ? `已推送 ${r.tag_name}` : '审批通过后执行'),
  },
];

/** 单个时间线节点 */
function TimelineNode({
  icon: Icon,
  name,
  sub,
  state,
  isLast,
}: {
  icon: LucideIcon;
  name: string;
  sub: string;
  state: NodeState;
  isLast: boolean;
}) {
  const dotClass = {
    done: 'bg-emerald-500 text-white',
    running: 'bg-amber-500 text-white pulse-dot',
    pending: 'border-2 border-slate-200 bg-white text-slate-300',
  }[state];

  const badge = {
    done: { text: '已完成', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
    running: { text: '进行中', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
    pending: { text: '待处理', cls: 'border-slate-200 bg-slate-50 text-slate-400' },
  }[state];

  const nameClass = state === 'pending' ? 'text-slate-400' : state === 'running' ? 'text-amber-700' : 'text-slate-900';

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`flex h-7 w-7 items-center justify-center rounded-full ${dotClass}`}>
          <Icon className="h-3.5 w-3.5" strokeWidth={state === 'done' ? 2 : 1.5} />
        </div>
        {!isLast ? <div className="mt-1 w-px flex-1 bg-indigo-100" /> : null}
      </div>
      <div className={`flex-1 ${isLast ? '' : 'pb-5'}`}>
        <div className="flex items-center justify-between">
          <div className={`text-[13px] font-medium ${nameClass}`}>{name}</div>
          <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>
            {badge.text}
          </span>
        </div>
        <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>
      </div>
    </div>
  );
}

/** 发布流程时间线（基于发布状态，不依赖 workflow_instance） */
export function ReleaseTimeline({ release }: { release: Release }) {
  const rejected = release.status === 'rejected';

  return (
    <div className="tech-card rounded-xl p-5">
      <h3 className="mb-4 text-[15px] font-semibold tracking-tight text-slate-900">发布流程</h3>
      <div className="space-y-0">
        {flowNodes.map((node, idx) => {
          let state = node.stateOf(release.status);
          // 驳回时，审批节点显示驳回态，之后节点保持待处理
          if (rejected && node.key === 'audit') state = 'done';
          return (
            <TimelineNode
              key={node.key}
              icon={node.icon}
              name={node.name}
              sub={node.sub(release)}
              state={state}
              isLast={idx === flowNodes.length - 1}
            />
          );
        })}
      </div>
      {rejected && release.rejected_reason ? (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50/50 p-3 text-[11px] leading-relaxed text-rose-600">
          驳回原因：{release.rejected_reason}
        </div>
      ) : null}
    </div>
  );
}
