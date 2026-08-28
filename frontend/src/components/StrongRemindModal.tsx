import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BellRing, ChevronRight, ClipboardList, GitPullRequestArrow } from 'lucide-react';
import { TsModal } from './TsModal';
import { notificationApi } from '@/api/notification';
import { useAuthStore } from '@/stores/authStore';

/** 每浏览器会话只弹一次的标记键 */
const SHOWN_KEY = 'ts-strong-remind-shown';

/**
 * 通知强提醒弹窗：登录后拉取待我审批 / 待我整改汇总，
 * 两项 count 之和 > 0 且本会话未展示过时自动弹出一次。
 */
export function StrongRemindModal() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    // queryKey 带用户 id：SPA 内切换账号时不会沿用上一账号的汇总缓存
    queryKey: ['notification-remind-summary', user?.id],
    queryFn: () => notificationApi.getRemindSummary(),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const todoCount = data?.todo_task_count ?? 0;
  const issueCount = data?.open_issue_count ?? 0;
  const total = todoCount + issueCount;

  const [checked, setChecked] = useState(false);

  // 数据返回后在渲染期做一次会话级判断（React 官方「渲染期间调整状态」模式，
  // 避免在 effect 中同步 setState 造成级联渲染）。
  // 仅在发现待办（total > 0）时闩住：登录瞬间无待办不闩，本会话内后续
  // refetch 发现新待办仍提醒一次；已弹过的会话靠 sessionStorage 拦截。
  if (!checked && data && total > 0) {
    setChecked(true);
    if (!sessionStorage.getItem(SHOWN_KEY)) {
      setOpen(true);
    }
  }

  // 弹窗打开即写入会话标记：关掉后本会话不再弹（仅同步外部系统，不做 setState）
  useEffect(() => {
    if (open) sessionStorage.setItem(SHOWN_KEY, '1');
  }, [open]);

  if (!user || !data) return null;

  /** 跳转并关闭弹窗 */
  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  const todoMore = todoCount - data.todo_tasks.length;
  const issueMore = issueCount - data.open_issues.length;

  return (
    <TsModal
      title="事项提醒"
      subtitle="有待您处理的审批与整改事项"
      titleIcon={<BellRing className="h-[18px] w-[18px]" strokeWidth={1.5} />}
      open={open && total > 0}
      onCancel={() => setOpen(false)}
      footer={
        <div className="flex justify-end">
          <button
            onClick={() => setOpen(false)}
            className="btn-glow inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-[13px] font-medium text-white"
          >
            知道了
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* 待我审批 */}
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

        {/* 待我整改 */}
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
