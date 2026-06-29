import { useState } from 'react';
import { Table, Button } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { tokens } from '@/styles/theme';
import { workflowApi } from '@/api/workflow';
import { useAppMessage } from '@/hooks/useAppMessage';
import type { WorkflowTask } from '@/types';
import { ApprovalDetailModal } from './ApprovalDetailModal';

// 我的待办 Tab：展示待审批任务，点击「审批」打开详情弹窗
export function TodoTab() {
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
        instance={instanceData ?? null}
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
