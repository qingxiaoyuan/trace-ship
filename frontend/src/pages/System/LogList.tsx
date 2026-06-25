import { useState } from 'react';
import { Table, Button, Tag, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { useQuery } from '@tanstack/react-query';
import { ExportOutlined } from '@ant-design/icons';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { SearchFilterBar } from '@/components/SearchFilterBar';
import { operationLogActions } from '@/mock/system';
import { systemApi } from '@/api/system';

const { Text } = Typography;

const actionMap: Record<string, { color: string; text: string }> = {
  query: { color: 'blue', text: '查询' },
  create: { color: 'green', text: '新增' },
  update: { color: 'orange', text: '修改' },
  delete: { color: 'red', text: '删除' },
  audit: { color: 'green', text: '审批' },
  release: { color: 'blue', text: '发布' },
};

export default function LogList() {
  const [filters, setFilters] = useState({
    module: '',
    action: undefined as string | undefined,
    user: '',
    result: undefined as string | undefined,
    created_at__gte: undefined as Dayjs | undefined,
    created_at__lte: undefined as Dayjs | undefined,
  });
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });

  const { data, isLoading } = useQuery({
    queryKey: ['system-logs', filters, pagination.current, pagination.pageSize],
    queryFn: () =>
      systemApi.getLogs({
        page: pagination.current,
        page_size: pagination.pageSize,
        module: filters.module || undefined,
        action: filters.action || undefined,
        user: filters.user || undefined,
        result: filters.result || undefined,
        created_at__gte: filters.created_at__gte?.format('YYYY-MM-DD 00:00:00') || undefined,
        created_at__lte: filters.created_at__lte?.format('YYYY-MM-DD 23:59:59') || undefined,
      }),
  });

  const columns = [
    {
      title: '操作时间',
      dataIndex: 'created_at',
      render: (text: string) => text?.replace('T', ' ').slice(0, 19),
    },
    { title: '用户', dataIndex: 'username' },
    { title: '操作模块', dataIndex: 'module' },
    {
      title: '操作类型',
      dataIndex: 'action',
      render: (action: string) => {
        const item = actionMap[action];
        return <Tag color={item?.color}>{item?.text}</Tag>;
      },
    },
    { title: '资源类型', dataIndex: 'resource_type' },
    { title: '资源 ID', dataIndex: 'resource_id' },
    { title: 'IP 地址', dataIndex: 'ip' },
    {
      title: '结果',
      dataIndex: 'result',
      render: (result: string) => (
        <StatusTag status={result === 'success' ? 'success' : result === 'failure' ? 'danger' : 'neutral'}>
          {result === 'success' ? '成功' : result === 'failure' ? '失败' : '-'}
        </StatusTag>
      ),
    },
    {
      title: '说明',
      dataIndex: 'description',
      ellipsis: true,
      render: (text: string) => <Text type="secondary">{text || '-'}</Text>,
    },
  ];

  return (
    <div className="space-y-4">
      <TsCard bodyStyle={{ padding: 20 }}>
        <SearchFilterBar
          filters={[
            { key: 'module', type: 'input', placeholder: '操作模块', width: 160 },
            {
              key: 'action',
              type: 'select',
              placeholder: '操作类型',
              width: 128,
              options: operationLogActions.map((a) => ({ value: a.value, label: a.label })),
            },
            { key: 'user', type: 'input', placeholder: '用户', width: 128 },
            {
              key: 'result',
              type: 'select',
              placeholder: '结果',
              width: 128,
              options: [{ label: '成功', value: 'success' }, { label: '失败', value: 'failure' }],
            },
            { key: 'created_at__gte', type: 'date', placeholder: '开始日期', width: 160 },
            { key: 'created_at__lte', type: 'date', placeholder: '结束日期', width: 160 },
          ]}
          values={filters}
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onSearch={() => setPagination((prev) => ({ ...prev, current: 1 }))}
          onReset={() => {
            setFilters({
              module: '',
              action: undefined,
              user: '',
              result: undefined,
              created_at__gte: undefined,
              created_at__lte: undefined,
            });
            setPagination((prev) => ({ ...prev, current: 1 }));
          }}
          extra={
            <Button icon={<ExportOutlined />}>导出日志</Button>
          }
        />
      </TsCard>

      <TsCard title="操作日志">
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
