import { useEffect, useRef, useState } from 'react';
import { Table, Button, Space, message, Input } from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  SwapOutlined,
  NodeIndexOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import LogicFlow from '@logicflow/core';
import '@logicflow/core/lib/style/index.css';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { TsModal } from '@/components/TsModal';
import { mockWorkflowTasks, mockDoneTasks } from '@/mock/dashboard';
import { tokens } from '@/styles/theme';
import type { WorkflowTask } from '@/types';

const workflowStatusMap: Record<
  string,
  { status: 'success' | 'danger' | 'info' | 'warning'; text: string }
> = {
  approved: { status: 'success', text: '已通过' },
  rejected: { status: 'danger', text: '已驳回' },
  transferred: { status: 'info', text: '已转交' },
};

type TabKey = 'todo' | 'done' | 'definition';

const tabItems: { key: TabKey; label: string }[] = [
  { key: 'todo', label: '我的待办' },
  { key: 'done', label: '我的已办' },
  { key: 'definition', label: '流程定义' },
];

const nodeTools = [
  {
    type: 'start',
    label: '开始',
    bg: tokens.colors.successSoft,
    color: tokens.colors.success,
    icon: <CheckCircleOutlined />,
    shape: 'rounded-full',
  },
  {
    type: 'approval',
    label: '审批节点',
    bg: tokens.colors.infoSoft,
    color: tokens.colors.info,
    icon: <NodeIndexOutlined />,
    shape: 'rounded-lg',
  },
  {
    type: 'cc',
    label: '抄送节点',
    bg: '#F3F0FF',
    color: '#6B4C9A',
    icon: <BranchesOutlined />,
    shape: 'rounded-lg',
  },
  {
    type: 'condition',
    label: '条件分支',
    bg: tokens.colors.warningSoft,
    color: tokens.colors.warning,
    icon: <SwapOutlined />,
    shape: 'rounded-lg',
  },
  {
    type: 'end',
    label: '结束',
    bg: tokens.colors.neutralSoft,
    color: tokens.colors.neutral,
    icon: <CloseCircleOutlined />,
    shape: 'rounded-full',
  },
];

const graphData = {
  nodes: [
    {
      id: 'start',
      type: 'circle',
      x: 100,
      y: 200,
      text: '开始',
      style: { fill: tokens.colors.successSoft, stroke: tokens.colors.success },
    },
    {
      id: 'pm',
      type: 'rect',
      x: 280,
      y: 200,
      text: '项目经理审批',
      style: { fill: tokens.colors.infoSoft, stroke: tokens.colors.info },
    },
    {
      id: 'test',
      type: 'rect',
      x: 480,
      y: 200,
      text: '测试负责人审批',
      style: { fill: tokens.colors.infoSoft, stroke: tokens.colors.info },
    },
    {
      id: 'condition',
      type: 'polygon',
      x: 680,
      y: 200,
      text: '配置项改动？',
      style: { fill: tokens.colors.warningSoft, stroke: tokens.colors.warning },
      points: [
        [0, -30],
        [30, 0],
        [0, 30],
        [-30, 0],
      ],
    },
    {
      id: 'cc_ops',
      type: 'rect',
      x: 860,
      y: 120,
      text: '抄送运维',
      style: { fill: '#F3F0FF', stroke: '#6B4C9A' },
    },
    {
      id: 'end_direct',
      type: 'circle',
      x: 860,
      y: 280,
      text: '结束',
      style: { fill: tokens.colors.neutralSoft, stroke: tokens.colors.neutral },
    },
    {
      id: 'end_final',
      type: 'circle',
      x: 1040,
      y: 120,
      text: '结束',
      style: { fill: tokens.colors.neutralSoft, stroke: tokens.colors.neutral },
    },
  ],
  edges: [
    { id: 'e1', type: 'polyline', sourceNodeId: 'start', targetNodeId: 'pm' },
    { id: 'e2', type: 'polyline', sourceNodeId: 'pm', targetNodeId: 'test' },
    { id: 'e3', type: 'polyline', sourceNodeId: 'test', targetNodeId: 'condition' },
    { id: 'e4', type: 'polyline', sourceNodeId: 'condition', targetNodeId: 'cc_ops' },
    { id: 'e5', type: 'polyline', sourceNodeId: 'condition', targetNodeId: 'end_direct' },
    { id: 'e6', type: 'polyline', sourceNodeId: 'cc_ops', targetNodeId: 'end_final' },
  ],
};

