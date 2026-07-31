import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { message, Popconfirm } from 'antd';
import {
  Bug,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  MessageSquareText,
  Plus,
  Search,
  Send,
  Sparkles,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import dayjs from 'dayjs';
import { feedbackApi } from '@/api/feedback';
import { TsModal } from '@/components/TsModal';
import { useAuthStore } from '@/stores/authStore';
import type { FeedbackCategory, FeedbackStatus } from '@/types';

const categoryTabs: { key: string; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'suggestion', label: '功能建议' },
  { key: 'bug', label: '问题反馈' },
  { key: 'experience', label: '体验优化' },
  { key: 'other', label: '其他' },
];

const categoryMeta: Record<FeedbackCategory, { label: string; tagClass: string }> = {
  suggestion: { label: '功能建议', tagClass: 'border-indigo-200 bg-indigo-50 text-indigo-600' },
  bug: { label: '问题反馈', tagClass: 'border-rose-200 bg-rose-50 text-rose-600' },
  experience: { label: '体验优化', tagClass: 'border-cyan-200 bg-cyan-50 text-cyan-700' },
  other: { label: '其他', tagClass: 'border-slate-200 bg-slate-50 text-slate-500' },
};

const statusMeta: Record<FeedbackStatus, { label: string; tagClass: string }> = {
  open: { label: '待处理', tagClass: 'border-amber-200 bg-amber-50 text-amber-600' },
  processed: { label: '已处理', tagClass: 'border-emerald-200 bg-emerald-50 text-emerald-600' },
};

const categoryOptions: { value: FeedbackCategory; label: string; icon: typeof Bug; iconClass: string }[] = [
  { value: 'suggestion', label: '功能建议', icon: Lightbulb, iconClass: 'icon-indigo' },
  { value: 'bug', label: '问题反馈', icon: Bug, iconClass: 'icon-rose' },
  { value: 'experience', label: '体验优化', icon: Sparkles, iconClass: 'icon-cyan' },
  { value: 'other', label: '其他', icon: MessageSquareText, iconClass: 'icon-amber' },
];

