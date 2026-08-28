import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Checkbox,
  DatePicker,
  Form,
  Input,
  Modal,
  Popconfirm,
  Typography,
  message,
} from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Ban,
  CircleCheck,
  KeyRound,
  ChevronLeft,
  ChevronRight,
  Clock,
} from 'lucide-react';
import { systemApi } from '@/api/system';
import type { AccessToken, AccessTokenCreated, AccessTokenScope } from '@/api/system';

/** 接口范围中文映射（与后端常量保持一致） */
const SCOPE_LABELS: Record<AccessTokenScope, string> = {
  'release.doc': '查询发布变更文档',
  'repo.compare': '查询 Tag 区间提交与 MR',
};

const scopeOptions = (Object.keys(SCOPE_LABELS) as AccessTokenScope[]).map((value) => ({
  label: SCOPE_LABELS[value],
  value,
}));

interface FormValues {
  name: string;
  scopes: AccessTokenScope[];
  expires_at?: Dayjs | null;
  remark?: string;
}

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const d = dayjs(value);
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : value;
}

/** 状态徽标（与系统模块其他页面一致） */
function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      启用
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
      禁用
    </span>
  );
}

export default function AccessTokenList() {
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AccessToken | null>(null);
  const [createdToken, setCreatedToken] = useState<AccessToken | null>(null);
  const [createdPlain, setCreatedPlain] = useState('');
  const [form] = Form.useForm<FormValues>();

  const { data, isLoading } = useQuery({
    queryKey: ['system-access-tokens', keyword, page, pageSize],
    queryFn: () =>
      systemApi.listAccessTokens({
        page,
        page_size: pageSize,
        search: keyword || undefined,
      }),
  });

  const tokens = data?.results || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['system-access-tokens'] });

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = {
        name: values.name.trim(),
        scopes: values.scopes,
        expires_at: values.expires_at ? values.expires_at.toISOString() : null,
        remark: values.remark?.trim() || '',
      };
      if (editing) {
        return systemApi.updateAccessToken(editing.id, payload);
      }
      return systemApi.createAccessToken(payload);
    },
    onSuccess: (res: AccessToken | AccessTokenCreated) => {
      if (editing) {
        message.success('保存成功');
        invalidate();
      } else if (res && 'token' in res) {
        // 创建成功：明文 token 仅此一次展示
        setCreatedToken(res);
        setCreatedPlain(res.token);
      }
      setFormOpen(false);
      setEditing(null);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (record: AccessToken) =>
      systemApi.updateAccessToken(record.id, { is_active: !record.is_active }),
    onSuccess: (_res, record) => {
      message.success(record.is_active ? '已禁用' : '已启用');
      invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => systemApi.deleteAccessToken(id),
    onSuccess: () => {
      message.success('删除成功');
      invalidate();
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ name: '', scopes: [], expires_at: null, remark: '' });
    setFormOpen(true);
  };

  const openEdit = (record: AccessToken) => {
    setEditing(record);
    form.setFieldsValue({
      name: record.name,
      scopes: record.scopes || [],
      expires_at: record.expires_at ? dayjs(record.expires_at) : null,
      remark: record.remark || '',
    });
    setFormOpen(true);
  };

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="space-y-5 page-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">访问令牌</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            签发和管理对外开放接口（/api/open/）的 Access Token，仅超管可操作
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          新建令牌
        </button>
      </div>

      <div className="tech-card overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center gap-2 border-b border-indigo-50 px-5 py-3">
          <div className="relative w-full sm:w-auto">
            <Search
              className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              strokeWidth={1.5}
            />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setPage(1);
              }}
              placeholder="搜索名称 / Token 前缀 / 备注"
              className="w-full rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:w-[260px]"
            />
          </div>
          <div className="ml-auto text-[12px] text-slate-400">共 {total} 个令牌</div>
        </div>

        {/* 桌面端表头 */}
        <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
          <div className="col-span-2">名称</div>
          <div className="col-span-2">Token 前缀</div>
          <div className="col-span-2">接口范围</div>
          <div className="col-span-1">状态</div>
          <div className="col-span-2">过期时间</div>
          <div className="col-span-2">最近使用</div>
          <div className="col-span-1 text-right">操作</div>
        </div>

        <div className="divide-y divide-indigo-50/50 max-h-[calc(100vh-340px)] overflow-y-auto max-md:max-h-none max-md:divide-y-0 max-md:space-y-3 max-md:p-3">
          {isLoading ? (
            <div className="px-5 py-12 text-center text-[13px] text-slate-400">加载中…</div>
          ) : tokens.length === 0 ? (
            <div className="px-5 py-12 text-center text-[13px] text-slate-400">暂无访问令牌</div>
          ) : (
            tokens.map((t) => (
              <div
                key={t.id}
                onClick={() => openEdit(t)}
                className="cursor-pointer transition-colors hover:bg-indigo-50/30 max-md:rounded-xl max-md:border max-md:border-indigo-100/70 max-md:bg-white max-md:p-4"
              >
                {/* 桌面端网格行 */}
                <div className="hidden grid-cols-12 items-center gap-3 px-5 py-3 md:grid">
                  <div className="col-span-2 min-w-0">
                    <div className="truncate text-[13px] font-medium text-slate-900">{t.name}</div>
                    {t.remark ? (
                      <div className="mt-0.5 truncate text-[11px] text-slate-400">{t.remark}</div>
                    ) : null}
                  </div>
                  <div className="col-span-2">
                    <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[12px] text-slate-600">
                      {t.token_prefix}…
                    </span>
                  </div>
                  <div className="col-span-2 flex flex-wrap items-center gap-1">
                    {(t.scopes || []).length === 0 ? (
                      <span className="text-[11px] text-slate-400">-</span>
                    ) : (
                      (t.scopes || []).map((s) => (
                        <span
                          key={s}
                          className="inline-flex items-center rounded-md border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700"
                        >
                          {SCOPE_LABELS[s] || s}
                        </span>
                      ))
                    )}
                  </div>
                  <div className="col-span-1">
                    <StatusBadge active={t.is_active} />
                  </div>
                  <div className="col-span-2 text-[12px] text-slate-600">
                    {t.expires_at ? formatDateTime(t.expires_at) : (
                      <span className="text-slate-400">永久有效</span>
                    )}
                  </div>
                  <div className="col-span-2">
                    {t.last_used_at ? (
                      <div>
                        <div className="text-[12px] text-slate-600">{formatDateTime(t.last_used_at)}</div>
                        <div className="font-mono text-[11px] text-slate-400">{t.last_used_ip || '-'}</div>
                      </div>
                    ) : (
                      <span className="text-[12px] text-slate-400">从未使用</span>
                    )}
                  </div>
                  <div className="col-span-1 flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleMutation.mutate(t); }}
                      className={
                        t.is_active
                          ? 'rounded-md p-1.5 text-slate-400 transition-colors hover:bg-amber-50 hover:text-amber-600'
                          : 'rounded-md p-1.5 text-slate-400 transition-colors hover:bg-emerald-50 hover:text-emerald-600'
                      }
                      title={t.is_active ? '禁用' : '启用'}
                    >
                      {t.is_active ? (
                        <Ban className="h-3.5 w-3.5" strokeWidth={1.5} />
                      ) : (
                        <CircleCheck className="h-3.5 w-3.5" strokeWidth={1.5} />
                      )}
                    </button>
                    <Popconfirm
                      title="确定删除该令牌？"
                      description="删除后使用该 Token 的调用将立即失效。"
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => deleteMutation.mutate(t.id)}
                    >
                      <button
                        type="button"
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500"
                        title="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </button>
                    </Popconfirm>
                    <ChevronRight className="h-4 w-4 text-slate-300" strokeWidth={1.5} />
                  </div>
                </div>

                {/* 移动端卡片 */}
                <div className="md:hidden">
                  <div className="flex items-center justify-between">
                    <StatusBadge active={t.is_active} />
                    <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">
                      {t.token_prefix}…
                    </span>
                  </div>
                  <div className="mt-2">
                    <span className="text-[15px] font-semibold tracking-tight text-slate-900">{t.name}</span>
                    {t.remark ? (
                      <div className="mt-0.5 truncate text-[11px] text-slate-400">{t.remark}</div>
                    ) : null}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                    <Clock className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                    <span className="truncate">
                      {t.expires_at ? `${formatDateTime(t.expires_at)} 过期` : '永久有效'}
                      {t.last_used_at ? ` · 最近使用 ${formatDateTime(t.last_used_at)}` : ' · 从未使用'}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-indigo-50 pt-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                      {(t.scopes || []).length === 0 ? (
                        <span className="text-[11px] text-slate-400">-</span>
                      ) : (
                        (t.scopes || []).map((s) => (
                          <span
                            key={s}
                            className="inline-flex items-center rounded-md border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700"
                          >
                            {SCOPE_LABELS[s] || s}
                          </span>
                        ))
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleMutation.mutate(t); }}
                        className="rounded-md p-2 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                        title={t.is_active ? '禁用' : '启用'}
                      >
                        {t.is_active ? (
                          <Ban className="h-4 w-4" strokeWidth={1.5} />
                        ) : (
                          <CircleCheck className="h-4 w-4" strokeWidth={1.5} />
                        )}
                      </button>
                      <Popconfirm
                        title="确定删除该令牌？"
                        okText="删除"
                        cancelText="取消"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => deleteMutation.mutate(t.id)}
                      >
                        <button
                          type="button"
                          onClick={(e) => e.stopPropagation()}
                          className="rounded-md p-2 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500"
                          title="删除"
                        >
                          <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                        </button>
                      </Popconfirm>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openEdit(t); }}
                        className="rounded-md p-2 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                        title="编辑"
                      >
                        <Pencil className="h-4 w-4" strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* 分页 */}
        <div className="flex items-center justify-between border-t border-indigo-50 px-5 py-3">
          <div className="text-[12px] text-slate-400">
            {total === 0 ? '暂无数据' : `第 ${start}-${end} 条 / 共 ${total} 条`}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-indigo-100 text-slate-400 transition-colors hover:bg-indigo-50 disabled:opacity-40 max-md:h-9 max-md:w-9"
            >
              <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
            {Array.from({ length: totalPages }).slice(0, 7).map((_, idx) => {
              const p = idx + 1;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPage(p)}
                  className={[
                    'flex h-7 w-7 items-center justify-center rounded-md text-[12px] font-medium transition-colors max-md:h-9 max-md:w-9',
                    p === page
                      ? 'bg-indigo-500 text-white'
                      : 'border border-indigo-100 text-slate-600 hover:bg-indigo-50',
                  ].join(' ')}
                >
                  {p}
                </button>
              );
            })}
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-indigo-100 text-slate-400 transition-colors hover:bg-indigo-50 disabled:opacity-40 max-md:h-9 max-md:w-9"
            >
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </div>

      {/* 新建 / 编辑令牌 */}
      <Modal
        title={editing ? '编辑令牌' : '新建令牌'}
        open={formOpen}
        onCancel={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onOk={() => form.submit()}
        confirmLoading={saveMutation.isPending}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Form<FormValues>
          form={form}
          layout="vertical"
          onFinish={(values) => saveMutation.mutate(values)}
          className="pt-2"
        >
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, whitespace: true, message: '请输入令牌名称' }]}
          >
            <Input placeholder="如：CI 流水线只读令牌" maxLength={64} />
          </Form.Item>
          <Form.Item
            name="scopes"
            label="接口范围"
            rules={[
              {
                validator: (_rule, value: AccessTokenScope[]) =>
                  value && value.length > 0
                    ? Promise.resolve()
                    : Promise.reject(new Error('请至少勾选一个接口范围')),
              },
            ]}
          >
            <Checkbox.Group options={scopeOptions} />
          </Form.Item>
          <Form.Item
            name="expires_at"
            label="过期时间"
            extra="留空表示永久有效"
          >
            <DatePicker
              showTime
              allowClear
              className="w-full"
              placeholder="选择过期时间"
              disabledDate={(current) => current && current.isBefore(dayjs().startOf('day'))}
            />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} placeholder="用途说明（可选）" maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 创建成功：一次性展示明文 Token */}
      <Modal
        open={Boolean(createdToken)}
        footer={null}
        closable={false}
        mask={{ closable: false }}
        onCancel={() => {
          setCreatedToken(null);
          setCreatedPlain('');
        }}
      >
        <div className="space-y-4 pt-1">
          <div className="flex items-center gap-2">
            <div className="icon-violet flex h-8 w-8 items-center justify-center rounded-lg">
              <KeyRound className="h-4 w-4" strokeWidth={1.5} />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">
                令牌创建成功
              </h3>
              <p className="text-[12px] text-slate-400">{createdToken?.name}</p>
            </div>
          </div>
          <Alert
            type="warning"
            showIcon
            message="Token 仅此一次展示，请立即复制并妥善保存，关闭后将无法再次查看。"
          />
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
            <Typography.Text copyable={{ text: createdPlain }} className="font-mono text-[13px]">
              {createdPlain}
            </Typography.Text>
          </div>
          <div className="text-[12px] leading-5 text-slate-500">
            外部系统调用开放接口时在请求头携带：
            <span className="font-mono text-[12px] text-slate-700">
              Authorization: Bearer &lt;token&gt;
            </span>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                setCreatedToken(null);
                setCreatedPlain('');
                invalidate();
              }}
              className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium text-white"
            >
              我已保存，关闭
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
