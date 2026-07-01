import { Play, Flag, UserCheck, Users } from 'lucide-react';
import type { WorkflowNodeConfig, WorkflowApproverConfig } from '@/types';

interface ApprovalFlowPreviewProps {
  /** 审批链配置 */
  nodeConfig: WorkflowNodeConfig[];
  /** 高亮当前进行中节点（传 node_id） */
  currentNodeId?: string;
  /** 完成节点集合（传 node_id 数组） */
  doneNodeIds?: string[];
  className?: string;
}

/** 审批模式元信息 */
const MODE_META: Record<'any' | 'all', { label: string; icon: typeof UserCheck; cls: string; dotCls: string }> = {
  any: { label: '或签', icon: UserCheck, cls: 'border-blue-200 bg-blue-50 text-blue-600', dotCls: 'bg-blue-500' },
  all: { label: '会签', icon: Users, cls: 'border-amber-200 bg-amber-50 text-amber-600', dotCls: 'bg-amber-500' },
};

/** 审批人展示文案 */
function approverLabel(apr: WorkflowApproverConfig): string {
  const ROLE_LABELS: Record<string, string> = {
    developer: '开发人员', tester: '测试人员', manager: '项目管理员', auditor: '审核人', viewer: '只读人员',
  };
  switch (apr.type) {
    case 'leader': return '项目负责人';
    case 'self': return '发起人自己';
    case 'role': return ROLE_LABELS[apr.role || ''] || apr.role || '角色';
    default: return '指定用户';
  }
}

/** 纯 Tailwind 纵向审批流程图（无第三方依赖） */
export function ApprovalFlowPreview({
  nodeConfig,
  currentNodeId,
  doneNodeIds = [],
  className = '',
}: ApprovalFlowPreviewProps) {
  const nodes = nodeConfig?.length ? nodeConfig : [];

  return (
    <div className={`px-5 py-6 ${className}`}>
      {/* 开始 */}
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 text-white">
          <Play className="h-4 w-4" style={{ strokeWidth: 1.5 }} />
        </span>
        <div>
          <div className="text-[13px] font-medium text-slate-900">开始</div>
          <div className="text-[11px] text-slate-400">提交发布申请</div>
        </div>
      </div>
      <div className="ml-[18px] h-6 w-px bg-slate-200" />

      {/* 审批节点 */}
      {nodes.map((node, idx) => {
        const mode = MODE_META[node.mode as 'any' | 'all'] || MODE_META.any;
        const MIcon = mode.icon;
        const isDone = doneNodeIds.includes(node.node_id || '');
        const isRunning = currentNodeId === node.node_id;
        const dotCls = isDone
          ? 'bg-emerald-500 text-white'
          : isRunning
            ? 'bg-amber-500 text-white pulse-dot'
            : 'border border-slate-200 bg-white text-slate-400';
        return (
          <div key={node.node_id || idx}>
            <div className="flex items-center gap-3">
              <span className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${dotCls}`}>
                <MIcon className="h-4 w-4" style={{ strokeWidth: 1.5 }} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-slate-900">{node.node_name || `节点 ${idx + 1}`}</span>
                  <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${mode.cls}`}>
                    <MIcon className="h-2.5 w-2.5" style={{ strokeWidth: 1.5 }} />
                    {mode.label}
                  </span>
                  {isDone && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                      已完成
                    </span>
                  )}
                  {isRunning && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                      进行中
                    </span>
                  )}
                </div>
                {(node.approvers || []).length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {(node.approvers || []).map((apr, ai) => (
                      <span
                        key={ai}
                        className="inline-flex items-center rounded-md bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500"
                      >
                        {approverLabel(apr)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="ml-[18px] h-6 w-px bg-slate-200" />
          </div>
        );
      })}

      {/* 完成 */}
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-400">
          <Flag className="h-4 w-4" style={{ strokeWidth: 1.5 }} />
        </span>
        <div>
          <div className="text-[13px] font-medium text-slate-900">完成</div>
          <div className="text-[11px] text-slate-400">推送 Tag，发布生效</div>
        </div>
      </div>
    </div>
  );
}
