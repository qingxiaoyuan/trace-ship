import { useState } from 'react';
import {
  Table,
  Button,
  Input,
  Select,
} from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckOutlined,
  CloseOutlined,
  SwapOutlined,
  RollbackOutlined,
  NodeIndexOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { TsModal } from '@/components/TsModal';
import { workflowApi } from '@/api/workflow';
import { accountApi } from '@/api/account';
import { useAppMessage } from '@/hooks/useAppMessage';
import type { AccountUser } from '@/api/account';
import { tokens } from '@/styles/theme';
import type { WorkflowTask, WorkflowInstance } from '@/types';

const workflowStatusMap: Record<
  string,
  { status: 'success' | 'danger' | 'info' | 'warning'; text: string }
> = {
  approved: { status: 'success', text: '已通过' },
  rejected: { status: 'danger', text: '已驳回' },
  transferred: { status: 'info', text: '已转交' },
  rollbacked: { status: 'warning', text: '已回退' },
};

type TabKey = 'todo' | 'done';

const tabItems: { key: TabKey; label: string }[] = [
  { key: 'todo', label: '我的待办' },
  { key: 'done', label: '我的已办' },
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
  const { message } = useAppMessage();

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

  const rollbackMutation = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: string }) =>
      workflowApi.rollbackTask(id, { comment }),
    onSuccess: () => {
      message.success('回退成功');
      setDetailOpen(false);
      queryClient.invalidateQueries({ queryKey: ['workflow-todo'] });
      queryClient.invalidateQueries({ queryKey: ['workflow-done'] });
    },
  });

  const { data: instanceData } = useQuery({
    queryKey: ['workflow-instance-for-task', selected?.instance],
    queryFn: () => workflowApi.getInstance(selected!.instance!),
    enabled: !!selected?.instance && detailOpen,
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
        instance={instanceData?.data ?? null}
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
        onRollback={(comment) =>
          selected && rollbackMutation.mutate({ id: selected.id, comment })
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

function ApprovalHistory({ tasks }: { tasks: WorkflowTask[] }) {
  const history = (tasks || [])
    .filter((t) => t.status !== 'pending')
    .sort(
      (a, b) =>
        new Date(b.action_time || b.created_at).getTime() -
        new Date(a.action_time || a.created_at).getTime(),
    );

  if (!history.length) return null;

  return (
    <div className="mt-6">
      <h4
        className="text-sm font-bold mb-3"
        style={{ color: tokens.colors.textPrimary }}
      >
        审批历史
      </h4>
      <div className="space-y-3">
        {history.map((item) => {
          const action = workflowStatusMap[item.status];
          return (
            <div
              key={item.id}
              className="p-3 rounded-lg border"
              style={{
                borderColor: tokens.colors.border,
                background: tokens.colors.bg,
              }}
            >
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{item.current_node}</span>
                  {action && <StatusTag status={action.status}>{action.text}</StatusTag>}
                  {item.status === 'rollbacked' && item.rollback_target_node_id && (
                    <span className="text-xs text-slate-500">
                      (回退至 {item.rollback_target_node_id})
                    </span>
                  )}
                </div>
                <span className="text-xs text-slate-400">
                  {item.action_time
                    ? dayjs(item.action_time).format('MM-DD HH:mm')
                    : '-'}
                </span>
              </div>
              <div className="mt-1 text-sm text-slate-600">
                审批人：{item.approver_name || item.approver_username || '-'}
                {item.transferred_from_name && (
                  <span className="text-slate-400 ml-1">
                    （由 {item.transferred_from_name} 转交）
                  </span>
                )}
              </div>
              {item.comment && (
                <div className="mt-2 text-sm text-slate-500 bg-slate-50 p-2 rounded">
                  {item.comment}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ApprovalDetailModal({
  open,
  task,
  instance,
  onClose,
  onApprove,
  onReject,
  onTransfer,
  onRollback,
}: {
  open: boolean;
  task: WorkflowTask | null;
  instance: WorkflowInstance | null;
  onClose: () => void;
  onApprove: (comment: string) => void;
  onReject: (comment: string) => void;
  onTransfer: (toUserId: string, comment: string) => void;
  onRollback: (comment: string) => void;
}) {
  const [comment, setComment] = useState('');
  const [toUserId, setToUserId] = useState('');
  const [transferMode, setTransferMode] = useState(false);
  const [rollbackMode, setRollbackMode] = useState(false);

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

  // 只有当前节点不是第一个审批节点时才允许回退
  const nodeConfig = instance?.definition
    ? (instance as unknown as { node_config?: { node_id: string }[] }).node_config
    : undefined;
  const currentNodeIndex = nodeConfig?.findIndex(
    (n) => n.node_id === task?.current_node,
  );
  const canRollback = (currentNodeIndex ?? 0) > 0;

  const resetModes = () => {
    setTransferMode(false);
    setRollbackMode(false);
  };

  return (
    <TsModal
      title={`审批详情：${task?.title ?? ''}`}
      open={open}
      onCancel={() => {
        resetModes();
        onClose();
      }}
      width={600}
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
                onClick={() => {
                  onTransfer(toUserId, comment);
                  resetModes();
                }}
                disabled={!toUserId}
              >
                确认转交
              </Button>
            </>
          ) : rollbackMode ? (
            <>
              <Button onClick={() => setRollbackMode(false)}>取消</Button>
              <Button
                icon={<RollbackOutlined />}
                onClick={() => {
                  onRollback(comment);
                  resetModes();
                }}
                style={{
                  color: tokens.colors.warning,
                  borderColor: tokens.colors.warning,
                }}
              >
                确认回退
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
              {canRollback && (
                <Button
                  onClick={() => setRollbackMode(true)}
                  icon={<RollbackOutlined />}
                  style={{
                    borderColor: tokens.colors.border,
                    borderRadius: tokens.layout.buttonRadius,
                  }}
                >
                  回退
                </Button>
              )}
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
          <h4 className="font-bold" style={{ color: tokens.colors.textPrimary }}>
            审批详情：{task?.title}
          </h4>
          <p className="text-sm" style={{ color: tokens.colors.textSecondary }}>
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

      {instance?.tasks && <ApprovalHistory tasks={instance.tasks} />}
    </TsModal>
  );
}
