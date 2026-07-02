import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Form, Input, Modal, Select, Space, Switch, Table, Tag } from 'antd';
import { PlusOutlined, EditOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { packageApi } from '@/api/package';
import { releaseApi } from '@/api/release';
import { repositoryApi } from '@/api/repository';
import type { PackageBuildType, PackageConfig, PackageMode } from '@/types';

interface PackageTabProps {
  projectId: string;
}

const modeOptions = [
  { label: '简易打包', value: 'simple' },
  { label: '本地脚本', value: 'local' },
];

const buildTypeOptions = [
  { label: 'Web', value: 'web' },
  { label: 'Qt', value: 'qt' },
];

export function PackageTab({ projectId }: PackageTabProps) {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [editing, setEditing] = useState<PackageConfig | null>(null);
  const [triggerConfig, setTriggerConfig] = useState<PackageConfig | null>(null);
  const [form] = Form.useForm<Partial<PackageConfig>>();
  const [triggerForm] = Form.useForm<{ release_id: string }>();
  const mode = (Form.useWatch('mode', form) || 'simple') as PackageMode;
  const buildType = (Form.useWatch('build_type', form) || 'web') as PackageBuildType;

  const { data, isLoading } = useQuery({
    queryKey: ['package-configs', projectId],
    queryFn: () => packageApi.getConfigs({ project: projectId, page_size: 1000 }),
    enabled: !!projectId,
  });

  const { data: reposData } = useQuery({
    queryKey: ['repositories', projectId],
    queryFn: () => repositoryApi.getRepositories({ project: projectId, repo_type: 'git', page_size: 1000 }),
    enabled: !!projectId,
  });

  const { data: imagesData } = useQuery({
    queryKey: ['package-images', buildType],
    queryFn: () => packageApi.getImages({ build_type: buildType, is_active: true, page_size: 1000 }),
    enabled: mode === 'simple',
  });

  const { data: releasedData, isLoading: releasesLoading } = useQuery({
    queryKey: ['package-trigger-releases', projectId, triggerConfig?.repository],
    queryFn: () =>
      releaseApi.getReleases({
        project: projectId,
        repository: triggerConfig?.repository,
        status: 'released',
        page_size: 1000,
      }),
    enabled: triggerOpen && !!projectId && !!triggerConfig?.repository,
  });

  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.setFieldsValue({
        ...editing,
        image: editing.image_id || editing.image || undefined,
      });
    } else {
      form.setFieldsValue({
        project: projectId,
        mode: 'simple',
        build_type: 'web',
        build_path: '.',
        output_path: 'dist',
        env_vars: {},
        auto_package_on_release: true,
        is_active: true,
      });
    }
  }, [editing, form, open, projectId]);

  const saveMutation = useMutation({
    mutationFn: (values: Partial<PackageConfig>) => {
      const payload = { ...values, project: projectId };
      if (editing) return packageApi.updateConfig(editing.id, payload);
      return packageApi.createConfig(payload);
    },
    onSuccess: () => {
      message.success('保存成功');
      setOpen(false);
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['package-configs', projectId] });
    },
    onError: () => message.error('保存失败'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => packageApi.deleteConfig(id),
    onSuccess: () => {
      message.success('删除成功');
      queryClient.invalidateQueries({ queryKey: ['package-configs', projectId] });
    },
    onError: () => message.error('删除失败'),
  });

  const triggerMutation = useMutation({
    mutationFn: ({ configId, releaseId }: { configId: string; releaseId: string }) =>
      packageApi.triggerConfig(configId, releaseId),
    onSuccess: (task) => {
      if (task.status === 'failure') {
        message.warning(task.error_message || '打包任务创建成功，但任务投递失败');
      } else {
        message.success('已创建打包任务');
        navigate(`/packages/${task.id}`);
      }
      setTriggerOpen(false);
      setTriggerConfig(null);
      triggerForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['package-tasks'] });
    },
    onError: () => message.error('触发打包失败'),
  });

  const rows = data?.results || [];
  const repoOptions = (reposData?.results || []).map((repo) => ({ label: repo.name, value: repo.id }));
  const imageOptions = (imagesData?.results || []).map((image) => ({
    label: `${image.name} / ${image.image}`,
    value: image.id,
  }));
  const releaseOptions = (releasedData?.results || []).map((release) => ({
    label: `${release.version} / ${release.tag_name}`,
    value: release.id,
  }));

  const openTrigger = (record: PackageConfig) => {
    setTriggerConfig(record);
    setTriggerOpen(true);
    triggerForm.resetFields();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[15px] font-semibold text-slate-900">打包配置</div>
          <div className="mt-1 text-[12px] text-slate-500">配置发布成功后的自动打包流程</div>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); setOpen(true); }}>
          新增配置
        </Button>
      </div>

      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={rows}
        pagination={false}
        columns={[
          { title: '名称', dataIndex: 'name', render: (v: string) => <span className="font-medium text-slate-900">{v}</span> },
          { title: '仓库', dataIndex: 'repository_name' },
          { title: '模式', dataIndex: 'mode_display' },
          { title: '类型', dataIndex: 'build_type', render: (v: PackageBuildType) => <Tag color={v === 'web' ? 'blue' : 'purple'}>{v === 'web' ? 'Web' : 'Qt'}</Tag> },
          { title: '镜像', dataIndex: 'image_name', render: (v: string) => v || '-' },
          { title: '自动打包', dataIndex: 'auto_package_on_release', render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '开启' : '关闭'}</Tag> },
          { title: '状态', dataIndex: 'is_active', render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '停用'}</Tag> },
          {
            title: '操作',
            render: (_, record) => (
              <Space>
                <Button type="text" disabled={!record.is_active} onClick={() => openTrigger(record)}>
                  手动打包
                </Button>
                <Button type="text" icon={<EditOutlined />} onClick={() => { setEditing(record); setOpen(true); }}>
                  编辑
                </Button>
                <Button
                  type="text"
                  danger
                  onClick={() => modal.confirm({
                    title: '删除打包配置',
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

      <Modal
        title={editing ? '编辑打包配置' : '新增打包配置'}
        open={open}
        width={720}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saveMutation.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)}>
          <Form.Item name="name" label="配置名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="repository" label="关联仓库" rules={[{ required: true }]}>
            <Select options={repoOptions} />
          </Form.Item>
          <div className="grid grid-cols-2 gap-3">
            <Form.Item name="mode" label="打包模式" rules={[{ required: true }]}>
              <Select options={modeOptions} />
            </Form.Item>
            <Form.Item name="build_type" label="打包类型" rules={[{ required: true }]}>
              <Select options={buildTypeOptions} />
            </Form.Item>
          </div>
          {mode === 'simple' ? (
            <Form.Item name="image" label="打包镜像" rules={[{ required: true }]}>
              <Select options={imageOptions} placeholder="按打包类型选择镜像" />
            </Form.Item>
          ) : (
            <Form.Item name="local_script" label="本地打包脚本" rules={[{ required: true }]}>
              <Input.TextArea rows={6} placeholder="npm ci && npm run build && cp -r dist/* $ARTIFACTS_DIR/" />
            </Form.Item>
          )}
          {mode === 'simple' ? (
            <Form.Item name="build_path" label="构建目录" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Form.Item name="build_path" label="构建目录" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="output_path" label="产物目录" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Form.Item name="auto_package_on_release" label="发布后自动打包" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="is_active" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        title="手动打包"
        open={triggerOpen}
        onCancel={() => {
          setTriggerOpen(false);
          setTriggerConfig(null);
          triggerForm.resetFields();
        }}
        onOk={() => triggerForm.submit()}
        confirmLoading={triggerMutation.isPending}
        destroyOnHidden
      >
        <div className="mb-3 rounded-lg border border-indigo-100 bg-indigo-50/40 p-3 text-[12px] text-slate-600">
          <div>打包配置：{triggerConfig?.name || '-'}</div>
          <div>关联仓库：{triggerConfig?.repository_name || '-'}</div>
        </div>
        <Form
          form={triggerForm}
          layout="vertical"
          onFinish={(values) => {
            if (!triggerConfig) return;
            triggerMutation.mutate({ configId: triggerConfig.id, releaseId: values.release_id });
          }}
        >
          <Form.Item name="release_id" label="选择已发布 Tag" rules={[{ required: true, message: '请选择已发布 Tag' }]}>
            <Select
              showSearch
              loading={releasesLoading}
              options={releaseOptions}
              placeholder="选择已发布版本 / Tag"
              optionFilterProp="label"
              notFoundContent={releasesLoading ? '加载中...' : '暂无可打包的已发布 Tag'}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
