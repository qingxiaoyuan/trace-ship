import { Table, Button, Empty } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { StatusTag, type StatusType } from '@/components/StatusTag';
import { releaseApi } from '@/api/release';

const statusDisplay: Record<string, { status: StatusType; text: string }> = {
  draft: { status: 'neutral', text: '草稿' },
  pending: { status: 'warning', text: '待审批' },
  building: { status: 'warning', text: '构建中' },
  auditing: { status: 'info', text: '审批中' },
  released: { status: 'success', text: '已发布' },
  rejected: { status: 'danger', text: '已驳回' },
};

const typeDisplay: Record<string, { status: StatusType; text: string }> = {
  formal: { status: 'primary', text: '正式' },
  test: { status: 'warning', text: '测试' },
};

export function ReleaseTab({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['project-releases', projectId],
    queryFn: () => releaseApi.getReleases({ project: projectId, page_size: 1000 }),
    enabled: !!projectId,
  });

  const list = data?.results || [];

  return (
    <Table
      rowKey="id"
      loading={isLoading}
      dataSource={list}
      pagination={false}
      locale={{
        emptyText: <Empty description="暂无发布记录" />,
      }}
      columns={[
        { title: '版本号', dataIndex: 'version' },
        {
          title: '发布类型',
          dataIndex: 'release_type',
          render: (t: string) => {
            const cfg = typeDisplay[t] || { status: 'neutral' as StatusType, text: t || '-' };
            return <StatusTag status={cfg.status}>{cfg.text}</StatusTag>;
          },
        },
        {
          title: '状态',
          dataIndex: 'status',
          render: (s: string) => {
            const cfg = statusDisplay[s] || { status: 'neutral' as StatusType, text: s || '-' };
            return <StatusTag status={cfg.status}>{cfg.text}</StatusTag>;
          },
        },
        {
          title: '发布时间',
          dataIndex: 'released_at',
          render: (v: string) => (v ? new Date(v).toLocaleString() : '-'),
        },
        {
          title: '操作',
          render: (_: unknown, record: { id: string }) => (
            <Button type="text" onClick={() => navigate(`/releases/${record.id}`)}>
              详情
            </Button>
          ),
        },
      ]}
    />
  );
}
