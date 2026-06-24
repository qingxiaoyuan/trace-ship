import { useState } from 'react';
import { Table, Button, Space, message } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { EyeOutlined, ExportOutlined, TagOutlined } from '@ant-design/icons';
import { TsCard } from '@/components/TsCard';
import { StatusTag, type StatusType } from '@/components/StatusTag';
import { SearchFilterBar } from '@/components/SearchFilterBar';
import { releaseStatusOptions, releaseTypeOptions } from '@/mock/dashboard';
import { releaseApi } from '@/api/dashboard';

const statusMap: Record<string, { status: StatusType; text: string }> = {
  draft: { status: 'neutral', text: '草稿' },
  pending: { status: 'warning', text: '待审批' },
  building: { status: 'warning', text: '构建中' },
  auditing: { status: 'info', text: '审批中' },
  released: { status: 'success', text: '已发布' },
  rejected: { status: 'danger', text: '已驳回' },
};

export default function ReleaseBoard() {
  const [filters, setFilters] = useState({
    project_id: undefined,
    version: '',
    release_type: undefined,
    status: undefined,
  });
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });

  const { data, isLoading } = useQuery({
    queryKey: ['releases', filters, pagination.current, pagination.pageSize],
    queryFn: () =>
      releaseApi.getReleases({
        page: pagination.current,
        page_size: pagination.pageSize,
        project_id: filters.project_id || undefined,
        version: filters.version || undefined,
        release_type: filters.release_type || undefined,
        status: filters.status || undefined,
      }),
  });

  const columns = [
    { title: '版本号', dataIndex: 'version' },
    { title: '项目', dataIndex: 'project_name' },
    {
      title: '发布类型',
      dataIndex: 'release_type',
      render: (type: string) => (
        <StatusTag status={type === 'formal' ? 'primary' : 'warning'}>
          {type === 'formal' ? '正式' : '测试'}
        </StatusTag>
      ),
    },
    { title: '来源分支', dataIndex: 'source_branch' },
    { title: '发布人', dataIndex: 'publisher' },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      render: (text: string) => text?.replace('T', ' ').slice(0, 16),
    },
    {
      title: '状态',
      dataIndex: 'status',
      render: (status: string) => {
        const item = statusMap[status];
        return <StatusTag status={item.status}>{item.text}</StatusTag>;
      },
    },
    {
      title: '操作',
      width: 220,
      render: () => (
        <Space size="small">
          <Button type="text" icon={<EyeOutlined />}>详情</Button>
          <Button type="text" icon={<TagOutlined />} onClick={() => message.success('推 Tag 成功')}>推 Tag</Button>
          <Button type="text" icon={<ExportOutlined />}>导出</Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <TsCard bodyStyle={{ padding: 20 }}>
        <SearchFilterBar
          filters={[
            {
              key: 'project_id',
              type: 'select',
              placeholder: '选择项目',
              width: 176,
              options: [{ label: '核心交易平台', value: '1' }, { label: '数据中台', value: '2' }],
            },
            { key: 'version', type: 'input', placeholder: '版本号', width: 160 },
            {
              key: 'release_type',
              type: 'select',
              placeholder: '发布类型',
              width: 128,
              options: releaseTypeOptions,
            },
            {
              key: 'status',
              type: 'select',
              placeholder: '状态',
              width: 128,
              options: releaseStatusOptions,
            },
          ]}
          values={filters}
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onSearch={() => setPagination((prev) => ({ ...prev, current: 1 }))}
          onReset={() => {
            setFilters({ project_id: undefined, version: '', release_type: undefined, status: undefined });
            setPagination((prev) => ({ ...prev, current: 1 }));
          }}
          extra={
            <Button icon={<ExportOutlined />}>导出 Excel</Button>
          }
        />
      </TsCard>

      <TsCard title="发布记录">
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
