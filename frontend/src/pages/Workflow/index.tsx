import { useState } from 'react';
import { Tabs, Table, Button, Space, Card, message } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  SwapOutlined,
  CheckOutlined,
  CloseOutlined,
  BranchesOutlined,
  NodeIndexOutlined,
} from '@ant-design/icons';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { mockWorkflowTasks, mockDoneTasks } from '@/mock/dashboard';

const workflowStatusMap: Record<string, { status: any; text: string }> = {
  pending: { status: 'warning', text: '待审批' },
  approved: { status: 'success', text: '已通过' },
  rejected: { status: 'danger', text: '已驳回' },
  transferred: { status: 'info', text: '已转交' },
};

export default function Workflow() {
  const [activeTab, setActiveTab] = useState('todo');

  return (
    <div className="space-y-4">
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
        { key: 'todo', label: '我的待办' },
        { key: 'done', label: '我的已办' },
        { key: 'definition', label: '流程定义' },
      ]} />

      {activeTab === 'todo' && <TodoTab />}
      {activeTab === 'done' && <DoneTab />}
      {activeTab === 'definition' && <DefinitionTab />}
    </div>
  );
}

function TodoTab() {
  const columns = [
    { title: '审批标题', dataIndex: 'title' },
    { title: '申请人', dataIndex: 'applicant' },
    { title: '项目', dataIndex: 'project_name' },
    { title: '当前节点', dataIndex: 'current_node' },
    {
      title: '提交时间',
      dataIndex: 'submit_time',
      render: (text: string) => text?.replace('T', ' ').slice(0, 16),
    },
    { title: '剩余时间', dataIndex: 'remaining_time' },
    {
      title: '操作',
      width: 240,
      render: () => (
        <Space size="small">
          <Button type="primary" icon={<CheckOutlined />} onClick={() => message.success('审批通过')}>通过</Button>
          <Button danger icon={<CloseOutlined />} onClick={() => message.success('审批驳回')}>驳回</Button>
          <Button icon={<SwapOutlined />}>转交</Button>
        </Space>
      ),
    },
  ];

  return (
    <TsCard title="待办审批">
      <Table rowKey="id" columns={columns} dataSource={mockWorkflowTasks} pagination={{ pageSize: 10 }} />
    </TsCard>
  );
}

function DoneTab() {
  const columns = [
    { title: '审批标题', dataIndex: 'title' },
    { title: '申请人', dataIndex: 'applicant' },
    { title: '项目', dataIndex: 'project_name' },
    {
      title: '审批动作',
      dataIndex: 'status',
      render: (status: string) => {
        const item = workflowStatusMap[status];
        return <StatusTag status={item.status}>{item.text}</StatusTag>;
      },
    },
    {
      title: '审批时间',
      dataIndex: 'submit_time',
      render: (text: string) => text?.replace('T', ' ').slice(0, 16),
    },
    {
      title: '操作',
      render: () => <Button type="text">详情</Button>,
    },
  ];

  return (
    <TsCard title="已办审批">
      <Table rowKey="id" columns={columns} dataSource={mockDoneTasks} pagination={{ pageSize: 10 }} />
    </TsCard>
  );
}

function DefinitionTab() {
  const nodeTools = [
    { type: 'start', label: '开始', color: '#10B981', icon: <CheckCircleOutlined /> },
    { type: 'approval', label: '审批节点', color: '#2563EB', icon: <NodeIndexOutlined /> },
    { type: 'cc', label: '抄送节点', color: '#8B5CF6', icon: <BranchesOutlined /> },
    { type: 'condition', label: '条件分支', color: '#F59E0B', icon: <SwapOutlined /> },
    { type: 'end', label: '结束', color: '#64748B', icon: <CloseCircleOutlined /> },
  ];

  return (
    <TsCard title="流程定义" bodyStyle={{ padding: 0 }}>
      <div className="flex h-[560px]">
        <div className="w-52 border-r border-slate-200 p-4 bg-slate-50">
          <div className="font-semibold mb-4">节点工具箱</div>
          <div className="space-y-3">
            {nodeTools.map((node) => (
              <Card
                key={node.type}
                size="small"
                className="cursor-move hover:shadow-md"
                bodyStyle={{ padding: 12, display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-white"
                  style={{ background: node.color }}
                >
                  {node.icon}
                </div>
                <span>{node.label}</span>
              </Card>
            ))}
          </div>
        </div>

        <div className="flex-1 relative bg-white">
          <div className="absolute top-4 right-4 space-x-2">
            <Button onClick={() => message.info('重置画布')}>重置</Button>
            <Button type="primary" onClick={() => message.success('保存流程成功')}>保存流程</Button>
          </div>
          <div className="h-full flex items-center justify-center text-slate-400">
            流程设计器画布（可接入 @logicflow/core 实现拖拽编辑）
          </div>
        </div>
      </div>
    </TsCard>
  );
}
