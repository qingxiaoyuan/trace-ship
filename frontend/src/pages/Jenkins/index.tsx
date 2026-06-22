import { useState } from 'react';
import { Table, Button, Space, Tag, Drawer, message, Popconfirm } from 'antd';
import {
  PlayCircleOutlined,
  EditOutlined,
  DeleteOutlined,
  SyncOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { SearchFilterBar } from '@/components/SearchFilterBar';
import { mockBuildRecords, mockBuildLog } from '@/mock/dashboard';
import type { BuildRecord } from '@/types';

const statusMap: Record<string, { status: any; text: string }> = {
  queue: { status: 'info', text: '排队中' },
  building: { status: 'warning', text: '构建中' },
  success: { status: 'success', text: '成功' },
  failure: { status: 'danger', text: '失败' },
  aborted: { status: 'neutral', text: '中止' },
};

export default function Jenkins() {
  const [filters, setFilters] = useState({ project_id: undefined, status: undefined });
  const [data] = useState<BuildRecord[]>(mockBuildRecords);
  const [logOpen, setLogOpen] = useState(false);
  const [selectedBuild, setSelectedBuild] = useState<BuildRecord | null>(null);

  const handleViewLog = (build: BuildRecord) => {
    setSelectedBuild(build);
    setLogOpen(true);
  };

  const columns = [
    { title: '任务名', dataIndex: 'job_name' },
    { title: '构建编号', dataIndex: 'build_number' },
    { title: '版本号', dataIndex: 'version' },
    {
      title: '状态',
      dataIndex: 'status',
      render: (status: string) => {
        const item = statusMap[status];
        return <StatusTag status={item.status}>{item.text}</StatusTag>;
      },
    },
    {
      title: '开始时间',
      dataIndex: 'started_at',
      render: (text: string) => text?.replace('T', ' ').slice(0, 16),
    },
    { title: '耗时', dataIndex: 'duration' },
    {
      title: '操作',
      width: 200,
      render: (_: unknown, record: BuildRecord) => (
        <Space size="small">
          <Button type="text" icon={<PlayCircleOutlined />}>立即构建</Button>
          <Button type="text" icon={<CodeOutlined />} onClick={() => handleViewLog(record)}>日志</Button>
          <Button type="text" icon={<EditOutlined />}>配置</Button>
          <Popconfirm title="确定删除？" onConfirm={() => message.success('删除成功')}>
            <Button type="text" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
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
              placeholder: '关联项目',
              width: 176,
              options: [{ label: '核心交易平台', value: '1' }],
            },
            {
              key: 'status',
              type: 'select',
              placeholder: '构建状态',
              width: 144,
              options: Object.entries(statusMap).map(([value, { text }]) => ({ value, label: text })),
            },
          ]}
          values={filters}
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onSearch={() => message.info('执行查询')}
          onReset={() => setFilters({ project_id: undefined, status: undefined })}
          addText="配置任务"
          onAdd={() => message.info('打开任务配置弹窗')}
        />
      </TsCard>

      <TsCard title="构建状态">
        <Table rowKey="id" columns={columns} dataSource={data} pagination={{ pageSize: 10 }} />
      </TsCard>

      <Drawer
        title={
          <div className="flex items-center gap-3">
            <span>构建日志 #{selectedBuild?.build_number}</span>
            {selectedBuild?.status === 'building' && (
              <Tag color="orange" icon={<SyncOutlined spin />}>实时刷新</Tag>
            )}
          </div>
        }
        open={logOpen}
        onClose={() => setLogOpen(false)}
        width={720}
      >
        <div className="log-console rounded-xl p-4 h-[calc(100vh-160px)] overflow-auto whitespace-pre">
          {mockBuildLog}
        </div>
      </Drawer>
    </div>
  );
}
