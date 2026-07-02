import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Form, Input, Modal, Select, Space, Switch, Table, Tag } from 'antd';
import { PlusOutlined, EditOutlined } from '@ant-design/icons';
import { packageApi } from '@/api/package';
import type { PackageBuildType, PackageImage } from '@/types';

const buildTypeOptions = [
  { label: 'Web', value: 'web' },
  { label: 'Qt', value: 'qt' },
];

export default function PackageImagePage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PackageImage | null>(null);
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

  return (
    <div className="space-y-5 page-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">打包镜像</h1>
          <p className="mt-1 text-[13px] text-slate-500">维护简易打包可选的 Docker 镜像和脚本入口</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); setOpen(true); }}>
          新增镜像
        </Button>
      </div>

      <div className="tech-card rounded-xl p-4">
        <Table
          rowKey="id"
          loading={isLoading}
          dataSource={rows}
          pagination={false}
          columns={[
            { title: '名称', dataIndex: 'name' },
            {
              title: '类型',
              dataIndex: 'build_type',
              render: (type: PackageBuildType) => <Tag color={type === 'web' ? 'blue' : 'purple'}>{type === 'web' ? 'Web' : 'Qt'}</Tag>,
            },
            { title: '镜像', dataIndex: 'image', render: (v: string) => <span className="font-mono text-xs">{v}</span> },
            { title: '脚本入口', dataIndex: 'script_entry', render: (v: string) => <span className="font-mono text-xs">{v}</span> },
            { title: '默认构建目录', dataIndex: 'default_build_path' },
            { title: '默认产物目录', dataIndex: 'default_output_path' },
            { title: '状态', dataIndex: 'is_active', render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '停用'}</Tag> },
            {
              title: '操作',
              key: 'action',
              render: (_, record) => (
                <Space>
                  <Button type="text" icon={<EditOutlined />} onClick={() => { setEditing(record); setOpen(true); }}>
                    编辑
                  </Button>
                  <Button
                    type="text"
                    danger
                    onClick={() => modal.confirm({
                      title: '删除镜像',
                      content: `确定删除「${record.name}」吗？`,
                      onOk: () => deleteMutation.mutate(record.id),
                    })}
                  >
                    删除
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </div>

      <Modal
        title={editing ? '编辑打包镜像' : '新增打包镜像'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saveMutation.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)}>
          <Form.Item name="name" label="镜像名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="build_type" label="打包类型" rules={[{ required: true }]}>
            <Select options={buildTypeOptions} />
          </Form.Item>
          <Form.Item name="image" label="Docker 镜像" rules={[{ required: true }]}>
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
      </Modal>
    </div>
  );
}
