import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, ChevronRight, LogOut, Plus, Search, User } from "lucide-react";
import { useMatches, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { tokens } from "@/styles/theme";
import { useAuthStore } from "@/stores/authStore";
import { notificationApi } from "@/api/notification";

const typeMap: Record<string, string> = {
  audit: "审批",
  build: "打包",
  release: "发布",
  system: "系统",
};

export function TopHeader() {
  const matches = useMatches();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const queryClient = useQueryClient();
  const [bellOpen, setBellOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const bellRef = useRef<HTMLButtonElement>(null);
  const bellPanelRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLButtonElement>(null);
  const userPanelRef = useRef<HTMLDivElement>(null);

  const { data: unreadCountData } = useQuery({
    queryKey: ["notification-unread-count"],
    queryFn: () => notificationApi.getUnreadCount(),
  });

  const { data: notificationData } = useQuery({
    queryKey: ["header-notifications"],
    queryFn: () => notificationApi.getNotifications({ page_size: 5 }),
    enabled: bellOpen,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationApi.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["notification-unread-count"],
      });
      queryClient.invalidateQueries({ queryKey: ["header-notifications"] });
    },
  });

  const unreadCount = unreadCountData?.count || 0;
  const notifications = notificationData?.results || [];

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        bellOpen &&
        bellRef.current &&
        bellPanelRef.current &&
        !bellRef.current.contains(target) &&
        !bellPanelRef.current.contains(target)
      ) {
        setBellOpen(false);
      }
      if (
        userOpen &&
        userRef.current &&
        userPanelRef.current &&
        !userRef.current.contains(target) &&
        !userPanelRef.current.contains(target)
      ) {
        setUserOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [bellOpen, userOpen]);

  const breadcrumbItems = useMemo<{ title: string; path?: string }[]>(() => {
    const items: { title: string; path?: string }[] = [];
    matches.forEach((match, index) => {
      const title = (match.handle as { title?: string } | undefined)?.title;
      if (title) {
        items.push({
          title,
          path: index === matches.length - 1 ? undefined : match.pathname,
        });
      }
    });
    if (items.length === 0) {
      items.push({ title: "工作台" });
    }
    return items;
  }, [matches]);

  const avatarLetter = (user?.nickname || user?.username)?.charAt(0) || "U";

  const displayName = user?.nickname || user?.username || "未登录";

  const roleMap: Record<string, string> = {
    super_admin: "超级管理员",
    project_manager: "项目管理员",
    developer: "开发人员",
    tester: "测试人员",
    auditor: "审核人",
    viewer: "只读人员",
  };

  const roleLabel = user?.is_superuser
    ? "超级管理员"
    : roleMap[user?.roles?.[0] || ""] || user?.roles?.[0] || "用户";

  return (
    <header
      className="ts-header-glass sticky top-0 z-30 flex h-[60px] items-center gap-3 border-b border-indigo-100/40 px-5 lg:px-7"
      style={{
        height: tokens.layout.headerHeight,
      }}
    >
      <div className="hidden items-center gap-1.5 text-[13px] md:flex">
        {breadcrumbItems.map((item, index) => (
          <div
            key={`${item.title}-${index}`}
            className="flex items-center gap-1.5"
          >
            {index > 0 ? (
              <ChevronRight
                className="h-3.5 w-3.5 text-slate-300"
                strokeWidth={1.5}
              />
            ) : null}
            {item.path ? (
              <button
                type="button"
                onClick={() => navigate(item.path!)}
                className="text-slate-400 transition-colors hover:text-indigo-600"
              >
                {item.title}
              </button>
            ) : (
              <span className="font-medium text-slate-800">{item.title}</span>
            )}
          </div>
        ))}
      </div>

      <div className="ml-auto hidden items-center md:flex">
        <button
          type="button"
          className="group flex w-[280px] items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-1.5 text-[13px] text-slate-400 transition-colors hover:border-indigo-200 hover:bg-white hover:text-indigo-600"
        >
          <Search className="h-3.5 w-3.5" strokeWidth={1.5} />
          <span>搜索项目、发布、提交…</span>
          <span className="ml-auto flex items-center gap-0.5">
            <kbd className="rounded border border-indigo-100 bg-white px-1 py-0.5 text-[10px] font-medium text-slate-400">
              ⌘
            </kbd>
            <kbd className="rounded border border-indigo-100 bg-white px-1 py-0.5 text-[10px] font-medium text-slate-400">
              K
            </kbd>
          </span>
        </button>
      </div>

      <div className="ml-auto flex items-center gap-2 md:ml-0">
        <button
          type="button"
          onClick={() => navigate("/releases/create")}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
          aria-label="新建发布"
        >
          <Plus className="h-4 w-4" strokeWidth={1.5} />
        </button>

        <div className="relative">
          <button
            ref={bellRef}
            type="button"
            onClick={() => setBellOpen((v) => !v)}
            className="relative flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
            aria-label="通知"
            aria-expanded={bellOpen}
          >
            <Bell className="h-4 w-4" strokeWidth={1.5} />
            {unreadCount > 0 ? (
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-cyan-400 ring-2 ring-white" />
            ) : null}
          </button>

          {bellOpen ? (
            <div
              ref={bellPanelRef}
              className="tech-card absolute right-0 top-full mt-2 w-[320px] rounded-xl py-2 shadow-lg"
              style={{ boxShadow: "0 12px 40px -10px rgba(79,70,229,.15)" }}
            >
              <div className="flex items-center justify-between border-b border-indigo-50 px-4 pb-2">
                <span className="text-[13px] font-medium text-slate-800">
                  通知
                </span>
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-600">
                  {unreadCount} 未读
                </span>
              </div>
              <div className="max-h-[280px] overflow-y-auto py-1">
                {notifications.length === 0 ? (
                  <div className="px-4 py-6 text-center text-[13px] text-slate-400">
                    暂无通知
                  </div>
                ) : (
                  notifications.map((item) => (
                    <div
                      key={item.id}
                      className="group cursor-pointer px-4 py-2.5 transition-colors hover:bg-indigo-50/50"
                      onClick={() => navigate("/notifications")}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div
                          className={`text-[12px] font-medium ${item.is_read ? "text-slate-500" : "text-slate-900"}`}
                        >
                          [
                          {typeMap[item.notification_type] ||
                            item.notification_type}
                          ] {item.title}
                        </div>
                        {!item.is_read ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              markReadMutation.mutate(item.id);
                            }}
                            className="shrink-0 text-[11px] text-indigo-600 hover:text-indigo-500"
                          >
                            标为已读
                          </button>
                        ) : null}
                      </div>
                      <div className="mt-0.5 line-clamp-1 text-[11px] text-slate-400">
                        {item.content}
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="border-t border-indigo-50 px-4 pt-2 text-center">
                <button
                  type="button"
                  onClick={() => navigate("/notifications")}
                  className="text-[12px] text-indigo-600 hover:text-indigo-500"
                >
                  查看全部通知
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="mx-2 h-5 w-px bg-indigo-100" />

        <div className="relative">
          <button
            ref={userRef}
            type="button"
            onClick={() => setUserOpen((v) => !v)}
            className="group flex h-10 min-w-28 items-center gap-2.5 rounded-lg bg-white pl-2.5 pr-3 shadow-[0_0_0_1px_rgba(99,102,241,0.12)] transition-all hover:shadow-[0_0_0_1px_rgba(99,102,241,0.12),0_16px_40px_-10px_rgba(79,70,229,0.18)] active:scale-[0.98]"
            style={{ border: "1px solid rgba(99, 102, 241, 0.15)" }}
            aria-label="用户信息"
            aria-haspopup="menu"
            aria-expanded={userOpen}
          >
            <span
              className="flex h-6 w-6 shrink-0 leading-[100%] items-center justify-center rounded-md text-[12px] font-semibold text-white"
              style={{
                background: `linear-gradient(135deg, ${tokens.colors.primaryLight}, ${tokens.colors.cyan})`,
              }}
            >
              {avatarLetter}
            </span>

            <span className="flex min-w-0 flex-col items-start leading-tight">
              <span className="max-w-[96px] truncate text-[12px] font-semibold text-slate-800 transition-colors group-hover:text-indigo-600">
                {displayName}
              </span>
              <span className="mt-1 text-[10px] text-slate-500 transition-colors group-hover:text-indigo-500">
                {roleLabel}
              </span>
            </span>

            <svg
              className={`ml-auto h-3 w-3 shrink-0 text-slate-400 transition-transform group-hover:text-indigo-500 ${userOpen ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m19.5 8.25-7.5 7.5-7.5-7.5"
              />
            </svg>
          </button>

          {userOpen ? (
            <div
              ref={userPanelRef}
              className="tech-card  absolute right-0 top-full mt-2 w-[160px] rounded-xl py-1 shadow-lg"
              style={{ boxShadow: "0 12px 40px -10px rgba(79,70,229,.15)" }}
            >
              <button
                type="button"
                onClick={() => {
                  setUserOpen(false);
                  navigate("/profile");
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-slate-600 transition-colors hover:bg-indigo-50/60 hover:text-indigo-600"
              >
                <User className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span>个人中心</span>
              </button>
              {/* <button
                type="button"
                onClick={() => setUserOpen(false)}
                className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-slate-600 transition-colors hover:bg-indigo-50/60 hover:text-indigo-600"
              >
                <Settings className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span>账号设置</span>
              </button> */}
              <div className="my-1 h-px bg-indigo-50" />
              <button
                type="button"
                onClick={() => {
                  setUserOpen(false);
                  logout();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-rose-600 transition-colors hover:bg-rose-50"
              >
                <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span>退出登录</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
