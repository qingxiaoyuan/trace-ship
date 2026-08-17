import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Form, Input, Modal, Switch } from 'antd';
import { Library, Pencil, Plus, Trash2 } from 'lucide-react';
import { packageApi } from '@/api/package';
import type { PackageKnowledge } from '@/types';

interface KnowledgeFormValues {
  title: string;
  content: string;
  is_active: boolean;
}

/** 系统配置页面：AI 打包通用知识库管理卡片（录入内容注入 AI 生成上下文） */
export function PackageKnowledgeCard() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<KnowledgeFormValues>();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PackageKnowledge | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['package-knowledge'],
    queryFn: () => packageApi.getKnowledge({ page_size: 100 }),
  });
  const entries = data?.results || [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['package-knowledge'] });

  const saveMutation = useMutation({
    mutationFn: (values: KnowledgeFormValues) =>
      editing
        ? packageApi.updateKnowledge(editing.id, values)
        : packageApi.createKnowledge(values),
    onSuccess: () => {
      message.success(editing ? '知识已更新' : '知识已创建');
      setModalOpen(false);
      setEditing(null);
      invalidate();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      packageApi.patchKnowledge(id, { is_active }),
    onSuccess: () => {
      message.success('状态已更新');
      invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => packageApi.deleteKnowledge(id),
    onSuccess: () => {
      message.success('知识已删除');
      invalidate();
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({ title: '', content: '', is_active: true });
    setModalOpen(true);
  };

  const openEdit = (item: PackageKnowledge) => {
    setEditing(item);
    form.setFieldsValue({
      title: item.title,
      content: item.content,
      is_active: item.is_active,
    });
    setModalOpen(true);
  };

  const handleDelete = (item: PackageKnowledge) => {
    modal.confirm({
      title: '删除知识条目',
      content: `确定删除「${item.title}」吗？删除后 AI 生成脚本时将不再引用该知识。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => deleteMutation.mutateAsync(item.id),
    });
  };

  return (
    <div className="tech-card rounded-xl px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg icon-emerald">
            <Library className="h-3.5 w-3.5" strokeWidth={1.5} />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-slate-900">AI 打包知识库</div>
            <div className="text-[11px] text-slate-400">
              录入通用打包规范 / 注意事项，AI 生成脚本时作为上下文注入（停用条目不生效）
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-white"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          新增知识
        </button>
      </div>

      <div className="mt-4 space-y-2">
        {isLoading ? (
          <div className="py-6 text-center text-[13px] text-slate-400">加载中…</div>
        ) : entries.length === 0 ? (
          <div className="py-6 text-center text-[13px] text-slate-400">
            暂无知识条目，可录入如「产物必须输出到 ARTIFACTS_DIR」「npm 源使用内网镜像」等通用规范
          </div>
        ) : (
          entries.map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-3 rounded-lg border border-indigo-50 bg-white px-3.5 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-slate-800">{item.title}</span>
                  <span
                    className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
                      item.is_active
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                        : 'border-slate-200 bg-slate-50 text-slate-400'
                    }`}
                  >
                    {item.is_active ? '生效中' : '已停用'}
                  </span>
                </div>
                <div className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-slate-500">
                  {item.content}
                </div>
                <div className="mt-1 text-[10px] text-slate-400">
                  {item.created_by_name || '-'} · 更新于{' '}
                  {item.updated_at ? item.updated_at.slice(0, 10) : '-'}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1 pt-1">
                <Switch
                  size="small"
                  checked={item.is_active}
                  disabled={toggleMutation.isPending}
                  onChange={(checked) =>
                    toggleMutation.mutate({ id: item.id, is_active: checked })
                  }
                />
                <button
                  type="button"
                  title="编辑"
                  onClick={() => openEdit(item)}
                  className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  title="删除"
                  onClick={() => handleDelete(item)}
                  className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <Modal
        title={editing ? '编辑知识条目' : '新增知识条目'}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onOk={() => form.validateFields().then((values) => saveMutation.mutate(values))}
        confirmLoading={saveMutation.isPending}
        okText="保存"
        cancelText="取消"
        width={640}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false} className="mt-2">
          <Form.Item
            name="title"
            label="标题"
            rules={[{ required: true, message: '请输入知识标题' }]}
          >
            <Input placeholder="如：打包产物规范 / npm 内网源约定" maxLength={200} />
          </Form.Item>
          <Form.Item
            name="content"
            label="内容"
            extra={<p className="mb-0 mt-1 text-[11px] text-slate-400">生成脚本时按更新时间倒序注入，最多引用 10 条 / 共 12000 字符</p>}
            rules={[{ required: true, message: '请输入知识内容' }]}
          >
            <Input.TextArea
              rows={8}
              placeholder="写清楚要求与原因，例如：产物必须输出到 $ARTIFACTS_DIR，因为平台只收集该目录；npm 安装必须使用内网镜像源…"
              maxLength={20000}
              showCount
            />
          </Form.Item>
          <Form.Item name="is_active" label="是否启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
