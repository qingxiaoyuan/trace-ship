import { useState } from 'react';
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Card,
  Tag,
  Radio,
} from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { StatusTag } from '@/components/StatusTag';
import WorkflowFlowChart from '@/components/WorkflowFlowChart';
import { workflowApi } from '@/api/workflow';
import { accountApi } from '@/api/account';
import { useAuthStore } from '@/stores/authStore';
import { useAppMessage } from '@/hooks/useAppMessage';
import type { Project, WorkflowDefinition, WorkflowNodeConfig, WorkflowApproverConfig } from '@/types';

interface WorkflowTabProps {
  project: Project;
}

const APPROVER_TYPE_OPTIONS = [
  { label: '项目负责人', value: 'leader' },
  { label: '指定角色', value: 'role' },
  { label: '指定用户', value: 'user' },
  { label: '发起人自己', value: 'self' },
];

const ROLE_OPTIONS = [
  { label: '开发人员', value: 'developer' },
  { label: '测试人员', value: 'tester' },
  { label: '项目管理员', value: 'manager' },
  { label: '审核人', value: 'auditor' },
  { label: '只读人员', value: 'viewer' },
];

function generateNodeId() {
  return `approval_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function defaultNodeConfig(): WorkflowNodeConfig {
  return {
    node_id: generateNodeId(),
    node_name: '',
    approvers: [{ type: 'leader' }],
    mode: 'any',
  };
}

export function WorkflowTab({ project }: WorkflowTabProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WorkflowDefinition | null>(null);
  const [preview, setPreview] = useState<WorkflowDefinition | null>(null);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { message, modal } = useAppMessage();

  // 只有项目负责人或超管可新增/编辑/删除流程配置
  const canManage = Boolean(user?.is_superuser || user?.id === project.leader_id);

  const { data, isLoading } = useQuery({
    queryKey: ['workflow-definitions-tab', project.id],
    queryFn: () => workflowApi.getDefinitions({ project: project.id, page_size: 1000 }),
    enabled: !!project.id,
  });

  const { data: usersData } = useQuery({
    queryKey: ['users-for-workflow'],
    queryFn: () => accountApi.getUsers({ page_size: 1000 }),
    enabled: formOpen,
  });

  const createMutation = useMutation({
    mutationFn: (values: Partial<WorkflowDefinition>) => workflowApi.createDefinition(values),
    onSuccess: () => {
      message.success('保存成功');
      setFormOpen(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['workflow-definitions-tab'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (values: Partial<WorkflowDefinition>) => {
      if (!editing) throw new Error('未选择编辑项');
      return workflowApi.updateDefinition(editing.id, values);
    },
    onSuccess: () => {
      message.success('更新成功');
      setFormOpen(false);
      form.resetFields();
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['workflow-definitions-tab'] });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (def: WorkflowDefinition) =>
      workflowApi.updateDefinition(def.id, { is_active: !def.is_active }),
    onSuccess: () => {
      message.success('状态更新成功');
      queryClient.invalidateQueries({ queryKey: ['workflow-definitions-tab'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => workflowApi.deleteDefinition(id),
    onSuccess: () => {
      message.success('删除成功');
      queryClient.invalidateQueries({ queryKey: ['workflow-definitions-tab'] });
    },
  });

  const handleDelete = (record: WorkflowDefinition) => {
    modal.confirm({
      title: '确认删除',
      content: `确定要删除流程「${record.name}」吗？删除后不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => deleteMutation.mutate(record.id),
    });
  };

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({
      name: '',
      biz_type: 'release',
      is_active: true,
      node_config: [defaultNodeConfig()],
    });
    setFormOpen(true);
  };

  const openEdit = (record: WorkflowDefinition) => {
    setEditing(record);
    form.setFieldsValue({
      name: record.name,
      biz_type: record.biz_type,
      is_active: record.is_active,
      node_config: record.node_config?.length ? record.node_config : [defaultNodeConfig()],
    });
    setFormOpen(true);
  };

  const handleOk = async () => {
    const values = await form.validateFields();
    const payload = {
      ...values,
      project: project.id,
    };
    if (editing) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  const columns = [
    {
      title: '流程名称',
      dataIndex: 'name',
      width: 180,
      render: (text: string) => <span className="font-semibold text-slate-900">{text}</span>,
    },
    {
      title: '业务类型',
      dataIndex: 'biz_type',
      width: 100,
      render: (value: string) => (value === 'release' ? '发布审批' : value),
    },
    {
      title: '审批链',
      dataIndex: 'node_config',
      render: (config: WorkflowNodeConfig[]) => (
        <div className="flex flex-wrap gap-2">
          {config?.length ? (
            config.map((node, idx) => (
              <Tag key={node.node_id || `node-${idx}`} color={node.mode === 'all' ? 'orange' : 'blue'}>
                {idx + 1}. {node.node_name} ({node.mode === 'all' ? '会签' : '或签'})
              </Tag>
            ))
          ) : (
            <span className="text-slate-400 text-sm">未配置审批链</span>
          )}
        </div>
      ),
    },
    {
      title: '是否启用',
      dataIndex: 'is_active',
      width: 100,
      render: (active: boolean) => (
        <StatusTag status={active ? 'success' : 'neutral'}>
          {active ? '启用' : '停用'}
        </StatusTag>
      ),
    },
    {
      title: '操作',
      width: canManage ? 240 : 100,
      fixed: 'right',
      render: (_: unknown, record: WorkflowDefinition) => (
        <Space size="small" wrap>
          <Button type="text" size="small" onClick={() => setPreview(record)}>
            预览
          </Button>
          {canManage && (
            <>
              <Button type="text" size="small" onClick={() => openEdit(record)}>
                编辑
              </Button>
              <Button type="text" size="small" onClick={() => toggleMutation.mutate(record)}>
                {record.is_active ? '停用' : '启用'}
              </Button>
              <Button type="text" size="small" danger onClick={() => handleDelete(record)}>
                删除
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增流程
          </Button>
        </div>
      )}
      <Table
        rowKey="id"
        dataSource={data?.results || []}
        loading={isLoading}
        pagination={false}
        columns={columns}
        scroll={{ x: 800 }}
        locale={{
          emptyText: <div className="py-8 text-slate-400">暂无流程定义</div>,
        }}
      />

      <Modal
        title={editing ? '编辑流程' : '新增流程'}
        open={formOpen}
        onCancel={() => {
          setFormOpen(false);
          setEditing(null);
          form.resetFields();
        }}
        onOk={handleOk}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        width={760}
        styles={{ body: { maxHeight: '60vh', overflow: 'auto' } }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="流程名称" rules={[{ required: true, message: '请输入流程名称' }]}>
            <Input placeholder="请输入流程名称" />
          </Form.Item>
          <Form.Item name="biz_type" label="业务类型" rules={[{ required: true }]}>
            <Select options={[{ label: '发布审批', value: 'release' }]} />
          </Form.Item>
          <Form.Item
            name="is_active"
            label="是否启用"
            rules={[{ required: true }]}
          >
            <Radio.Group
              options={[
                { label: '启用', value: true },
                { label: '停用', value: false },
              ]}
            />
          </Form.Item>

          <Form.List name="node_config">
            {(fields, { add, remove }) => (
              <div className="space-y-4">
                {fields.map((field, index) => (
                  <Card
                    key={field.key}
                    size="small"
                    title={`审批节点 ${index + 1}`}
                    extra={
                      fields.length > 1 && (
                        <MinusCircleOutlined
                          className="text-red-500 cursor-pointer"
                          onClick={() => remove(field.name)}
                        />
                      )
                    }
                  >
                    <Form.Item
                      {...field}
                      name={[field.name, 'node_name']}
                      label="节点名称"
                      rules={[{ required: true, message: '请输入节点名称' }]}
                    >
                      <Input placeholder="如：技术负责人审批" />
                    </Form.Item>

                    <Form.Item
                      {...field}
                      name={[field.name, 'mode']}
                      label="审批模式"
                      rules={[{ required: true }]}
                    >
                      <Select
                        options={[
                          { label: '或签（任一审批人通过即可）', value: 'any' },
                          { label: '会签（全部审批人通过才生效）', value: 'all' },
                        ]}
                      />
                    </Form.Item>

                    <Form.Item label="审批人">
                      <Form.List name={[field.name, 'approvers']}>
                        {(approverFields, { add: addApprover, remove: removeApprover }) => (
                          <div className="space-y-2">
                            {approverFields.map((approverField) => (
                              <Space key={approverField.key} align="baseline">
                                <Form.Item
                                  {...approverField}
                                  name={[approverField.name, 'type']}
                                  rules={[{ required: true, message: '请选择审批人类型' }]}
                                  noStyle
                                >
                                  <Select
                                    style={{ width: 140 }}
                                    options={APPROVER_TYPE_OPTIONS}
                                    placeholder="类型"
                                  />
                                </Form.Item>
                                <Form.Item
                                  noStyle
                                  shouldUpdate={(prev, curr) => {
                                    const prevType =
                                      prev?.node_config?.[field.name]?.approvers?.[approverField.name]?.type;
                                    const currType =
                                      curr?.node_config?.[field.name]?.approvers?.[approverField.name]?.type;
                                    return prevType !== currType;
                                  }}
                                >
                                  {({ getFieldValue }) => {
                                    const type = getFieldValue([
                                      'node_config',
                                      field.name,
                                      'approvers',
                                      approverField.name,
                                      'type',
                                    ]);
                                    if (type === 'user') {
                                      return (
                                        <Form.Item
                                          {...approverField}
                                          name={[approverField.name, 'user_id']}
                                          rules={[{ required: true, message: '请选择用户' }]}
                                          noStyle
                                        >
                                          <Select
                                            style={{ width: 180 }}
                                            placeholder="选择用户"
                                            showSearch
                                            filterOption={(input, option) =>
                                              String(option?.label ?? '')
                                                .toLowerCase()
                                                .includes(input.toLowerCase())
                                            }
                                            options={usersData?.results?.map((u) => ({
                                              value: u.id,
                                              label: `${u.nickname || u.username} (${u.username})`,
                                            }))}
                                          />
                                        </Form.Item>
                                      );
                                    }
                                    if (type === 'role') {
                                      return (
                                        <Form.Item
                                          {...approverField}
                                          name={[approverField.name, 'role']}
                                          rules={[{ required: true, message: '请选择角色' }]}
                                          noStyle
                                        >
                                          <Select
                                            style={{ width: 180 }}
                                            placeholder="选择角色"
                                            options={ROLE_OPTIONS}
                                          />
                                        </Form.Item>
                                      );
                                    }
                                    return null;
                                  }}
                                </Form.Item>
                                {approverFields.length > 1 && (
                                  <MinusCircleOutlined
                                    className="text-red-500 cursor-pointer"
                                    onClick={() => removeApprover(approverField.name)}
                                  />
                                )}
                              </Space>
                            ))}
                            <Button
                              type="dashed"
                              onClick={() => addApprover({ type: 'leader' } as WorkflowApproverConfig)}
                              icon={<PlusOutlined />}
                              size="small"
                            >
                              添加审批人
                            </Button>
                          </div>
                        )}
                      </Form.List>
                    </Form.Item>
                  </Card>
                ))}
                <Button
                  type="dashed"
                  onClick={() => add(defaultNodeConfig())}
                  icon={<PlusOutlined />}
                  block
                >
                  添加审批节点
                </Button>
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>

      <Modal
        title={`流程预览：${preview?.name || ''}`}
        open={!!preview}
        onCancel={() => setPreview(null)}
        footer={null}
        width={760}
      >
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          {preview?.graph_data?.nodes?.length ? (
            <WorkflowFlowChart graphData={preview.graph_data} height={360} />
          ) : (
            <div className="h-80 flex items-center justify-center text-slate-400">
              暂无流程图，请先配置审批链
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
