import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Form, Input, Select, Switch } from 'antd';
import {
  Plus,
  Search,
  ChevronRight,
  Box,
  Container,
  Save,
} from 'lucide-react';
import type { FormInstance } from 'antd';
import { packageApi } from '@/api/package';
import type { PackageImage } from '@/types';

const buildTypeOptions = [
  { label: 'Web', value: 'web' },
  { label: 'Qt', value: 'qt' },
];

const typeBadgeMap: Record<string, string> = {
  web: 'border-indigo-200 bg-indigo-50 text-indigo-600',
  qt: 'border-violet-200 bg-violet-50 text-violet-700',
};

const typeIconClassMap: Record<string, string> = {
  web: 'icon-indigo',
  qt: 'icon-violet',
};

function typeLabel(type: string): string {
  return type === 'web' ? 'Web' : 'Qt';
}

export default function PackageImagePage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PackageImage | null>(null);
  const [keyword, setKeyword] = useState('');
  const [form] = Form.useForm<Partial<PackageImage>>();

  const { data, isLoading } = useQuery({
    queryKey: ['package-images'],
    queryFn: () => packageApi.getImages({ page_size: 1000 }),
  });

  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.setFieldsValue(editing);
    } else {
      form.setFieldsValue({
        build_type: 'web',
        script_entry: '/usr/local/bin/trace-ship-build',
        default_build_path: '.',
        default_output_path: 'dist',
        is_active: true,
      });
    }
  }, [editing, form, open]);

  const saveMutation = useMutation({
    mutationFn: (values: Partial<PackageImage>) =>
      editing ? packageApi.updateImage(editing.id, values) : packageApi.createImage(values),
    onSuccess: () => {
      message.success('保存成功');
      setOpen(false);
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['package-images'] });
    },
    onError: () => message.error('保存失败'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => packageApi.deleteImage(id),
    onSuccess: () => {
      message.success('删除成功');
      queryClient.invalidateQueries({ queryKey: ['package-images'] });
    },
    onError: () => message.error('删除失败'),
  });

  const rows = data?.results || [];

  const filtered = keyword.trim()
    ? rows.filter((r) => {
        const kw = keyword.toLowerCase();
        return r.name.toLowerCase().includes(kw) || r.image.toLowerCase().includes(kw);
      })
    : rows;

  return (
    <div className="space-y-5 page-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">打包镜像</h1>
          <p className="mt-1 text-[13px] text-slate-500">维护简易打包可选的 Docker 镜像和脚本入口</p>
        </div>
        <button
          type="button"
          onClick={() => { setEditing(null); setOpen(true); }}
          className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          新增镜像
        </button>
      </div>

      <div className="tech-card overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center gap-2 border-b border-indigo-50 px-5 py-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" strokeWidth={1.5} />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索名称 / 镜像"
              className="w-[200px] rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div className="ml-auto text-[12px] text-slate-400">共 {filtered.length} 个镜像</div>
        </div>

        <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
          <div className="col-span-3">名称</div>
          <div className="col-span-1">类型</div>
          <div className="col-span-3">镜像</div>
          <div className="col-span-2">脚本入口</div>
          <div className="col-span-1">构建目录</div>
          <div className="col-span-1">产物目录</div>
          <div className="col-span-1 text-center">状态</div>
        </div>

        <div className="divide-y divide-indigo-50/50 max-h-[calc(100vh-300px)] overflow-y-auto">
          {isLoading ? (
            <div className="px-5 py-12 text-center text-[13px] text-slate-400">加载中…</div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <Box className="mx-auto h-10 w-10 text-slate-300" strokeWidth={1.5} />
              <p className="mt-3 text-[13px] text-slate-400">暂无镜像数据</p>
            </div>
          ) : (
            filtered.map((img) => (
              <div
                key={img.id}
                onClick={() => { setEditing(img); setOpen(true); }}
                className="grid grid-cols-12 cursor-pointer items-center gap-3 px-5 py-3 transition-colors hover:bg-indigo-50/30"
              >
                <div className="col-span-12 flex items-center gap-2 md:col-span-3">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${typeIconClassMap[img.build_type] || 'icon-indigo'}`}>
                    <Container className="h-4 w-4" strokeWidth={1.5} />
                  </div>
                  <span className="text-[13px] font-medium text-slate-900">{img.name}</span>
                </div>
                <div className="col-span-6 md:col-span-1">
                  <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${typeBadgeMap[img.build_type] || 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                    {typeLabel(img.build_type)}
                  </span>
                </div>
                <div className="col-span-12 font-mono text-[11px] text-slate-500 truncate md:col-span-3">
                  {img.image}
                </div>
                <div className="col-span-6 font-mono text-[11px] text-slate-500 truncate md:col-span-2">
                  {img.script_entry}
                </div>
                <div className="col-span-3 text-[12px] text-slate-600 md:col-span-1">{img.default_build_path}</div>
                <div className="col-span-3 text-[12px] text-slate-600 md:col-span-1">{img.default_output_path}</div>
                <div className="col-span-6 flex items-center justify-center md:col-span-1">
                  {img.is_active ? (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      启用
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                      停用
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {open && (
        <ImageFormDrawer
          editing={editing}
          form={form}
          saving={saveMutation.isPending}
          onCancel={() => { setOpen(false); setEditing(null); }}
          onSubmit={(values) => saveMutation.mutate(values)}
          onDelete={editing ? (id) => {
            modal.confirm({
              title: '删除镜像',
              content: `确定删除「${editing.name}」吗？`,
              onOk: () => {
                deleteMutation.mutate(id);
                setOpen(false);
                setEditing(null);
              },
            });
          } : undefined}
        />
      )}
    </div>
  );
}

interface ImageFormDrawerProps {
  editing: PackageImage | null;
  form: FormInstance<Partial<PackageImage>>;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (values: Partial<PackageImage>) => void;
  onDelete?: (id: string) => void;
}

function ImageFormDrawer({ editing, form, saving, onCancel, onSubmit, onDelete }: ImageFormDrawerProps) {
  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-sm"
        onClick={onCancel}
      />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-indigo-50 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg icon-indigo">
              <Container className="h-3.5 w-3.5" strokeWidth={1.5} />
            </div>
            <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">
              {editing ? '编辑打包镜像' : '新增打包镜像'}
            </h3>
          </div>
          <button
            onClick={onCancel}
            className="rounded-md p-1.5 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600"
          >
            <ChevronRight className="h-4 w-4 rotate-180" strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <Form form={form} layout="vertical" onFinish={onSubmit}>
            <Form.Item name="name" label="镜像名称" rules={[{ required: true, message: '请输入镜像名称' }]}>
              <Input placeholder="如：Web 构建镜像" />
            </Form.Item>
            <Form.Item name="build_type" label="打包类型" rules={[{ required: true }]}>
              <Select options={buildTypeOptions} />
            </Form.Item>
            <Form.Item name="image" label="Docker 镜像" rules={[{ required: true, message: '请输入镜像地址' }]}>
              <Input placeholder="registry.example.com/build/web:latest" />
            </Form.Item>
            <Form.Item name="script_entry" label="镜像脚本入口" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <div className="grid grid-cols-2 gap-3">
              <Form.Item name="default_build_path" label="默认构建目录" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="default_output_path" label="默认产物目录" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </div>
            <Form.Item name="is_active" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Form>
        </div>
        <div className="flex items-center gap-2 border-t border-indigo-50 px-5 py-3.5">
          {editing && onDelete && (
            <button
              type="button"
              onClick={() => onDelete(editing.id)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-2 text-[13px] font-medium text-rose-600 transition-colors hover:bg-rose-50"
            >
              删除
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[13px] font-medium text-slate-600 hover:bg-indigo-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => form.submit()}
            className="btn-glow flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white disabled:opacity-60"
          >
            <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
            保存
          </button>
        </div>
      </aside>
    </>
  );
}
