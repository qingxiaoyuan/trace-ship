import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bell,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clock,
  ExternalLink,
  GitPullRequestArrow,
  Hammer,
  Rocket,
  Settings,
  Trash2,
  XCircle,
} from 'lucide-react';
import dayjs from 'dayjs';
import { notificationApi } from '@/api/notification';
import { useAppMessage } from '@/hooks/useAppMessage';
import { formatRelativeTime } from '@/utils/time';
import type { Notification } from '@/types';

/** 通知类型筛选键 */
type FilterKey = 'all' | 'audit' | 'build' | 'release' | 'system';

/** 通知类型 → 文案 */
const typeText: Record<Notification['notification_type'], string> = {
  audit: '审批',
  build: '打包',
  release: '发布',
  system: '系统',
};

/** 关联类型 → 可读标签 */
const relatedTypeText: Record<string, string> = {
  workflow_task: '审批任务',
  workflow_instance: '审批实例',
  package_task: '打包任务',
  release_record: '发布记录',
};

/** 类型标签样式（边框/背景/文字） */
const tagTone: Record<Notification['notification_type'], string> = {
  audit: 'border-violet-200 bg-violet-50 text-violet-700',
  build: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  release: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  system: 'border-amber-200 bg-amber-50 text-amber-700',
};

/** 筛选 tab 配置 */
const filterTabs: { key: FilterKey; label: string; icon?: typeof Hammer; iconColor?: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'audit', label: '审批', icon: GitPullRequestArrow, iconColor: 'text-violet-500' },
  { key: 'build', label: '打包', icon: Hammer, iconColor: 'text-cyan-500' },
  { key: 'release', label: '发布', icon: Rocket, iconColor: 'text-emerald-500' },
  { key: 'system', label: '系统', icon: Settings, iconColor: 'text-amber-500' },
];

interface NotiVisual {
  Icon: typeof Hammer;
  iconCls: string;
}

/** 根据通知类型与标题关键词推导图标/配色 */
function getNotiVisual(n: Notification): NotiVisual {
  const negative = /失败|退回|驳回|拒绝|错误|异常/.test(n.title || '');
  const positive = /成功|通过|完成/.test(n.title || '');
  switch (n.notification_type) {
    case 'audit':
      return negative
        ? { Icon: XCircle, iconCls: 'icon-rose' }
        : { Icon: GitPullRequestArrow, iconCls: 'icon-violet' };
    case 'build':
      return negative
        ? { Icon: XCircle, iconCls: 'icon-rose' }
        : positive
          ? { Icon: Check, iconCls: 'icon-cyan' }
          : { Icon: Hammer, iconCls: 'icon-cyan' };
    case 'release':
      return negative
        ? { Icon: XCircle, iconCls: 'icon-rose' }
        : { Icon: CheckCircle2, iconCls: 'icon-emerald' };
    default:
      return { Icon: Settings, iconCls: 'icon-amber' };
  }
}

/** 根据 related_type 推导详情页主操作按钮 */
function getRelatedAction(
  n: Notification,
): { label: string; icon: typeof Hammer; to: string } | null {
  const id = n.related_id;
  switch (n.related_type) {
    case 'workflow_task':
    case 'workflow_instance':
      return { label: '前往审批', icon: GitPullRequestArrow, to: '/workflows' };
    case 'package_task':
      return id ? { label: '查看打包', icon: Hammer, to: '/packages' } : null;
    case 'release_record':
      return id ? { label: '查看发布单', icon: ExternalLink, to: `/releases/${id}` } : null;
    default:
      return null;
  }
}

