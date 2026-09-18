import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, ChevronRight, ClipboardList, GitPullRequestArrow, Megaphone } from 'lucide-react';
import { TsModal } from './TsModal';
import { notificationApi } from '@/api/notification';
import { useAuthStore } from '@/stores/authStore';
import { formatRelativeTime } from '@/utils/time';

/** 待办/整改每浏览器会话只弹一次的标记键（系统强提醒未确认前每次登录都弹） */
const SHOWN_KEY = 'ts-strong-remind-shown';

/**
 * 通知强提醒弹窗：登录后拉取待我审批 / 待我整改 / 未读系统强提醒。
 * 系统强提醒未确认前每次进入都会弹出；待办与整改本会话只展示一次。
 */
export function StrongRemindModal() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ['notification-remind-summary', user?.id],
    queryFn: () => notificationApi.getRemindSummary(),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const todoCount = data?.todo_task_count ?? 0;
  const issueCount = data?.open_issue_count ?? 0;
  const strongNotices = data?.strong_notices ?? [];
  const hasStrong = strongNotices.length > 0;
  const hasTodo = todoCount + issueCount > 0;

  useEffect(() => {
    if (!user || !data) return;
    if (hasStrong) {
      setOpen(true);
      return;
    }
    if (hasTodo && !sessionStorage.getItem(SHOWN_KEY)) {
      setOpen(true);
    }
  }, [user, data, hasStrong, hasTodo]);

  useEffect(() => {
    if (open && hasTodo && !hasStrong) {
      sessionStorage.setItem(SHOWN_KEY, '1');
    }
  }, [open, hasTodo, hasStrong]);

  const ackMutation = useMutation({
    mutationFn: () => notificationApi.ackStrongNotices(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-remind-summary'] });
      queryClient.invalidateQueries({ queryKey: ['notification-unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  if (!user || !data) return null;

  const close = () => {
    if (hasStrong) ackMutation.mutate();
    if (hasTodo) sessionStorage.setItem(SHOWN_KEY, '1');
    setOpen(false);
  };

  const go = (to: string) => {
    close();
    navigate(to);
  };

  const todoMore = todoCount - data.todo_tasks.length;
  const issueMore = issueCount - data.open_issues.length;
  const visible = open && (hasStrong || hasTodo);

  return (
    <TsModal
      title="事项提醒"
      subtitle={hasStrong ? '有需要您确认的系统通知' : '有待您处理的审批与整改事项'}
      titleIcon={<BellRing className="h-[18px] w-[18px]" strokeWidth={1.5} />}
      open={visible}
      onCancel={close}
      footer={
        <div className="flex justify-end">
          <button
            onClick={close}
            className="btn-glow inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-[13px] font-medium text-white"
          >
            知道了
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {hasStrong && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
                <Megaphone className="h-4 w-4 text-amber-500" strokeWidth={1.5} />
                系统通知（{strongNotices.length}）
              </span>
            </div>
            <div className="divide-y divide-indigo-50/60 rounded-lg border border-amber-100/80">
              {strongNotices.map((notice) => (
                <div key={notice.id} className="px-3 py-2.5">
                  <div className="text-[13px] font-medium text-slate-800">{notice.title}</div>
                  <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-slate-600">
                    {notice.content}
                  </p>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {formatRelativeTime(notice.created_at)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {todoCount > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
                <GitPullRequestArrow className="h-4 w-4 text-violet-500" strokeWidth={1.5} />
                需要我审批（{todoCount}）
              </span>
              <button
                onClick={() => go('/workflows')}
                className="inline-flex items-center gap-0.5 text-[12px] font-medium text-indigo-600 transition-colors hover:text-indigo-500"
              >
                去处理
                <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </div>
            <div className="divide-y divide-indigo-50/60 rounded-lg border border-indigo-100/70">
              {data.todo_tasks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => go('/workflows')}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-indigo-50/40"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-slate-800">
                      {t.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                      {t.project_name}
                      {t.version ? ` · ${t.version}` : ''}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" strokeWidth={1.5} />
                </button>
              ))}
            </div>
            {todoMore > 0 && (
              <p className="mt-1.5 text-[11px] text-slate-400">还有 {todoMore} 条待审批…</p>
            )}
          </div>
        )}

        {issueCount > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
                <ClipboardList className="h-4 w-4 text-rose-500" strokeWidth={1.5} />
                需要我整改（{issueCount}）
              </span>
            </div>
            <div className="divide-y divide-indigo-50/60 rounded-lg border border-indigo-100/70">
              {data.open_issues.map((issue) => (
                <button
                  key={issue.id}
                  onClick={() => go(`/releases/${issue.release_id}`)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-indigo-50/40"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-slate-800">
                      {issue.version || '发布整改'}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                      {issue.content}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" strokeWidth={1.5} />
                </button>
              ))}
            </div>
            {issueMore > 0 && (
              <p className="mt-1.5 text-[11px] text-slate-400">还有 {issueMore} 条待整改…</p>
            )}
          </div>
        )}
      </div>
    </TsModal>
  );
}
