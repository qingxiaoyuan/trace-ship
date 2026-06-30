import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { message, Popconfirm } from 'antd';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Save,
  X,
  Check,
} from 'lucide-react';
import { systemApi } from '@/api/system';
import type { SystemConfig } from '@/api/system';

interface FormState {
  key: string;
  value: string;
  description: string;
  is_public: boolean;
}

const emptyForm: FormState = {
  key: '',
  value: '',
  description: '',
  is_public: false,
};

function formatDate(dateStr?: string): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

export default function SystemConfigPage() {
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['system-configs', keyword, page, pageSize],
    queryFn: () =>
      systemApi.getConfigs({
        page,
        page_size: pageSize,
        keyword: keyword || undefined,
      }),
  });

  const configs = useMemo(() => data?.results || [], [data]);
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const filtered = useMemo(() => {
    if (!keyword.trim()) return configs;
    const kw = keyword.toLowerCase();
    return configs.filter(
      (c) => c.key.toLowerCase().includes(kw) || (c.description || '').toLowerCase().includes(kw)
    );
  }, [configs, keyword]);

  const saveMutation = useMutation({
    mutationFn: async (payload: FormState) => {
      const body = {
        key: payload.key,
        value: payload.value,
        description: payload.description,
        is_public: payload.is_public,
      };
      if (editingKey) {
        return systemApi.updateConfig(editingKey, body);
      }
      return systemApi.createConfig(body);
    },
    onSuccess: () => {
      message.success('保存成功');
      queryClient.invalidateQueries({ queryKey: ['system-configs'] });
      setModalOpen(false);
      setSaving(false);
    },
    onError: () => {
      message.error('保存失败');
      setSaving(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (key: string) => systemApi.deleteConfig(key),
    onSuccess: () => {
      message.success('删除成功');
      queryClient.invalidateQueries({ queryKey: ['system-configs'] });
    },
    onError: () => message.error('删除失败'),
  });

  const openCreate = () => {
    setForm(emptyForm);
    setEditingKey(null);
    setModalOpen(true);
  };

  const openEdit = (cfg: SystemConfig) => {
    setForm({
      key: cfg.key,
      value: cfg.value,
      description: cfg.description || '',
      is_public: cfg.is_public,
    });
    setEditingKey(cfg.key);
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!form.key.trim()) {
      message.warning('请输入配置键');
      return;
    }
    if (!form.value.trim()) {
      message.warning('请输入配置值');
      return;
    }
    setSaving(true);
    saveMutation.mutate(form);
  };

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="space-y-5 page-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">系统配置</h1>
          <p className="mt-1 text-[13px] text-slate-500">管理 key-value 形式的系统级参数配置</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          新增配置
        </button>
      </div>

      <div className="tech-card overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center gap-2 border-b border-indigo-50 px-5 py-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" strokeWidth={1.5} />
            <input
              type="text"
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
              placeholder="搜索配置键 / 说明"
              className="w-[220px] rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div className="ml-auto text-[12px] text-slate-400">共 {total} 项</div>
        </div>

        <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
          <div className="col-span-3">配置键</div>
          <div className="col-span-3">配置值</div>
          <div className="col-span-3">说明</div>
          <div className="col-span-1 text-center">公开</div>
          <div className="col-span-1">更新时间</div>
          <div className="col-span-1 text-right">操作</div>
        </div>

        <div className="divide-y divide-indigo-50/50 max-h-[calc(100vh-340px)] overflow-y-auto">
          {isLoading ? (
            <div className="px-5 py-12 text-center text-[13px] text-slate-400">加载中…</div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-12 text-center text-[13px] text-slate-400">暂无配置数据</div>
          ) : (
            filtered.map((cfg) => (
              <div
                key={cfg.id || cfg.key}
                onClick={() => openEdit(cfg)}
                className="grid grid-cols-12 cursor-pointer items-center gap-3 px-5 py-3.5 transition-colors hover:bg-indigo-50/30"
              >
                <div className="col-span-12 font-mono text-[12px] font-medium text-indigo-600 md:col-span-3">{cfg.key}</div>
                <div className="col-span-12 truncate font-mono text-[12px] text-slate-700 md:col-span-3">{cfg.value}</div>
                <div className="col-span-12 truncate text-[12px] text-slate-500 md:col-span-3">{cfg.description || '-'}</div>
                <div className="col-span-3 text-center md:col-span-1">
                  {cfg.is_public ? (
                    <span className="inline-flex items-center rounded border border-emerald-200 bg-emerald-50 px-1 py-0.5 text-[10px] font-medium text-emerald-700">是</span>
                  ) : (
                    <span className="inline-flex items-center rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[10px] font-medium text-slate-500">否</span>
                  )}
                </div>
                <div className="col-span-6 text-[11px] text-slate-400 md:col-span-1">{formatDate(cfg.updated_at)}</div>
                <div className="col-span-3 flex items-center justify-end gap-1 md:col-span-1">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); openEdit(cfg); }}
                    className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                    title="编辑"
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                  <Popconfirm
                    title="确定删除该配置？"
                    onConfirm={(e) => {
                      e?.stopPropagation();
                      deleteMutation.mutate(cfg.key);
                    }}
                    onCancel={(e) => e?.stopPropagation()}
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
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-indigo-50 px-5 py-3">
          <div className="text-[12px] text-slate-400">
            {total === 0 ? '暂无数据' : `第 ${start}-${end} 条 / 共 ${total} 条`}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-indigo-100 text-slate-400 transition-colors hover:bg-indigo-50 disabled:opacity-40"
            >
              ‹
            </button>
            {Array.from({ length: totalPages }).slice(0, 7).map((_, idx) => {
              const p = idx + 1;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPage(p)}
                  className={[
                    'flex h-7 w-7 items-center justify-center rounded-md text-[12px] font-medium transition-colors',
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
              className="flex h-7 w-7 items-center justify-center rounded-md border border-indigo-100 text-slate-400 transition-colors hover:bg-indigo-50 disabled:opacity-40"
            >
              ›
            </button>
          </div>
        </div>
      </div>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(15,23,42,.3)', backdropFilter: 'blur(2px)' }}
          onClick={() => setModalOpen(false)}
        >
          <div
            className="tech-card mx-4 w-full max-w-[480px] rounded-xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">
                {editingKey ? '编辑配置' : '新增配置'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-md p-1 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-slate-600">
                  配置键 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.key}
                  onChange={(e) => setForm({ ...form, key: e.target.value })}
                  disabled={Boolean(editingKey)}
                  placeholder="如：ldap_server_uri"
                  className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-mono text-[13px] text-slate-700 placeholder-slate-400 outline-none disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-slate-600">
                  配置值 <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={2}
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                  placeholder="配置值"
                  className="input-field w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-mono text-[13px] text-slate-700 placeholder-slate-400 outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-slate-600">说明</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="配置说明"
                  className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[13px] text-slate-700 placeholder-slate-400 outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => setForm({ ...form, is_public: !form.is_public })}
                className="flex items-center gap-2"
              >
                <span
                  className="relative inline-flex h-4 w-4 items-center justify-center rounded border-2"
                  style={{
                    borderColor: form.is_public ? '#4F46E5' : '#CBD5E1',
                    background: form.is_public ? '#4F46E5' : 'transparent',
                  }}
                >
                  {form.is_public ? <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} /> : null}
                </span>
                <span className="text-[13px] text-slate-700">是否公开（前端可读取）</span>
              </button>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[13px] font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium text-white disabled:opacity-60"
              >
                <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
