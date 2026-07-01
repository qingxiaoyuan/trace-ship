import { Table, Button, Empty } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { StatusTag, type StatusType } from '@/components/StatusTag';
import { releaseApi } from '@/api/release';

const typeDisplay: Record<string, { status: StatusType; text: string }> = {
  formal: { status: 'primary', text: '正式' },
  rc: { status: 'info', text: 'RC' },
  beta: { status: 'warning', text: 'Beta' },
};

export function ReleaseTab({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['project-releases', projectId],
    queryFn: () =>
      releaseApi.getReleases({
        project: projectId,
        status: 'released',
        page_size: 1000,
      }),
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
        emptyText: <Empty description="暂无已发布版本" />,
      }}
      columns={[
        {
          title: '版本号',
          dataIndex: 'version',
          render: (v: string) => (
            <div className="font-mono text-[13px]">{v}</div>
          ),
        },
        {
          title: 'Tag',
          dataIndex: 'tag_name',
          render: (v: string) => (
            <span className="font-mono text-[12px] text-slate-600">{v || '-'}</span>
          ),
        },
        {
          title: '发布类型',
          dataIndex: 'release_type',
          render: (t: string) => {
            const cfg = typeDisplay[t] || { status: 'neutral' as StatusType, text: t || '-' };
            return <StatusTag status={cfg.status}>{cfg.text}</StatusTag>;
          },
        },
        {
          title: '发布人',
          dataIndex: 'publisher_name',
          render: (_: string, record: { publisher_name?: string; publisher?: string }) => (
            <span className="text-[13px] text-slate-700">{record.publisher_name || record.publisher || '-'}</span>
          ),
        },
        {
          title: '发布时间',
          dataIndex: 'released_at',
          render: (v: string) => (
            <span className="text-[13px] text-slate-500">{v ? new Date(v).toLocaleString() : '-'}</span>
          ),
        },
        {
          title: '操作',
          width: 80,
          render: (_: unknown, record: { id: string }) => (
            <Button type="text" size="small" onClick={() => navigate(`/releases/${record.id}`)}>
              详情
            </Button>
          ),
        },
      ]}
    />
  );
}
