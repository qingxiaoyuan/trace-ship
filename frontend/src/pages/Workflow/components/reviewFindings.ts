import type { AiReviewData, AiReviewFinding } from '@/api/workflow';

/** 相同发现的稳定 ID 在当前及多次执行中只展示一次，优先当前或较新的执行。 */
export function uniqueHistoryFindings(review: AiReviewData, excludeCurrent = true): Map<string, AiReviewFinding[]> {
  const seen = new Set(excludeCurrent ? (review.findings || []).flatMap((finding) => finding.id ? [finding.id] : []) : []);
  const result = new Map<string, AiReviewFinding[]>();
  for (const attempt of [...(review.history || [])].reverse()) {
    const unique = (attempt.findings || []).filter((finding) => {
      if (!finding.id) return true;
      if (seen.has(finding.id)) return false;
      seen.add(finding.id);
      return true;
    });
    result.set(attempt.token, unique);
  }
  return result;
}
