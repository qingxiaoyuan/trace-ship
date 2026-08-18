import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from 'antd';
import {
  CheckCircle2,
  CornerDownRight,
  MessageSquarePlus,
  RotateCcw,
  Send,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import dayjs from 'dayjs';
import { releaseApi } from '@/api/release';
import { useAppMessage } from '@/hooks/useAppMessage';
import type { Release, ReleaseReviewIssue, ReleaseReviewStatus } from '@/types';

/** 意见状态徽标 */
const statusMap: Record<
  ReleaseReviewStatus,
  { text: string; cls: string; dot: string }
> = {
  open: { text: '待整改', cls: 'border-amber-200 bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  replied: { text: '待复核', cls: 'border-blue-200 bg-blue-50 text-blue-600', dot: 'bg-blue-500' },
  resolved: { text: '已通过', cls: 'border-emerald-200 bg-emerald-50 text-emerald-600', dot: 'bg-emerald-500' },
};

/**
 * 发布文档审查整改闭环（嵌于「质量/提交审查」页的已发布回溯板块）
 *
 * 审查员（release.can_review）发起整改意见；发布人（release.can_reply）修改发布文档后
 * 逐条回复；审查员（issue.can_judge）对每条意见通过/驳回，驳回后可多轮回复，
 * 全部通过即整改完成。
 */
export function ReleaseReview({ release }: { release: Release }) {
  const queryClient = useQueryClient();
  const { message } = useAppMessage();
  const [newContent, setNewContent] = useState('');
  const [replyMap, setReplyMap] = useState<Record<string, string>>({});
  const [rejectIssue, setRejectIssue] = useState<ReleaseReviewIssue | null>(null);
  const [rejectComment, setRejectComment] = useState('');

  const { data: issues = [], isLoading } = useQuery({
    queryKey: ['release-review-issues', release.id],
    queryFn: () => releaseApi.getReviewIssues(release.id),
  });

  const refresh = () => {
    // 刷新详情（含 review_issue_counts 聚合）与整改意见列表
    queryClient.invalidateQueries({ queryKey: ['release', 'detail', release.id] });
    queryClient.invalidateQueries({ queryKey: ['release-review-issues', release.id] });
  };

  const createMutation = useMutation({
    mutationFn: (content: string) => releaseApi.createReviewIssue(release.id, content),
    onSuccess: () => {
      message.success('整改意见已提交，已通知发布人');
      setNewContent('');
      refresh();
    },
  });

  const replyMutation = useMutation({
    mutationFn: ({ issueId, content }: { issueId: string; content: string }) =>
      releaseApi.replyReviewIssue(release.id, issueId, content),
    onSuccess: () => {
      message.success('已回复整改意见，已通知审查员');
      setReplyMap({});
      refresh();
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (issueId: string) => releaseApi.resolveReviewIssue(release.id, issueId),
    onSuccess: () => {
      message.success('整改意见已通过');
      refresh();
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ issueId, comment }: { issueId: string; comment: string }) =>
      releaseApi.rejectReviewIssue(release.id, issueId, comment),
    onSuccess: () => {
      message.success('整改意见已驳回，已通知发布人继续整改');
      setRejectIssue(null);
      setRejectComment('');
      refresh();
    },
  });

  const counts = release.review_issue_counts;
  const total = counts?.total || 0;
  const pending = (counts?.open || 0) + (counts?.replied || 0);
  const done = counts?.resolved || 0;

  const canCreate = release.can_review;
  const canReply = release.can_reply;

  const handleCreate = () => {
    const content = newContent.trim();
    if (!content) return;
    createMutation.mutate(content);
  };

  const handleReply = (issueId: string) => {
    const content = (replyMap[issueId] || '').trim();
    if (!content) return;
    replyMutation.mutate({ issueId, content });
  };

  return (
    <div className="space-y-4">
      {/* 顶部聚合状态 */}
      <div className="flex items-center gap-3 rounded-lg border border-indigo-100 bg-indigo-50/40 px-4 py-3">
        <ShieldCheck className="h-4 w-4 text-indigo-500" strokeWidth={1.5} />
        <span className="text-[13px] font-medium text-slate-700">整改状态</span>
        {pending > 0 ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
            整改中 {pending} 条
          </span>
        ) : total > 0 ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            整改完成
          </span>
        ) : (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            正常
          </span>
        )}
        {total > 0 && (
          <span className="text-[12px] text-slate-400">共 {total} 条，已通过 {done} 条</span>
        )}
      </div>

      {/* 审查员发起意见 */}
      {canCreate && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-slate-600">
            <MessageSquarePlus className="h-3.5 w-3.5 text-indigo-500" strokeWidth={1.5} />
            发起整改意见
          </div>
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="指出发布文档需整改的内容（将推送给发布人）"
            rows={2}
            maxLength={2000}
            className="input-field w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] leading-5 text-slate-700 outline-none placeholder:text-slate-400"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={handleCreate}
              disabled={!newContent.trim() || createMutation.isPending}
              className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" strokeWidth={1.5} />
              {createMutation.isPending ? '提交中…' : '提交意见'}
            </button>
          </div>
        </div>
      )}

      {/* 意见列表 */}
      {isLoading ? (
        <div className="py-8 text-center text-[13px] text-slate-400">加载中…</div>
      ) : issues.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10">
          <ShieldCheck className="h-8 w-8 text-slate-300" strokeWidth={1.5} />
          <p className="mt-3 text-[13px] text-slate-400">暂无整改意见</p>
        </div>
      ) : (
        <div className="space-y-3">
          {issues.map((issue) => {
            const st = statusMap[issue.status] || statusMap.open;
            return (
              <div
                key={issue.id}
                className="rounded-lg border border-slate-200 bg-white px-4 py-3"
              >
                {/* 意见头 */}
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${st.dot}`} />
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${st.cls}`}>
                    {issue.status_display || st.text}
                  </span>
                  <span className="text-[12px] font-medium text-slate-700">{issue.author_name || '-'}</span>
                  <span className="text-[11px] text-slate-400">
                    {dayjs(issue.created_at).format('YYYY-MM-DD HH:mm')}
                  </span>
                </div>
                {/* 意见正文 */}
                <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-slate-700">
                  {issue.content}
                </p>
                {issue.status === 'resolved' && issue.resolved_at && (
                  <p className="mt-1 text-[11px] text-emerald-600">
                    已由 {issue.resolved_by_name || '-'} 于{' '}
                    {dayjs(issue.resolved_at).format('YYYY-MM-DD HH:mm')} 通过
                  </p>
                )}

                {/* 回复时间线 */}
                {issue.replies.length > 0 && (
                  <div className="mt-3 space-y-2 border-l-2 border-indigo-100 pl-3">
                    {issue.replies.map((r) => (
                      <div key={r.id} className="flex items-start gap-2">
                        <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-300" strokeWidth={1.5} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-medium text-slate-600">
                              {r.author_name || '-'}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {dayjs(r.created_at).format('MM-DD HH:mm')}
                            </span>
                          </div>
                          <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-5 text-slate-600">
                            {r.content}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 操作区 */}
                <div className="mt-3 space-y-2">
                  {canReply && issue.status === 'open' && (
                    <div className="flex items-center gap-2">
                      <UserRound className="h-3.5 w-3.5 shrink-0 text-indigo-400" strokeWidth={1.5} />
                      <input
                        value={replyMap[issue.id] || ''}
                        onChange={(e) =>
                          setReplyMap((prev) => ({ ...prev, [issue.id]: e.target.value }))
                        }
                        placeholder="请先在发布详情页修改发布说明文档，再回复整改说明"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleReply(issue.id);
                        }}
                        className="input-field min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-700 outline-none placeholder:text-slate-400"
                      />
                      <button
                        type="button"
                        onClick={() => handleReply(issue.id)}
                        disabled={!(replyMap[issue.id] || '').trim() || replyMutation.isPending}
                        className="btn-glow inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[11px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {replyMutation.isPending ? '回复中…' : '回复'}
                      </button>
                    </div>
                  )}
                  {issue.can_judge && issue.status === 'replied' && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400">整改结果复核：</span>
                      <button
                        type="button"
                        onClick={() => resolveMutation.mutate(issue.id)}
                        disabled={resolveMutation.isPending}
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-600 transition-colors hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3 w-3" strokeWidth={1.5} />
                        {resolveMutation.isPending ? '处理中…' : '通过'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRejectIssue(issue);
                          setRejectComment('');
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-600 transition-colors hover:border-rose-300 hover:bg-rose-100"
                      >
                        <RotateCcw className="h-3 w-3" strokeWidth={1.5} />
                        驳回
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 驳回备注弹窗 */}
      <Modal
        title="驳回整改意见"
        open={!!rejectIssue}
        onCancel={() => {
          setRejectIssue(null);
          setRejectComment('');
        }}
        okText="确认驳回"
        okButtonProps={{ danger: true, loading: rejectMutation.isPending }}
        cancelText="取消"
        onOk={() => {
          if (!rejectIssue) return;
          rejectMutation.mutate({ issueId: rejectIssue.id, comment: rejectComment.trim() });
        }}
      >
        <p className="mb-2 text-[12px] text-slate-500">
          驳回后该意见将回到「待整改」，发布人需继续修改并回复。可填写驳回备注说明还需整改的内容：
        </p>
        <textarea
          value={rejectComment}
          onChange={(e) => setRejectComment(e.target.value)}
          placeholder="可选：说明还需整改的内容（将作为审查员备注展示并推送发布人）"
          rows={3}
          className="input-field w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] leading-5 text-slate-700 outline-none placeholder:text-slate-400"
        />
      </Modal>
    </div>
  );
}
