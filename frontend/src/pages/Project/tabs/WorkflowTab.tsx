import { useState } from 'react';
import { Table, Button, Space, message, Modal, Form, Input, Select } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { StatusTag } from '@/components/StatusTag';
import { workflowApi } from '@/api/workflow';
import { projectApi } from '@/api/project';
import type { WorkflowDefinition, Project } from '@/types';

export function WorkflowTab() {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WorkflowDefinition | null>(null);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const { data: projectData } = useQuery({
    queryKey: ['project-for-workflow-tab'],
    queryFn: () => projectApi.getProjects({ page_size: 1000 }),
  });

  const project = (projectData?.results || [])[0] as Project | undefined;

  const { data, isLoading } = useQuery({
    queryKey: ['workflow-definitions-tab', project?.id],
    queryFn: () => workflowApi.getDefinitions({ project: project?.id, page_size: 1000 }),
    enabled: !!project?.id,
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

  const toggleMutation = useMutation({
    mutationFn: (def: WorkflowDefinition) =>
      workflowApi.updateDefinition(def.id, { is_active: !def.is_active }),
    onSuccess: () => {
      message.success('状态更新成功');
      queryClient.invalidateQueries({ queryKey: ['workflow-definitions-tab'] });
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({
      name: '',
      biz_type: 'release',
      is_active: true,
      graph_data: {
        nodes: [
          { id: 'start', type: 'start-node', text: '开始', x: 100, y: 200 },
          { id: 'approval', type: 'approval-node', text: '审批', x: 300, y: 200, properties: { approver_type: 'leader' } },
          { id: 'end', type: 'end-node', text: '结束', x: 500, y: 200 },
        ],
        edges: [
          { id: 'e1', sourceNodeId: 'start', targetNodeId: 'approval' },
          { id: 'e2', sourceNodeId: 'approval', targetNodeId: 'end' },
        ],
      },
    });
    setFormOpen(true);
  };

  const handleOk = async () => {
    const values = await form.validateFields();
    if (!project?.id) {
      message.error('未找到项目');
      return;
    }
    createMutation.mutate({
      ...values,
      project: project.id,
    });
  };

  const columns = [
    {
      title: '流程名称',
      dataIndex: 'name',
      render: (text: string) => <span className="font-semibold text-slate-900">{text}</span>,
    },
    { title: '业务类型', dataIndex: 'biz_type' },
    {
      title: '是否启用',
      dataIndex: 'is_active',
      render: (active: boolean) => (
        <StatusTag status={active ? 'success' : 'neutral'}>
          {active ? '启用' : '停用'}
        </StatusTag>
      ),
    },
    {
      title: '操作',
      render: (_: unknown, record: WorkflowDefinition) => (
        <Space>
          <Button type="text" onClick={() => {
            setEditing(record);
            form.setFieldsValue(record);
            setFormOpen(true);
          }}>编辑</Button>
          <Button type="text" onClick={() => toggleMutation.mutate(record)}>
            {record.is_active ? '停用' : '启用'}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增流程</Button>
      </div>
      <Table
        rowKey="id"
        dataSource={data?.results || []}
        loading={isLoading}
        pagination={false}
        columns={columns}
      />

      <Modal
        title={editing ? '编辑流程' : '新增流程'}
        open={formOpen}
        onCancel={() => {
          setFormOpen(false);
          form.resetFields();
        }}
        onOk={handleOk}
        confirmLoading={createMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="流程名称" rules={[{ required: true }]}>
            <Input placeholder="请输入流程名称" />
          </Form.Item>
          <Form.Item name="biz_type" label="业务类型" rules={[{ required: true }]}>
            <Select options={[{ label: '发布审批', value: 'release' }]} />
          </Form.Item>
          <Form.Item name="is_active" label="是否启用" rules={[{ required: true }]}>
            <Select options={[{ label: '启用', value: true }, { label: '停用', value: false }]} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
