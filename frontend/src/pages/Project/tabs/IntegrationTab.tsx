import { useState } from 'react';
import { Table, Button, Space, App, Modal, Form, Select, Input, Switch } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { StatusTag } from '@/components/StatusTag';
import { credentialApi } from '@/api/credential';
import type { Credential } from '@/types';
import {
  projectIntegrationApi,
  type ProjectIntegration,
  type IntegrationType,
} from '@/api/projectIntegration';

const integrationTypeMap: Record<IntegrationType, string> = {
  git_repo: 'Git仓库',
  svn_repo: 'SVN仓库',
  jenkins: 'Jenkins任务',
};

const integrationStatusMap: Record<IntegrationType, 'primary' | 'warning' | 'neutral'> = {
  git_repo: 'primary',
  jenkins: 'warning',
  svn_repo: 'neutral',
};

const credentialModeMap: Record<string, string> = {
  fixed: '项目固定凭证',
  global: '系统全局凭证',
  current_user: '当前用户',
  specified_user: '指定用户',
};

const vendorOptions: Record<IntegrationType, string[]> = {
  git_repo: ['gitlab', 'gitea', 'github', 'gitee'],
  svn_repo: ['svn'],
  jenkins: ['jenkins'],
};

interface IntegrationTabProps {
  projectId: string;
}

export function IntegrationTab({ projectId }: IntegrationTabProps) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [integrationType, setIntegrationType] = useState<IntegrationType>(
    'git_repo'
  );

  const { data, isLoading } = useQuery({
    queryKey: ['project-integrations', projectId],
    queryFn: () => projectIntegrationApi.getIntegrations(projectId),
    enabled: !!projectId,
  });

  const { data: credentialData, isLoading: credentialLoading } = useQuery({
    queryKey: ['credentials-all'],
    queryFn: () => credentialApi.getCredentials({ page_size: 1000 }),
    enabled: isModalOpen,
  });

  const createMutation = useMutation({
    mutationFn: (values: Partial<ProjectIntegration>) =>
      projectIntegrationApi.createIntegration(projectId, values),
    onSuccess: () => {
      message.success('新增成功');
      setIsModalOpen(false);
      form.resetFields();
      queryClient.invalidateQueries({
        queryKey: ['project-integrations', projectId],
      });
    },
    onError: () => message.error('新增失败'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      projectIntegrationApi.deleteIntegration(projectId, id),
    onSuccess: () => {
      message.success('解绑成功');
      queryClient.invalidateQueries({
        queryKey: ['project-integrations', projectId],
      });
    },
    onError: () => message.error('解绑失败'),
  });

  const testMutation = useMutation({
    mutationFn: (id: string) =>
      projectIntegrationApi.testIntegration(projectId, id),
    onSuccess: (result) => {
      message.success(
        result.connected
          ? `连接成功：${result.detail}`
          : `连接失败：${result.detail}`
      );
    },
    onError: () => message.error('测试失败'),
  });

  const handleDelete = (record: ProjectIntegration) => {
    modal.confirm({
      title: '确认解绑',
      content: `确定要解绑「${record.name}」吗？`,
      okText: '解绑',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => deleteMutation.mutate(record.id),
    });
  };

  const handleTypeChange = (value: IntegrationType) => {
    setIntegrationType(value);
    form.setFieldsValue({ vendor: undefined });
  };

  const columns = [
    {
      title: '外站类型',
      dataIndex: 'integration_type',
      render: (type: IntegrationType) => (
        <StatusTag status={integrationStatusMap[type] || 'neutral'}>
          {integrationTypeMap[type] || type}
        </StatusTag>
      ),
    },
    {
      title: '名称',
      dataIndex: 'name',
      render: (text: string) => <span className="font-semibold text-slate-900">{text}</span>,
    },
    {
      title: '资源标识',
      dataIndex: 'external_identity',
      render: (text?: string) => text || '-',
    },
    { title: '平台', dataIndex: 'vendor' },
    {
      title: '凭证模式',
      dataIndex: 'credential_mode',
      render: (mode: string) => credentialModeMap[mode] || mode,
    },
    {
      title: '关联凭证',
      dataIndex: 'credential_name',
      render: (text?: string) => text || '-',
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      render: (active: boolean) => (
        <StatusTag status={active ? 'success' : 'neutral'}>
          {active ? '启用' : '停用'}
        </StatusTag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: ProjectIntegration) => (
        <Space>
          <Button
            type="text"
            loading={
              testMutation.isPending && testMutation.variables === record.id
            }
            onClick={() => testMutation.mutate(record.id)}
          >
            测试
          </Button>
          <Button
            type="text"
            danger
            loading={
              deleteMutation.isPending &&
              deleteMutation.variables === record.id
            }
            onClick={() => handleDelete(record)}
          >
            解绑
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setIsModalOpen(true);
            setIntegrationType('git_repo');
            form.resetFields();
          }}
        >
          新增绑定
        </Button>
      </div>
      <Table
        rowKey="id"
        dataSource={data?.results || []}
        loading={isLoading}
        pagination={false}
        columns={columns}
      />
      <Modal
        title="新增外站绑定"
        open={isModalOpen}
        onCancel={() => {
          setIsModalOpen(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        okButtonProps={{ loading: createMutation.isPending }}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => createMutation.mutate(values)}
        >
          <Form.Item
            name="integration_type"
            label="绑定类型"
            initialValue="git_repo"
            rules={[{ required: true, message: '请选择绑定类型' }]}
          >
            <Select
              options={Object.entries(integrationTypeMap).map(([
                value,
                label,
              ]) => ({ value, label }))}
              onChange={handleTypeChange}
            />
          </Form.Item>
          <Form.Item
            name="vendor"
            label="平台"
            rules={[{ required: true, message: '请选择平台' }]}
          >
            <Select
              options={vendorOptions[integrationType].map((v) => ({
                value: v,
                label: v.toUpperCase(),
              }))}
            />
          </Form.Item>
          <Form.Item
            name="name"
            label="绑定名称"
            rules={[{ required: true, message: '请输入绑定名称' }]}
          >
            <Input placeholder="如：后端 GitLab" />
          </Form.Item>
          <Form.Item name="external_identity" label="外部标识">
            <Input placeholder="如：group/backend 或 Jenkins Job 名称" />
          </Form.Item>
          <Form.Item
            name="credential_mode"
            label="凭证模式"
            initialValue="fixed"
            rules={[{ required: true, message: '请选择凭证模式' }]}
          >
            <Select
              options={Object.entries(credentialModeMap).map(([
                value,
                label,
              ]) => ({ value, label }))}
            />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) =>
              prev.credential_mode !== cur.credential_mode}
          >
            {({ getFieldValue }) => {
              const mode = getFieldValue('credential_mode');
              return mode === 'fixed' ? (
                <Form.Item
                  name="credential"
                  label="关联凭证"
                  rules={[
                    { required: true, message: '请选择凭证' },
                  ]}
                >
                  <Select
                    loading={credentialLoading}
                    options={(credentialData?.results || []).map((
                      c: Credential
                    ) => ({ value: c.id, label: c.name }))}
                    placeholder="请选择凭证"
                  />
                </Form.Item>
              ) : null;
            }}
          </Form.Item>
          <Form.Item
            name="is_active"
            label="是否启用"
            valuePropName="checked"
            initialValue={true}
          >
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
