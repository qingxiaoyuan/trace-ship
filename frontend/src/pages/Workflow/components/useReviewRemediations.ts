import { createContext, useContext, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { workflowApi } from '@/api/workflow';
import type { RemediationAction, ReviewRemediation } from '@/api/workflow';
import type { NormalizedError } from '@/api/request';

export const remediationStatusText: Record<ReviewRemediation['status'], string> = {
  pending_fix: '已采纳，待修复', pending_review: '已提交修复说明，待复核', resolved: '已处理', dismissed: '不采纳',
};

export const REMEDIATION_PAGE_SIZE = 20;

export function useRemediationState(instanceId: string, sessionVersion: number) {
  const client = useQueryClient();
  const [error, setError] = useState('');
  const [itemPage, setItemPage] = useState(0);
  const query = useQuery({ queryKey: ['review-remediations', instanceId, sessionVersion], queryFn: () => workflowApi.getRemediations(instanceId), retry: false, gcTime: 0 });
  const mutation = useMutation({
    mutationFn: (data: RemediationAction) => workflowApi.actOnRemediation(instanceId, data),
    onSuccess: async () => {
      setError('');
      await Promise.all([
        client.invalidateQueries({ queryKey: ['review-remediations', instanceId] }),
        client.invalidateQueries({ queryKey: ['workflow-instance-for-detail', instanceId] }),
      ]);
    },
    onError: (failure: NormalizedError) => setError(failure.friendlyMessage || failure.message || '操作失败，请重试'),
  });
  const openItem = (id: string) => {
    const index = query.data?.items.findIndex(item => item.id === id) ?? -1;
    if (index < 0 || query.error) return;
    setItemPage(Math.floor(index / REMEDIATION_PAGE_SIZE));
    requestAnimationFrame(() => document.getElementById(`remediation-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };
  return { instanceId, query, error, itemPage, setItemPage, openItem, pending: mutation.isPending, submit: (action: RemediationAction) => { setError(''); mutation.mutate(action); } };
}

export const RemediationContext = createContext<ReturnType<typeof useRemediationState> | null>(null);
export const useReviewRemediations = () => useContext(RemediationContext);
