import type { ReactNode } from 'react';
import { Button } from 'antd';
import type { AiReviewFinding } from '@/api/workflow';
import { useAuthStore } from '@/stores/authStore';
import { RemediationContext, remediationStatusText, useRemediationState, useReviewRemediations } from './useReviewRemediations';

function RemediationSession({ instanceId, sessionVersion, children }: { instanceId: string; sessionVersion: number; children: ReactNode }) {
  const value = useRemediationState(instanceId, sessionVersion);
  return <RemediationContext.Provider value={value}>{children}</RemediationContext.Provider>;
}

/** 行内采纳与整改表单共享一次授权查询，账号或轮次变化时清除局部状态。 */
export function ReviewRemediations({ instanceId, children }: { instanceId: string; children: ReactNode }) {
  const sessionVersion = useAuthStore((state) => state.sessionVersion);
  return <RemediationSession key={`${instanceId}:${sessionVersion}`} instanceId={instanceId} sessionVersion={sessionVersion}>{children}</RemediationSession>;
}

export function FindingRemediationAction({ nodeId, finding }: { nodeId: string; finding: AiReviewFinding }) {
  const state = useReviewRemediations();
  if (!state || state.query.error || !state.query.isFetchedAfterMount || !state.query.data) return null;
  const item = state.query.data.items.find((entry) => entry.instance_id === state.instanceId && entry.node_id === nodeId && entry.finding_id === finding.id);
  if (item) return <a href={`#remediation-${item.id}`} onClick={(event) => { event.preventDefault(); state.openItem(item.id); }} className="inline-flex min-h-9 items-center text-xs font-medium text-indigo-700 underline underline-offset-2">{remediationStatusText[item.status]} · 查看整改</a>;
  if (!finding.id || !state.query.data.can_adopt) return null;
  return <Button size="small" className="max-md:min-h-9" aria-label={`采纳：${finding.title}`} disabled={state.pending}
    onClick={() => state.submit({ action: 'adopt', node_id: nodeId, finding_id: finding.id! })}>采纳为整改项</Button>;
}
