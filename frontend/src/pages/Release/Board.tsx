import { useState } from 'react';
import { Table, Button, Space, message } from 'antd';
import { EyeOutlined, ExportOutlined, TagOutlined } from '@ant-design/icons';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { SearchFilterBar } from '@/components/SearchFilterBar';
import { mockRecentReleases, releaseStatusOptions, releaseTypeOptions } from '@/mock/dashboard';
import type { Release } from '@/types';

const statusMap: Record<string, { status: any; text: string }> = {
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
  const [data] = useState<Release[]>(mockRecentReleases);

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
          onSearch={() => message.info('执行查询')}
          onReset={() => setFilters({ project_id: undefined, version: '', release_type: undefined, status: undefined })}
          extra={
            <Button icon={<ExportOutlined />}>导出 Excel</Button>
          }
        />
      </TsCard>

      <TsCard title="发布记录">
        <Table rowKey="id" columns={columns} dataSource={data} pagination={{ pageSize: 10 }} />
      </TsCard>
    </div>
  );
}
