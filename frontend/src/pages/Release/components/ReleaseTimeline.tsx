import { Check, GitPullRequestArrow, Rocket, Tag } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import dayjs from 'dayjs';
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
          <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium max-md:text-xs ${badge.cls}`}>
            {badge.text}
          </span>
        </div>
        <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>
      </div>
    </div>
  );
}

/** 发布流程时间线（基于发布状态，不依赖 workflow_instance） */
export function ReleaseTimeline({ release, compact = false }: { release: Release; compact?: boolean }) {
  const rejected = release.status === 'rejected';

  if (compact) return <section aria-label="发布流程">
    <div className="mb-[18px] flex items-center justify-between leading-7">
      <h3 className="text-[15px] font-semibold text-[#24324b]">发布流程</h3>
      <span className="text-[11px] font-medium text-[#238264]">{release.status === 'released' ? '已完成' : rejected ? '已驳回' : '进行中'}</span>
    </div>
    {flowNodes.map((node, index) => {
      const state = node.stateOf(release.status);
      const description = node.key === 'create'
        ? `${release.publisher_name || release.publisher || '-'} · ${dayjs(release.created_at).format('MM-DD HH:mm')}`
        : node.key === 'tag' && release.status === 'released' ? release.tag_name : node.sub(release);
      return <div key={node.key} className="flex min-h-[45px] gap-[14px]">
        <div className="flex w-[19px] shrink-0 flex-col items-center pt-[5px]">
          <span className={`flex h-[18px] w-[18px] items-center justify-center rounded-full ${state === 'done' ? 'bg-[#eff8f4] text-[#238264]' : state === 'running' ? 'bg-amber-50 text-amber-600' : 'bg-[#f7f8fc] text-[#9aa8bd]'}`}>
            {state === 'done' ? <Check className="h-3 w-3" strokeWidth={1.65} /> : <node.icon className="h-3 w-3" strokeWidth={1.65} />}
          </span>
          {index < flowNodes.length - 1 && <span className="mt-[3px] w-px flex-1 bg-[#e9edf5]" />}
        </div>
        <div className="flex min-w-0 flex-1 items-start justify-between gap-3 pb-[17px] leading-7">
          <span className="shrink-0 text-[12px] font-medium text-[#24324b]">{node.name}</span>
          <span className="min-w-0 break-words text-right text-[11px] text-[#76869f] [overflow-wrap:anywhere]">{description}</span>
        </div>
      </div>;
    })}
    {rejected && release.rejected_reason && <p className="mt-2 text-[12px] text-rose-600">驳回原因：{release.rejected_reason}</p>}
  </section>;

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