export default function Workflow() {
  const [activeTab, setActiveTab] = useState<TabKey>('todo');

  return (
    <div className="space-y-5 ts-fade-in-up">
      <TsCard bodyStyle={{ padding: 0 }}>
        <TabHeader active={activeTab} onChange={setActiveTab} />
        <div className="p-5">
          {activeTab === 'todo' && <TodoTab />}
          {activeTab === 'done' && <DoneTab />}
          {activeTab === 'definition' && <DefinitionTab />}
        </div>
      </TsCard>
    </div>
  );
}

function TabHeader({
  active,
  onChange,
}: {
  active: TabKey;
  onChange: (key: TabKey) => void;
}) {
  return (
    <div
      className="flex px-5 border-b"
      style={{ borderColor: tokens.colors.border }}
    >
      {tabItems.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className="relative px-4 py-3 text-sm font-medium transition-colors"
            style={{
              color: isActive
                ? tokens.colors.textPrimary
                : tokens.colors.textSecondary,
            }}
          >
            {tab.label}
            {isActive && (
              <span
                className="absolute bottom-0 left-0 right-0 h-0.5"
                style={{ background: tokens.colors.textPrimary }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

function TodoTab() {
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<WorkflowTask | null>(null);

  const openDetail = (record: WorkflowTask) => {
    setSelected(record);
    setDetailOpen(true);
  };

  const columns = [
    {
      title: '审批标题',
      dataIndex: 'title',
      render: (text: string) => (
        <span className="font-semibold" style={{ color: tokens.colors.textPrimary }}>
          {text}
        </span>
      ),
    },
    { title: '申请人', dataIndex: 'applicant' },
    { title: '项目', dataIndex: 'project_name' },
    { title: '当前节点', dataIndex: 'current_node' },
    {
      title: '提交时间',
      dataIndex: 'submit_time',
      render: (text: string) => (
        <span style={{ color: tokens.colors.textSecondary }}>
          {text ? dayjs(text).format('MM-DD HH:mm') : '-'}
        </span>
      ),
    },
    {
      title: '操作',
      width: 120,
      render: (_: unknown, record: WorkflowTask) => (
        <Button
          type="primary"
          size="small"
          style={{
            background: tokens.colors.buttonPrimary,
            borderColor: tokens.colors.buttonPrimary,
            borderRadius: tokens.layout.buttonRadius,
          }}
          onClick={() => openDetail(record)}
        >
          审批
        </Button>
      ),
    },
  ];

  return (
    <>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={mockWorkflowTasks}
        pagination={{ pageSize: 10 }}
      />
      <ApprovalDetailModal
        open={detailOpen}
        task={selected}
        onClose={() => setDetailOpen(false)}
      />
    </>
  );
}

function DoneTab() {
  const columns = [
    {
      title: '审批标题',
      dataIndex: 'title',
      render: (text: string) => (
        <span className="font-semibold" style={{ color: tokens.colors.textPrimary }}>
          {text}
        </span>
      ),
    },
    { title: '申请人', dataIndex: 'applicant' },
    { title: '项目', dataIndex: 'project_name' },
    {
      title: '审批动作',
      dataIndex: 'status',
      render: (status: string) => {
        const item = workflowStatusMap[status];
        return item ? <StatusTag status={item.status}>{item.text}</StatusTag> : status;
      },
    },
    {
      title: '审批时间',
      dataIndex: 'submit_time',
      render: (text: string) => (
        <span style={{ color: tokens.colors.textSecondary }}>
          {text ? dayjs(text).format('YYYY-MM-DD HH:mm') : '-'}
        </span>
      ),
    },
  ];

  return (
    <Table
      rowKey="id"
      columns={columns}
      dataSource={mockDoneTasks}
      pagination={{ pageSize: 10 }}
    />
  );
}

function ApprovalDetailModal({
  open,
  task,
  onClose,
}: {
  open: boolean;
  task: WorkflowTask | null;
  onClose: () => void;
}) {
  const [comment, setComment] = useState('');

  const handleAction = (action: 'approve' | 'reject' | 'transfer') => {
    const map = {
      approve: '审批通过',
      reject: '审批驳回',
      transfer: '已转交',
    };
    message.success(map[action]);
    setComment('');
    onClose();
  };

  const releaseTypeText =
    task?.release_type === 'formal' ? '正式' : task?.release_type === 'test' ? '测试' : '-';

  return (
    <TsModal
      title={`审批详情：${task?.title ?? ''}`}
      open={open}
      onCancel={onClose}
      width={560}
      footer={
        <div className="flex justify-end gap-3">
          <Button
            onClick={() => handleAction('approve')}
            icon={<CheckOutlined />}
            type="primary"
            style={{
              background: tokens.colors.buttonPrimary,
              borderColor: tokens.colors.buttonPrimary,
              borderRadius: tokens.layout.buttonRadius,
            }}
          >
            通过
          </Button>
          <Button
            onClick={() => handleAction('reject')}
            icon={<CloseOutlined />}
            style={{
              color: tokens.colors.danger,
              borderColor: tokens.colors.dangerSoft,
              background: tokens.colors.dangerSoft,
              borderRadius: tokens.layout.buttonRadius,
            }}
          >
            驳回
          </Button>
          <Button
            onClick={() => handleAction('transfer')}
            icon={<SwapOutlined />}
            style={{
              borderColor: tokens.colors.border,
              borderRadius: tokens.layout.buttonRadius,
            }}
          >
            转交
          </Button>
        </div>
      }
    >
      <div className="flex items-center mb-6">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center mr-4"
          style={{
            background: tokens.colors.infoSoft,
            color: tokens.colors.info,
          }}
        >
          <NodeIndexOutlined className="text-xl" />
        </div>
        <div>
          <h4
            className="font-bold"
            style={{ color: tokens.colors.textPrimary }}
          >
            审批详情：{task?.title}
          </h4>
          <p
            className="text-sm"
            style={{ color: tokens.colors.textSecondary }}
          >
            请核对发布信息并填写审批意见
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-5">
        {[
          { label: '版本号', value: task?.version || '-' },
          { label: '发布类型', value: releaseTypeText },
          { label: '来源分支', value: task?.source_branch || '-' },
          { label: '申请人', value: task?.applicant || '-' },
        ].map((item) => (
          <div
            key={item.label}
            className="p-4 rounded-xl border transition-colors"
            style={{
              background: tokens.colors.bg,
              borderColor: tokens.colors.border,
            }}
          >
            <div
              className="text-xs font-semibold uppercase tracking-wider mb-1.5"
              style={{ color: tokens.colors.textSecondary }}
            >
              {item.label}
            </div>
            <div
              className="text-sm font-semibold font-mono"
              style={{ color: tokens.colors.textPrimary }}
            >
              {item.value}
            </div>
          </div>
        ))}
      </div>

      <div className="mb-2">
        <label
          className="block text-sm font-medium mb-1.5"
          style={{ color: tokens.colors.textBody }}
        >
          审批意见
        </label>
        <Input.TextArea
          rows={4}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="请输入审批意见"
          style={{ borderRadius: tokens.layout.inputRadius }}
        />
      </div>
    </TsModal>
  );
}

function DefinitionTab() {
  const containerRef = useRef<HTMLDivElement>(null);
  const lfRef = useRef<LogicFlow | null>(null);

  useEffect(() => {
    if (!containerRef.current || lfRef.current) return;

    const lf = new LogicFlow({
      container: containerRef.current,
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      grid: {
        size: 10,
        visible: true,
        type: 'dot',
      },
      snapline: true,
      keyboard: { enabled: true },
    });

    lf.render(graphData);
    lfRef.current = lf;

    return () => {
      lf.destroy();
      lfRef.current = null;
    };
  }, []);

  const reset = () => {
    lfRef.current?.render(graphData);
    message.info('画布已重置');
  };

  const save = () => {
    const data = lfRef.current?.getGraphData();
    console.log('Workflow graph data:', data);
    message.success('流程保存成功');
  };

  return (
    <div className="flex flex-col lg:flex-row gap-5 h-140">
      {/* Palette */}
      <div
        className="w-full lg:w-56 shrink-0 rounded-xl border p-4 h-full"
        style={{
          background: tokens.colors.bg,
          borderColor: tokens.colors.border,
        }}
      >
        <h4
          className="text-sm font-bold mb-3"
          style={{ color: tokens.colors.textPrimary }}
        >
          节点工具箱
        </h4>
        <div className="space-y-2">
          {nodeTools.map((node) => (
            <div
              key={node.type}
              className={`flex items-center p-2.5 rounded-lg border bg-white cursor-move transition-colors ${node.shape}`}
              style={{
                borderColor: tokens.colors.border,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = tokens.colors.textSecondary;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = tokens.colors.border;
              }}
            >
              <div
                className="w-7 h-7 flex items-center justify-center mr-2.5 shrink-0"
                style={{
                  background: node.bg,
                  color: node.color,
                  borderRadius: node.shape === 'rounded-full' ? 9999 : tokens.layout.buttonRadius,
                }}
              >
                {node.icon}
              </div>
              <span className="text-sm font-medium" style={{ color: tokens.colors.textBody }}>
                {node.label}
              </span>
            </div>
          ))}
        </div>

        <div
          className="mt-5 pt-4 border-t"
          style={{ borderColor: tokens.colors.border }}
        >
          <h5
            className="text-xs font-semibold uppercase tracking-wider mb-2"
            style={{ color: tokens.colors.textSecondary }}
          >
            图例
          </h5>
          <div className="space-y-1.5 text-xs" style={{ color: tokens.colors.textBody }}>
            <div className="flex items-center">
              <span
                className="w-3 h-3 rounded-full mr-2"
                style={{ background: tokens.colors.success }}
              />
              开始 / 结束
            </div>
            <div className="flex items-center">
              <span
                className="w-3 h-3 rounded mr-2"
                style={{ background: tokens.colors.info }}
              />
              审批
            </div>
            <div className="flex items-center">
              <span
                className="w-3 h-3 rounded mr-2"
                style={{ background: '#6B4C9A' }}
              />
              抄送
            </div>
            <div className="flex items-center">
              <span
                className="w-3 h-3 rounded mr-2"
                style={{ background: tokens.colors.warning }}
              />
              条件
            </div>
          </div>
        </div>
      </div>

      {/* Canvas */}
      <TsCard
        className="flex-1 flex flex-col overflow-hidden"
        bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column' }}
        headStyle={{ padding: '12px 16px' }}
        title={
          <span className="font-bold" style={{ color: tokens.colors.textPrimary }}>
            发布审批流程设计
          </span>
        }
        extra={
          <Space>
            <Button
              size="small"
              onClick={reset}
              style={{
                borderColor: tokens.colors.border,
                borderRadius: tokens.layout.buttonRadius,
              }}
            >
              重置
            </Button>
            <Button
              type="primary"
              size="small"
              icon={<ThunderboltOutlined />}
              onClick={save}
              style={{
                background: tokens.colors.buttonPrimary,
                borderColor: tokens.colors.buttonPrimary,
                borderRadius: tokens.layout.buttonRadius,
              }}
            >
              保存流程
            </Button>
          </Space>
        }
      >
        <div ref={containerRef} className="flex-1 bg-white min-h-100" />
      </TsCard>
    </div>
  );
}