const PAGE_SIZE = 10;

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export default function Feedback() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [category, setCategory] = useState('');
  const [keyword, setKeyword] = useState('');
  const [search, setSearch] = useState('');
  const [ordering, setOrdering] = useState<'-created_at' | '-like_count'>('-created_at');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formCategory, setFormCategory] = useState<FeedbackCategory>('suggestion');
  const [formContent, setFormContent] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['feedbacks', category, search, ordering, page],
    queryFn: () =>
      feedbackApi.getFeedbacks({
        page,
        page_size: PAGE_SIZE,
        ...(category ? { category } : {}),
        ...(search ? { search } : {}),
        ordering,
      }),
    staleTime: 15_000,
    gcTime: 300_000,
  });

  const feedbacks = useMemo(() => data?.results || [], [data?.results]);
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['feedbacks'] });

  const createMutation = useMutation({
    mutationFn: feedbackApi.createFeedback,
    onSuccess: () => {
      message.success('反馈提交成功，感谢你的建议');
      setModalOpen(false);
      setFormTitle('');
      setFormContent('');
      setFormCategory('suggestion');
      setPage(1);
      invalidate();
    },
  });

  const likeMutation = useMutation({
    mutationFn: feedbackApi.toggleLike,
    onSuccess: () => invalidate(),
  });

  const deleteMutation = useMutation({
    mutationFn: feedbackApi.deleteFeedback,
    onSuccess: () => {
      message.success('删除成功');
      invalidate();
    },
  });

  const processMutation = useMutation({
    mutationFn: feedbackApi.processFeedback,
    onSuccess: () => {
      message.success('已标记为已处理');
      invalidate();
    },
  });

  return (
    <div className="space-y-5 page-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">使用反馈</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            提交你对平台的功能建议与问题反馈，也可以看看其他人的想法并点赞支持
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          <span>提交反馈</span>
        </button>
      </div>

      <div className="tech-card overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center gap-2 border-b border-indigo-50 px-5 py-3">
          <div className="flex items-center gap-1 rounded-lg border border-indigo-100 bg-indigo-50/40 p-0.5">
            {categoryTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setCategory(tab.key);
                  setPage(1);
                }}
                className={[
                  'rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
                  category === tab.key
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-slate-500 hover:text-indigo-600',
                ].join(' ')}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" strokeWidth={1.5} />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setSearch(keyword.trim());
                  setPage(1);
                }
              }}
              placeholder="搜索标题 / 内容，回车确认"
              className="w-[220px] rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setOrdering(ordering === '-created_at' ? '-like_count' : '-created_at');
              setPage(1);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-2.5 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
          >
            <ThumbsUp className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span>{ordering === '-created_at' ? '最新优先' : '最热优先'}</span>
          </button>
          <div className="ml-auto text-[12px] text-slate-400">共 {total} 条反馈</div>
        </div>

        <div className="divide-y divide-indigo-50/50">
          {isLoading ? (
            <div className="px-5 py-12 text-center text-[13px] text-slate-400">加载中…</div>
          ) : feedbacks.length === 0 ? (
            <div className="flex flex-col items-center px-5 py-14">
              <MessageSquareText className="h-8 w-8 text-slate-300" strokeWidth={1.5} />
              <p className="mt-3 text-[13px] text-slate-400">暂无反馈，来提第一条建议吧</p>
            </div>
          ) : (
            feedbacks.map((item) => {
              const meta = categoryMeta[item.category] || categoryMeta.other;
              const statusInfo = statusMeta[item.status] || statusMeta.open;
              const canDelete = user && (user.id === item.created_by || user.is_superuser);
              const canProcess = user?.is_superuser && item.status === 'open';
              return (
                <div key={item.id} className="px-5 py-4 transition-colors hover:bg-indigo-50/30">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-400 text-[12px] font-semibold text-white">
                      {getInitials(item.created_by_name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[14px] font-medium text-slate-900">{item.title}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.tagClass}`}>
                          {meta.label}
                        </span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusInfo.tagClass}`}>
                          {statusInfo.label}
                        </span>
                      </div>
                      <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-5 text-slate-600">{item.content}</p>
                      <div className="mt-2.5 flex items-center gap-3 text-[11px] text-slate-400">
                        <span className="font-medium text-slate-500">{item.created_by_name}</span>
                        <span>{dayjs(item.created_at).format('YYYY-MM-DD HH:mm')}</span>
                        {item.status === 'processed' && item.processed_by_name ? (
                          <span>
                            由 {item.processed_by_name} 处理
                            {item.processed_at ? ` · ${dayjs(item.processed_at).format('YYYY-MM-DD HH:mm')}` : ''}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => likeMutation.mutate(item.id)}
                          className={[
                            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                            item.liked
                              ? 'border-indigo-200 bg-indigo-50 text-indigo-600'
                              : 'border-slate-200 bg-white text-slate-400 hover:border-indigo-200 hover:text-indigo-500',
                          ].join(' ')}
                        >
                          <ThumbsUp className="h-3 w-3" strokeWidth={1.5} />
                          <span>{item.like_count}</span>
                        </button>
                        {canProcess ? (
                          <Popconfirm
                            title="标记为已处理？"
                            description="处理后状态不可恢复"
                            okText="确认"
                            cancelText="取消"
                            onConfirm={() => processMutation.mutate(item.id)}
                          >
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-slate-300 transition-colors hover:text-emerald-500"
                            >
                              <CheckCircle2 className="h-3 w-3" strokeWidth={1.5} />
                              <span>设为已处理</span>
                            </button>
                          </Popconfirm>
                        ) : null}
                        {canDelete ? (
                          <Popconfirm
                            title="确定删除该反馈？"
                            description="删除后不可恢复"
                            okText="删除"
                            cancelText="取消"
                            onConfirm={() => deleteMutation.mutate(item.id)}
                          >
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-slate-300 transition-colors hover:text-rose-500"
                            >
                              <Trash2 className="h-3 w-3" strokeWidth={1.5} />
                              <span>删除</span>
                            </button>
                          </Popconfirm>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-indigo-50 px-5 py-3">
          <div className="text-[12px] text-slate-400">
            第 {total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, total)} 条 / 共 {total} 条
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-indigo-100 text-slate-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
            <span className="px-1 text-[12px] text-slate-500">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-indigo-100 text-slate-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </div>

      <TsModal
        title="提交反馈"
        subtitle="你的建议会直接帮助平台变得更好"
        titleIcon={<Send className="h-4 w-4" strokeWidth={1.5} />}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => createMutation.mutate({ title: formTitle.trim(), content: formContent.trim(), category: formCategory })}
        confirmLoading={createMutation.isPending}
        width={560}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-slate-600">反馈类型</label>
            <div className="grid grid-cols-4 gap-2">
              {categoryOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFormCategory(option.value)}
                  className={[
                    'flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 text-[12px] font-medium transition-colors',
                    formCategory === option.value
                      ? 'border-indigo-300 bg-indigo-50/60 text-indigo-600'
                      : 'border-indigo-50 bg-white text-slate-500 hover:border-indigo-200 hover:text-indigo-600',
                  ].join(' ')}
                >
                  <span className={`flex h-7 w-7 items-center justify-center rounded-md ${option.iconClass}`}>
                    <option.icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </span>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-slate-600">标题</label>
            <input
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              maxLength={200}
              placeholder="一句话概括你的建议或问题"
              className="w-full rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[13px] text-slate-700 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-slate-600">详细描述</label>
            <textarea
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              rows={5}
              placeholder="描述使用场景、期望效果或遇到的问题，越具体越容易跟进"
              className="w-full resize-none rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[13px] leading-5 text-slate-700 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>
        </div>
      </TsModal>
    </div>
  );
}
