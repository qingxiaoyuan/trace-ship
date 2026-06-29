import { useState } from 'react';
import { Table } from 'antd';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { StatusTag } from '@/components/StatusTag';
import { workflowApi } from '@/api/workflow';
import { tokens } from '@/styles/theme';
import { workflowStatusMap } from '../constants';

// 我的已办 Tab
export function DoneTab() {
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