export default function NotificationPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message, modal } = useAppMessage();

  const [filter, setFilter] = useState<FilterKey>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [selected, setSelected] = useState<Notification | null>(null);

  /** 各类型计数 + 未读总数（取 total 字段，准确） */
  const { data: counts } = useQuery({
    queryKey: ['notifications', 'counts'],
    queryFn: async () => {
      const types: FilterKey[] = ['all', 'audit', 'build', 'release', 'system'];
      const list = await Promise.all(
        types.map((t) =>
          notificationApi.getNotifications(
            t === 'all'
              ? { page: 1, page_size: 1 }
              : { page: 1, page_size: 1, notification_type: t },
          ),
        ),
      );
      const unread = await notificationApi.getUnreadCount();
      const map = {} as Record<FilterKey, number>;
      types.forEach((t, i) => {
        map[t] = list[i].total;
      });
      return { counts: map, unread: unread.count };
    },
  });

  /** 通知列表（服务端分页 + 过滤） */
  const { data, isLoading } = useQuery({
    queryKey: ['notifications', 'list', filter, unreadOnly, page, pageSize],
    queryFn: () =>
      notificationApi.getNotifications({
        page,
        page_size: pageSize,
        ...(filter !== 'all' ? { notification_type: filter } : {}),
        ...(unreadOnly ? { is_read: false } : {}),
      }),
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['notification-unread-count'] });
    queryClient.invalidateQueries({ queryKey: ['header-notifications'] });
  };

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationApi.markRead(id),
    onSuccess: () => {
      invalidateAll();
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationApi.markAllRead(),
    onSuccess: (res) => {
      invalidateAll();
      message.success(`已标记 ${res.count} 条通知为已读`);
    },
  });

  const clearReadMutation = useMutation({
    mutationFn: () => notificationApi.clearRead(),
    onSuccess: (res) => {
      invalidateAll();
      setSelected(null);
      message.success(`已清除 ${res.count} 条已读通知`);
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: () => notificationApi.clearAll(),
    onSuccess: (res) => {
      invalidateAll();
      setSelected(null);
      message.success(`已清除 ${res.count} 条通知`);
    },
  });

  const rows = data?.results || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  /** 切换筛选条件时重置分页 */
  const changeFilter = (next: FilterKey) => {
    setFilter(next);
    setPage(1);
  };
  const toggleUnread = () => {
    setUnreadOnly((v) => !v);
    setPage(1);
  };

  const openDetail = (n: Notification) => {
    setSelected(n);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** 在详情页标记已读：同步更新本地选中态 */
  const handleMarkRead = (n: Notification) => {
    if (n.is_read) return;
    markReadMutation.mutate(n.id);
    setSelected({ ...n, is_read: true });
  };

  /** 列表内联「标记已读」 */
  const handleMarkReadFromList = (n: Notification) => {
    markReadMutation.mutate(n.id);
  };

  // ============ 详情视图 ============
  if (selected) {
    const n = selected;
    const action = getRelatedAction(n);
    const relatedLabel =
      n.related_type === '' ? '—' : relatedTypeText[n.related_type] || n.related_type;
    return (
      <div className="space-y-5">
        <button
          onClick={() => setSelected(null)}
          className="inline-flex items-center gap-1 text-[13px] text-slate-400 transition-colors hover:text-indigo-600"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
          通知中心
        </button>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
          {/* 主内容 */}
          <div className="tech-card rounded-xl p-6">
            <div className="mb-3 flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${tagTone[n.notification_type]}`}
              >
                {typeText[n.notification_type]}通知
              </span>
              {n.is_read ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-400">
                  已读
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-md border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[11px] font-medium text-cyan-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 pulse-dot" />
                  未读
                </span>
              )}
            </div>

            <h2 className="text-[22px] font-semibold leading-snug tracking-tight text-slate-900">
              {n.title}
            </h2>
            <p className="mt-1.5 flex items-center gap-2 text-[12px] text-slate-400">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" strokeWidth={1.5} />
                {dayjs(n.created_at).format('YYYY-MM-DD HH:mm')}
              </span>
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span>{formatRelativeTime(n.created_at)}</span>
            </p>

            <div className="my-5 border-t border-indigo-50" />

            <div className="space-y-4">
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  通知内容
                </div>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">
                  {n.content}
                </p>
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="mt-6 flex items-center gap-2 border-t border-indigo-50 pt-5">
              {action && (
                <button
                  onClick={() => navigate(action.to)}
                  className="btn-glow inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-[13px] font-medium text-white"
                >
                  <action.icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                  {action.label}
                </button>
              )}
              <button
                onClick={() => handleMarkRead(n)}
                disabled={n.is_read || markReadMutation.isPending}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-4 py-2.5 text-[13px] font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                标记已读
              </button>
            </div>
          </div>

          {/* 侧边信息 */}
          <div className="space-y-5">
            <div className="tech-card rounded-xl p-5">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                关联资源
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-slate-500">关联类型</span>
                  <span className="text-[13px] font-medium text-slate-800">{relatedLabel}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-slate-500">关联 ID</span>
                  <span className="font-mono text-[11px] text-slate-600">
                    {n.related_id ? `${n.related_id.slice(0, 12)}…` : '—'}
                  </span>
                </div>
              </div>
              {action && (
                <button
                  onClick={() => navigate(action.to)}
                  className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[12px] font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
                >
                  <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
                  前往查看
                </button>
              )}
            </div>

            <div className="tech-card rounded-xl p-5">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                通知信息
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-slate-500">通知 ID</span>
                  <span className="font-mono text-[11px] text-slate-600">{n.id.slice(0, 12)}…</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-slate-500">类型</span>
                  <span className="text-[13px] text-slate-700">
                    {typeText[n.notification_type]}通知
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-slate-500">关联类型</span>
                  <span className="font-mono text-[12px] text-slate-700">
                    {n.related_type || '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-slate-500">创建时间</span>
                  <span className="text-[12px] text-slate-700">
                    {dayjs(n.created_at).format('MM-DD HH:mm')}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-slate-500">阅读时间</span>
                  <span className="text-[12px] text-slate-400">
                    {n.read_at ? dayjs(n.read_at).format('MM-DD HH:mm') : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============ 列表视图 ============
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">通知中心</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            查看审批、打包、发布与系统通知，及时处理待办事项
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending || !counts?.unread}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[13px] font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CheckCheck className="h-3.5 w-3.5" strokeWidth={1.5} />
            全部已读
          </button>
          <button
            onClick={() => {
              modal.confirm({
                title: '清除已读通知',
                content: '确定清除所有已读通知吗？此操作不可恢复。',
                okText: '清除',
                okButtonProps: { danger: true },
                cancelText: '取消',
                onOk: () => clearReadMutation.mutate(),
              });
            }}
            disabled={clearReadMutation.isPending || !total}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-100 bg-white px-3 py-2 text-[13px] font-medium text-slate-600 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            清除已读
          </button>
          <button
            onClick={() => {
              modal.confirm({
                title: '清除全部通知',
                content: '确定清除全部通知（含未读）吗？此操作不可恢复。',
                okText: '全部清除',
                okButtonProps: { danger: true },
                cancelText: '取消',
                onOk: () => clearAllMutation.mutate(),
              });
            }}
            disabled={clearAllMutation.isPending || !total}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] font-medium text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            清除全部
          </button>
        </div>
      </div>

      <div className="tech-card overflow-hidden rounded-xl">
        {/* 筛选栏 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-indigo-50 px-4 py-3">
          <div className="flex flex-wrap items-center gap-1">
            {filterTabs.map((tab) => {
              const active = filter === tab.key;
              const count = counts?.counts[tab.key];
              return (
                <button
                  key={tab.key}
                  onClick={() => changeFilter(tab.key)}
                  className={[
                    'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                    active
                      ? 'border-indigo-200 bg-indigo-50 text-indigo-600'
                      : 'border-indigo-100 bg-white text-slate-600 hover:bg-indigo-50 hover:text-indigo-600',
                  ].join(' ')}
                >
                  {tab.icon && (
                    <tab.icon className={`h-3.5 w-3.5 ${tab.iconColor}`} strokeWidth={1.5} />
                  )}
                  {tab.label}
                  <span
                    className={`font-mono text-[11px] ${active ? 'text-indigo-400' : 'text-slate-400'}`}
                  >
                    {count ?? 0}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={toggleUnread}
              className={[
                'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors',
                unreadOnly
                  ? 'border-indigo-200 bg-indigo-50 text-indigo-600'
                  : 'border-indigo-100 bg-white text-slate-600 hover:bg-indigo-50 hover:text-indigo-600',
              ].join(' ')}
            >
              <CircleDot className="h-3.5 w-3.5 text-cyan-500" strokeWidth={1.5} />
              仅未读
              {counts?.unread ? (
                <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-cyan-400 px-1 text-[10px] font-semibold text-white max-md:h-5 max-md:text-xs">
                  {counts.unread}
                </span>
              ) : null}
            </button>
          </div>
        </div>

        {/* 通知列表 */}
        <div className="divide-y divide-indigo-50/50 max-md:divide-y-0 max-md:space-y-3 max-md:p-3">
          {isLoading ? (
            <div className="flex items-center justify-center px-5 py-16 text-[13px] text-slate-400">
              加载中…
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-5 py-16 text-slate-400">
              <Bell className="h-8 w-8 text-slate-300" strokeWidth={1.5} />
              <span className="text-[13px]">暂无通知</span>
            </div>
          ) : (
            rows.map((n) => {
              const { Icon, iconCls } = getNotiVisual(n);
              return (
                <div
                  key={n.id}
                  onClick={() => openDetail(n)}
                  className="group cursor-pointer transition-colors hover:bg-indigo-50/30 max-md:rounded-xl max-md:border max-md:border-indigo-100/70 max-md:bg-white max-md:p-4"
                >
                  {/* 桌面端行 */}
                  <div className="hidden items-start gap-3 border-l-2 border-transparent px-5 py-4 md:flex">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconCls}`}
                    >
                      <Icon className="h-[18px] w-[18px]" strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={[
                            'text-[13px]',
                            n.is_read ? 'font-medium text-slate-600' : 'font-semibold text-slate-900',
                          ].join(' ')}
                        >
                          {n.title}
                        </span>
                        {!n.is_read && (
                          <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                        )}
                        <span
                          className={`inline-flex items-center rounded border px-1 py-0.5 text-[10px] font-medium max-md:text-xs ${tagTone[n.notification_type]}`}
                        >
                          {typeText[n.notification_type]}
                        </span>
                      </div>
                      <p
                        className={[
                          'mt-0.5 truncate text-[12px]',
                          n.is_read ? 'text-slate-500' : 'text-slate-600',
                        ].join(' ')}
                      >
                        {n.content}
                      </p>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                        <span>{formatRelativeTime(n.created_at)}</span>
                        {!n.is_read && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMarkReadFromList(n);
                            }}
                            className="text-slate-400 transition-colors hover:text-indigo-600"
                          >
                            · 标记已读
                          </button>
                        )}
                      </div>
                    </div>
                    <ChevronRight
                      className="mt-2 h-4 w-4 text-slate-300 transition-colors group-hover:text-indigo-400"
                      strokeWidth={1.5}
                    />
                  </div>

                  {/* 移动端卡片（参考 docs/ui/mobile/mobile-release.html） */}
                  <div className="md:hidden">
                    <div className="flex items-center justify-between">
                      {n.is_read ? (
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
                          已读
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md bg-cyan-50 px-1.5 py-0.5 text-[11px] font-medium text-cyan-600">
                          <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 pulse-dot" />
                          未读
                        </span>
                      )}
                      <span
                        className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${tagTone[n.notification_type]}`}
                      >
                        {typeText[n.notification_type]}
                      </span>
                    </div>
                    <div
                      className={[
                        'mt-2 text-[15px] tracking-tight',
                        n.is_read ? 'font-medium text-slate-600' : 'font-semibold text-slate-900',
                      ].join(' ')}
                    >
                      {n.title}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-slate-500">
                      {n.content}
                    </p>
                    <div className="mt-3 flex items-center justify-between border-t border-indigo-50 pt-3">
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                        <Clock className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                        {formatRelativeTime(n.created_at)}
                      </div>
                      <div className="flex items-center gap-1">
                        {!n.is_read && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMarkReadFromList(n);
                            }}
                            className="rounded-md px-2 py-1.5 text-[12px] font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
                          >
                            标记已读
                          </button>
                        )}
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" strokeWidth={1.5} />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 分页 */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-indigo-50 px-5 py-3">
          <div className="text-[12px] text-slate-400">
            第 {start}-{end} 条 / 共 {total} 条
          </div>
          <Pager page={page} totalPages={totalPages} onChange={setPage} />
        </div>
      </div>
    </div>
  );
}

/** 简洁分页器 */
function Pager({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  const pages = useMemo(() => {
    const max = 5;
    const half = Math.floor(max / 2);
    let startPage = Math.max(1, page - half);
    const endPage = Math.min(totalPages, startPage + max - 1);
    startPage = Math.max(1, endPage - max + 1);
    const arr: number[] = [];
    for (let i = startPage; i <= endPage; i++) arr.push(i);
    return arr;
  }, [page, totalPages]);

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-indigo-100 text-slate-400 transition-colors hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40 max-md:h-9 max-md:w-9"
      >
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
      {pages.map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={[
            'flex h-7 w-7 items-center justify-center rounded-md text-[12px] font-medium transition-colors max-md:h-9 max-md:w-9',
            p === page
              ? 'bg-indigo-500 text-white'
              : 'border border-indigo-100 text-slate-600 hover:bg-indigo-50',
          ].join(' ')}
        >
          {p}
        </button>
      ))}
      <button
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-indigo-100 text-slate-400 transition-colors hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40 max-md:h-9 max-md:w-9"
      >
        <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
    </div>
  );
}
