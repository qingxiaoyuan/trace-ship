import { useEffect, useRef, useState } from 'react';
import {
  Table,
  Button,
  Space,
  message,
  Input,
  Select,
  Empty,
} from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckOutlined,
  CloseOutlined,
  SwapOutlined,
  NodeIndexOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ThunderboltOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import LogicFlow from '@logicflow/core';
import '@logicflow/core/lib/style/index.css';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { TsModal } from '@/components/TsModal';
import { workflowApi } from '@/api/workflow';
import { projectApi } from '@/api/project';
import { accountApi } from '@/api/account';
import type { AccountUser } from '@/api/account';
import { tokens } from '@/styles/theme';
import type { WorkflowTask, WorkflowDefinition } from '@/types';

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
    type: 'start-node',
    label: '开始',
    bg: tokens.colors.successSoft,
    color: tokens.colors.success,
    icon: <CheckCircleOutlined />,
    shape: 'rounded-full',
  },
  {
    type: 'approval-node',
    label: '审批节点',
    bg: tokens.colors.infoSoft,
    color: tokens.colors.info,
    icon: <NodeIndexOutlined />,
    shape: 'rounded-lg',
  },
  {
    type: 'cc-node',
    label: '抄送节点',
    bg: '#F3F0FF',
    color: '#6B4C9A',
    icon: <BranchesOutlined />,
    shape: 'rounded-lg',
  },
  {
    type: 'end-node',
    label: '结束',
    bg: tokens.colors.neutralSoft,
    color: tokens.colors.neutral,
    icon: <CloseCircleOutlined />,
    shape: 'rounded-full',
  },
];

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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['workflow-todo', page, pageSize],
    queryFn: () => workflowApi.getTodoTasks({ page, page_size: pageSize }),
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: string }) =>
      workflowApi.approveTask(id, { comment }),
    onSuccess: () => {
      message.success('审批通过');
      setDetailOpen(false);
      queryClient.invalidateQueries({ queryKey: ['workflow-todo'] });
      queryClient.invalidateQueries({ queryKey: ['workflow-done'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: string }) =>
      workflowApi.rejectTask(id, { comment }),
    onSuccess: () => {
      message.success('审批驳回');
      setDetailOpen(false);
      queryClient.invalidateQueries({ queryKey: ['workflow-todo'] });
      queryClient.invalidateQueries({ queryKey: ['workflow-done'] });
    },
  });

  const transferMutation = useMutation({
    mutationFn: ({
      id,
      toUserId,
      comment,
    }: {
      id: string;
      toUserId: string;
      comment: string;
    }) => workflowApi.transferTask(id, { to_user_id: toUserId, comment }),
    onSuccess: () => {
      message.success('转交成功');
      setDetailOpen(false);
      queryClient.invalidateQueries({ queryKey: ['workflow-todo'] });
      queryClient.invalidateQueries({ queryKey: ['workflow-done'] });
    },
  });

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
        dataSource={data?.results || []}
        loading={isLoading}
        pagination={{
          current: page,
          pageSize,
          total: data?.total || 0,
          showSizeChanger: true,
          onChange: (p, s) => {
            setPage(p);
            setPageSize(s || 10);
          },
        }}
      />
      <ApprovalDetailModal
        key={`${selected?.id || 'closed'}-${detailOpen}`}
        open={detailOpen}
        task={selected}
        onClose={() => setDetailOpen(false)}
        onApprove={(comment) =>
          selected && approveMutation.mutate({ id: selected.id, comment })
        }
        onReject={(comment) =>
          selected && rejectMutation.mutate({ id: selected.id, comment })
        }
        onTransfer={(toUserId, comment) =>
          selected &&
          transferMutation.mutate({ id: selected.id, toUserId, comment })
        }
      />
    </>
  );
}

function DoneTab() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const { data, isLoading } = useQuery({
    queryKey: ['workflow-done', page, pageSize],
    queryFn: () => workflowApi.getDoneTasks({ page, page_size: pageSize }),
  });

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
      dataSource={data?.results || []}
      loading={isLoading}
      pagination={{
        current: page,
        pageSize,
        total: data?.total || 0,
        showSizeChanger: true,
        onChange: (p, s) => {
          setPage(p);
          setPageSize(s || 10);
        },
      }}
    />
  );
}

