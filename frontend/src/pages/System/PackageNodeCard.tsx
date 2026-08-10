import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Form, Input, InputNumber, Modal, Select, Switch } from 'antd';
import { Monitor, Pencil, PlugZap, Plus, Trash2 } from 'lucide-react';
import { packageApi } from '@/api/package';
import { credentialApi } from '@/api/credential';
import type { PackageNode } from '@/types';

interface NodeFormValues {
  name: string;
  host: string;
  port: number;
  credential: string;
  work_root: string;
  description?: string;
  is_active: boolean;
}

/** 系统配置页面：远程打包节点（Windows，SSH/SFTP 接入）管理卡片 */
export function PackageNodeCard() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<NodeFormValues>();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PackageNode | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['package-nodes'],
    queryFn: () => packageApi.getNodes({ page_size: 100 }),
  });
  const nodes = data?.results || [];

  const { data: credData } = useQuery({
    queryKey: ['credentials', 'windows_password'],
    queryFn: () => credentialApi.getCredentials({ cred_type: 'windows_password', page_size: 100 }),
  });
  const credentialOptions = (credData?.results || []).map((c) => ({
    value: c.id,
    label: `${c.name}（${c.username || '-'}）`,
  }));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['package-nodes'] });

  const saveMutation = useMutation({
    mutationFn: (values: NodeFormValues) =>
      editing
        ? packageApi.updateNode(editing.id, values)
        : packageApi.createNode(values),
    onSuccess: () => {
      message.success(editing ? '节点已更新' : '节点已创建');
      setModalOpen(false);
      setEditing(null);
      invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => packageApi.deleteNode(id),
    onSuccess: () => {
      message.success('节点已删除');
      invalidate();
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => packageApi.testNode(id),
    onSuccess: (result) => {
      message.success(
        result.git
          ? `连接成功：${result.os || 'Windows'}，检测到 git`
          : `连接成功：${result.os || 'Windows'}，但未检测到 git，打包时将无法拉取源码`,
      );
    },
  });

  const testFormMutation = useMutation({
    mutationFn: (values: NodeFormValues) =>
      packageApi.testNodeConnection({
        host: values.host,
        port: values.port,
        credential_id: values.credential,
        work_root: values.work_root,
      }),
    onSuccess: (result) => {
      message.success(
        result.git
          ? `连接成功：${result.os || 'Windows'}，检测到 git`
          : `连接成功：${result.os || 'Windows'}，但未检测到 git，打包时将无法拉取源码`,
      );
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({
      name: '',
      host: '',
      port: 22,
      credential: undefined as unknown as string,
      work_root: 'C:\\trace-ship\\workspaces',
      description: '',
      is_active: true,
    });
    setModalOpen(true);
  };

  const openEdit = (node: PackageNode) => {
    setEditing(node);
    form.setFieldsValue({
      name: node.name,
      host: node.host,
      port: node.port,
      credential: node.credential || undefined,
      work_root: node.work_root,
      description: node.description || '',
      is_active: node.is_active,
    });
    setModalOpen(true);
  };

  const handleTestInModal = () => {
    form
      .validateFields(['host', 'port', 'credential', 'work_root'])
      .then(() => testFormMutation.mutate(form.getFieldsValue()))
      .catch(() => undefined);
  };

  const handleDelete = (node: PackageNode) => {
    modal.confirm({
      title: '删除打包节点',
      content: `确定删除节点「${node.name}」吗？引用该节点的打包配置将无法再执行远程打包。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => deleteMutation.mutateAsync(node.id),
    });
  };

  return (
    <div className="tech-card rounded-xl px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg icon-cyan">
            <Monitor className="h-3.5 w-3.5" strokeWidth={1.5} />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-slate-900">远程打包节点</div>
            <div className="text-[11px] text-slate-400">
              Windows 节点通过 SSH/SFTP 接入，需预装 OpenSSH Server、git 与构建环境
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-white"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          新增节点
        </button>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-indigo-50">
        <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 bg-slate-50/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
          <div className="col-span-2">节点名称</div>
          <div className="col-span-3">地址</div>
          <div className="col-span-2">登录凭证</div>
          <div className="col-span-2">工作目录</div>
          <div className="col-span-1 text-center">状态</div>
          <div className="col-span-2 text-right">操作</div>
        </div>
        {isLoading ? (
          <div className="py-6 text-center text-[13px] text-slate-400">加载中…</div>
        ) : nodes.length === 0 ? (
          <div className="py-6 text-center text-[13px] text-slate-400">
            暂无节点，点击右上角「新增节点」接入 Windows 打包机
          </div>
        ) : (
          nodes.map((node) => (
            <div
              key={node.id}
              className="grid grid-cols-1 gap-2 border-b border-indigo-50 px-4 py-2.5 text-[13px] last:border-0 md:grid-cols-12 md:items-center md:gap-3"
            >
              <div className="col-span-2 font-medium text-slate-800">{node.name}</div>
              <div className="col-span-3 font-mono text-[12px] text-slate-600">
                {node.host}:{node.port}
              </div>
              <div className="col-span-2 text-[12px] text-slate-600">
                {node.credential_name || '-'}
              </div>
              <div className="col-span-2 truncate font-mono text-[12px] text-slate-500" title={node.work_root}>
                {node.work_root}
              </div>
              <div className="col-span-1 text-center">
                <span
                  className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
                    node.is_active
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                      : 'border-slate-200 bg-slate-50 text-slate-400'
                  }`}
                >
                  {node.is_active ? '启用' : '停用'}
                </span>
              </div>
              <div className="col-span-2 flex items-center justify-end gap-1">
                <button
                  type="button"
                  title="测试连接"
                  disabled={testMutation.isPending}
                  onClick={() => testMutation.mutate(node.id)}
                  className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-60"
                >
                  <PlugZap className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  title="编辑"
                  onClick={() => openEdit(node)}
                  className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  title="删除"
                  onClick={() => handleDelete(node)}
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
        title={editing ? '编辑打包节点' : '新增打包节点'}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onOk={() => form.validateFields().then((values) => saveMutation.mutate(values))}
        confirmLoading={saveMutation.isPending}
        okText="保存"
        cancelText="取消"
        width={560}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false} className="mt-2">
          <div className="grid grid-cols-2 gap-x-4">
            <Form.Item
              name="name"
              label="节点名称"
              rules={[{ required: true, message: '请输入节点名称' }]}
            >
              <Input placeholder="如：Windows 打包机-01" />
            </Form.Item>
            <Form.Item
              name="credential"
              label="登录凭证（Windows 密码）"
              rules={[{ required: true, message: '请选择登录凭证' }]}
            >
              <Select
                placeholder="请先在「凭证」页新增 Windows 凭证"
                options={credentialOptions}
                showSearch
                optionFilterProp="label"
              />
            </Form.Item>
            <Form.Item
              name="host"
              label="主机地址"
              rules={[{ required: true, message: '请输入主机地址' }]}
            >
              <Input placeholder="如：192.168.1.100" />
            </Form.Item>
            <Form.Item
              name="port"
              label="SSH 端口"
              rules={[{ required: true, message: '请输入端口' }]}
            >
              <InputNumber min={1} max={65535} className="w-full" />
            </Form.Item>
          </div>
          <Form.Item
            name="work_root"
            label="远程工作根目录"
            rules={[{ required: true, message: '请输入远程工作根目录' }]}
          >
            <Input placeholder="如：C:\trace-ship\workspaces" />
          </Form.Item>
          <Form.Item name="description" label="备注">
            <Input placeholder="可选" />
          </Form.Item>
          <div className="flex items-center justify-between">
            <Form.Item name="is_active" label="是否启用" valuePropName="checked" className="mb-0">
              <Switch />
            </Form.Item>
            <button
              type="button"
              disabled={testFormMutation.isPending}
              onClick={handleTestInModal}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-60"
            >
              <PlugZap className="h-3.5 w-3.5" strokeWidth={1.5} />
              测试连接
            </button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
