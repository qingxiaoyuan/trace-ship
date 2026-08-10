import { Info } from 'lucide-react';
import { releaseTypeText, releaseTypeBadge } from '../constants';
import type { DetailSource } from '../types';
import type { WorkflowInstance, ReleaseType } from '@/types';

interface ReleaseSummaryProps {
  source: DetailSource;
  instance: WorkflowInstance | null;
}

/** 一行键值摘要 */
function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-indigo-50 py-1.5">
      <span className="text-[12px] text-slate-500">{label}</span>
      {children}
    </div>
  );
}

/** 右侧：发布摘要 + 审批规则 */
export function ReleaseSummary({ source, instance }: ReleaseSummaryProps) {
  // 审批节点数（不含开始 / 结束节点）
  const approvalNodeCount = (instance?.graph_data?.nodes || []).filter(
    (n) => n.type === 'approval-node',
  ).length;
  const modeText = source.mode === 'all' ? '会签（all）' : source.mode === 'any' ? '或签（any）' : '-';

  return (
    <div className="space-y-5">
      {/* 发布摘要 */}
      <div className="tech-card rounded-xl p-5">
        <h3 className="mb-3 text-[14px] font-semibold tracking-tight text-slate-900">发布摘要</h3>
        <div className="space-y-0">
          <div className="flex items-center justify-between border-b border-indigo-50 py-1.5">
            <span className="text-[12px] text-slate-500">版本号</span>
            <span className="font-mono text-[13px] text-slate-800">{source.version || '-'}</span>
          </div>
          <div className="flex items-center justify-between border-b border-indigo-50 py-1.5">
            <span className="text-[12px] text-slate-500">发布类型</span>
            {source.releaseType ? (
              <span
                className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${releaseTypeBadge[source.releaseType as ReleaseType]}`}
              >
                {releaseTypeText[source.releaseType as ReleaseType]}
              </span>
            ) : (
              <span className="text-[12px] text-slate-700">-</span>
            )}
          </div>
          <div className="flex items-center justify-between border-b border-indigo-50 py-1.5">
            <span className="text-[12px] text-slate-500">分支</span>
            <span className="font-mono text-[12px] text-slate-800">{source.branch || '-'}</span>
          </div>
          <div className="flex items-center justify-between border-b border-indigo-50 py-1.5">
            <span className="text-[12px] text-slate-500">Git Hash</span>
            <span
              className="font-mono text-[12px] text-slate-800"
              title={instance?.git_hash || ''}
            >
              {instance?.git_hash ? instance.git_hash.slice(0, 12) : '-'}
            </span>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-[12px] text-slate-500">打包状态</span>
            <span className="font-mono text-[13px] text-slate-800">
              {source.packageStatus || '-'}
            </span>
          </div>
        </div>
      </div>

      {/* 审批规则 */}
      <div className="tech-card rounded-xl p-5">
        <h3 className="mb-3 text-[14px] font-semibold tracking-tight text-slate-900">审批规则</h3>
        <div className="space-y-0">
          <SummaryRow label="审批模式">
            <span className="text-[12px] text-slate-700">{modeText}</span>
          </SummaryRow>
          <SummaryRow label="节点数">
            <span className="text-[12px] text-slate-700">{approvalNodeCount} 个审批节点</span>
          </SummaryRow>
        </div>
        <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-indigo-700">
            <Info className="h-3.5 w-3.5" strokeWidth={1.5} />
            流程说明
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">
            所有审批节点通过后，系统自动推送 Git Tag 并标记为已发布。任一节点驳回则流程终止。
          </p>
        </div>
      </div>
    </div>
  );
}
