import { useState } from 'react';
import { Table, Button, Space, Badge, Typography } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BellOutlined, CheckOutlined } from '@ant-design/icons';
import { TsCard } from '@/components/TsCard';
import { notificationApi } from '@/api/notification';
import type { Notification } from '@/types';

const { Text } = Typography;

const typeMap: Record<Notification['notification_type'], string> = {
  audit: '审批',
  build: '构建',
  release: '发布',
  system: '系统',
};

export default function NotificationPage() {
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', pagination.current, pagination.pageSize],
    queryFn: () =>
      notificationApi.getNotifications({
        page: pagination.current,
        page_size: pagination.pageSize,
      }),
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationApi.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notification-unread-count'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationApi.markAllRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notification-unread-count'] });
    },
  });

  const columns = [
    {
      title: '类型',
      dataIndex: 'notification_type',
      width: 100,
      render: (type: Notification['notification_type'], record: Notification) => (
        <Space>
          {!record.is_read && <Badge status="error" />}
          <Text type="secondary">{typeMap[type] || type}</Text>
        </Space>
      ),
    },
    {
      title: '标题',
      dataIndex: 'title',
      render: (text: string, record: Notification) => (
        <Text strong={!record.is_read}>{text}</Text>
      ),
    },
    {
      title: '内容',
      dataIndex: 'content',
      ellipsis: true,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 180,
      render: (text: string) => text?.replace('T', ' ').slice(0, 19),
    },
    {
      title: '操作',
      width: 120,
      render: (_: unknown, record: Notification) => (
        <Button
          type="text"
          icon={<CheckOutlined />}
          disabled={record.is_read}
          onClick={() => markReadMutation.mutate(record.id)}
        >
          标记已读
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <TsCard
        title={
          <Space>
            <BellOutlined />
            <span>通知中心</span>
          </Space>
        }
        extra={
          <Button
            type="primary"
            icon={<CheckOutlined />}
            onClick={() => markAllReadMutation.mutate()}
            loading={markAllReadMutation.isPending}
          >
            全部已读
          </Button>
        }
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data?.results || []}
          loading={isLoading}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: data?.total || 0,
            showSizeChanger: true,
          }}
          onChange={(p) => {
            setPagination({ current: p.current || 1, pageSize: p.pageSize || 10 });
          }}
        />
      </TsCard>
    </div>
  );
}