function ApprovalDetailModal({
  open,
  task,
  onClose,
  onApprove,
  onReject,
  onTransfer,
}: {
  open: boolean;
  task: WorkflowTask | null;
  onClose: () => void;
  onApprove: (comment: string) => void;
  onReject: (comment: string) => void;
  onTransfer: (toUserId: string, comment: string) => void;
}) {
  const [comment, setComment] = useState('');
  const [toUserId, setToUserId] = useState('');
  const [transferMode, setTransferMode] = useState(false);

  const { data: usersData } = useQuery({
    queryKey: ['users-for-transfer'],
    queryFn: () => accountApi.getUsers({ page_size: 1000 }),
    enabled: transferMode,
  });

  const releaseTypeText =
    task?.release_type === 'formal'
      ? '正式'
      : task?.release_type === 'test'
      ? '测试'
      : '-';

  return (
    <TsModal
      title={`审批详情：${task?.title ?? ''}`}
      open={open}
      onCancel={onClose}
      width={560}
      footer={
        <div className="flex justify-end gap-3">
          {transferMode ? (
            <>
              <Select
                placeholder="选择转交人"
                style={{ width: 160 }}
                value={toUserId || undefined}
                onChange={setToUserId}
                options={(usersData?.results || []).map((u: AccountUser) => ({
                  value: u.id,
                  label: `${u.nickname || u.username} (${u.username})`,
                }))}
              />
              <Button onClick={() => setTransferMode(false)}>取消</Button>
              <Button
                icon={<SwapOutlined />}
                onClick={() => onTransfer(toUserId, comment)}
                disabled={!toUserId}
              >
                确认转交
              </Button>
            </>
          ) : (
            <>
              <Button
                onClick={() => onApprove(comment)}
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
                onClick={() => onReject(comment)}
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
                onClick={() => setTransferMode(true)}
                icon={<SwapOutlined />}
                style={{
                  borderColor: tokens.colors.border,
                  borderRadius: tokens.layout.buttonRadius,
                }}
              >
                转交
              </Button>
            </>
          )}
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
  const [selectedDefinition, setSelectedDefinition] = useState<WorkflowDefinition | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const queryClient = useQueryClient();

  const { data: definitions } = useQuery({
    queryKey: ['workflow-definitions'],
    queryFn: () => workflowApi.getDefinitions({ page_size: 1000 }),
  });

  const { data: projectsData } = useQuery({
    queryKey: ['projects-for-workflow'],
    queryFn: () => projectApi.getProjects({ page_size: 1000 }),
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<WorkflowDefinition>) => workflowApi.createDefinition(data),
    onSuccess: () => {
      message.success('保存成功');
      setFormOpen(false);
      queryClient.invalidateQueries({ queryKey: ['workflow-definitions'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<WorkflowDefinition> }) =>
      workflowApi.updateDefinition(id, data),
    onSuccess: (definition) => {
      message.success('保存成功');
      setFormOpen(false);
      setSelectedDefinition(definition);
      queryClient.invalidateQueries({ queryKey: ['workflow-definitions'] });
    },
  });

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

    lf.render({ nodes: [], edges: [] });
    lfRef.current = lf;

    return () => {
      lf.destroy();
      lfRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!selectedDefinition || !lfRef.current) return;
    lfRef.current.render(selectedDefinition.graph_data as never);
    setName(selectedDefinition.name);
    setProjectId(selectedDefinition.project);
  }, [selectedDefinition]);

  const reset = () => {
    lfRef.current?.render({ nodes: [], edges: [] });
    setSelectedDefinition(null);
    setName('');
    setProjectId('');
    message.info('画布已重置');
  };

  const save = () => {
    const graphData = lfRef.current?.getGraphData() as WorkflowDefinition['graph_data'];
    if (!name || !projectId) {
      message.error('请填写流程名称和所属项目');
      return;
    }
    if (!graphData?.nodes?.length) {
      message.error('流程图不能为空');
      return;
    }
    const payload = {
      project: projectId,
      name,
      biz_type: 'release',
      graph_data: graphData,
      is_active: selectedDefinition?.is_active ?? true,
    };
    if (selectedDefinition) {
      updateMutation.mutate({ id: selectedDefinition.id, data: payload });
      return;
    }
    createMutation.mutate(payload);
  };

  const columns = [
    {
      title: '流程名称',
      dataIndex: 'name',
      render: (text: string, record: WorkflowDefinition) => (
        <span
          className="font-semibold cursor-pointer"
          style={{ color: tokens.colors.textPrimary }}
          onClick={() => setSelectedDefinition(record)}
        >
          {text}
        </span>
      ),
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
        <Button type="text" onClick={() => setSelectedDefinition(record)}>编辑</Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col lg:flex-row gap-5 h-140">
      <div
        className="w-full lg:w-72 shrink-0 rounded-xl border p-4 h-full overflow-auto"
        style={{
          background: tokens.colors.bg,
          borderColor: tokens.colors.border,
        }}
      >
        <div className="flex justify-between items-center mb-3">
          <h4
            className="text-sm font-bold"
            style={{ color: tokens.colors.textPrimary }}
          >
            流程列表
          </h4>
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => setFormOpen(true)}
          >
            新增
          </Button>
        </div>
        <Table
          rowKey="id"
          dataSource={definitions?.results || []}
          columns={columns}
          pagination={false}
          size="small"
          locale={{ emptyText: <Empty description="暂无流程定义" /> }}
        />

        <TsModal
          title="新增流程定义"
          open={formOpen}
          onCancel={() => setFormOpen(false)}
          onOk={() => {
            setFormOpen(false);
            setSelectedDefinition(null);
            reset();
          }}
          footer={null}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">流程名称</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="请输入流程名称"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">所属项目</label>
              <Select
                value={projectId || undefined}
                onChange={setProjectId}
                placeholder="选择项目"
                style={{ width: '100%' }}
                options={(projectsData?.results || []).map((p: { id: string; name: string }) => ({
                  value: p.id,
                  label: p.name,
                }))}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setFormOpen(false)}>取消</Button>
              <Button type="primary" onClick={save}>保存</Button>
            </div>
          </div>
        </TsModal>
      </div>

      <TsCard
        className="flex-1 flex flex-col overflow-hidden"
        bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column' }}
        headStyle={{ padding: '12px 16px' }}
        title={
          <span className="font-bold" style={{ color: tokens.colors.textPrimary }}>
            {selectedDefinition ? `编辑流程：${selectedDefinition.name}` : '发布审批流程设计'}
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
        <div className="flex flex-1 overflow-hidden">
          <div
            className="w-48 shrink-0 border-r p-3 hidden lg:block"
            style={{ borderColor: tokens.colors.border }}
          >
            <h5
              className="text-xs font-semibold uppercase tracking-wider mb-3"
              style={{ color: tokens.colors.textSecondary }}
            >
              节点工具箱
            </h5>
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
          </div>
          <div ref={containerRef} className="flex-1 bg-white min-h-100" />
        </div>
      </TsCard>
    </div>
  );
}
