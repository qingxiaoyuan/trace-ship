import { useState } from 'react';
import { Table, Button, Tag, message } from 'antd';
import { ExportOutlined } from '@ant-design/icons';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { SearchFilterBar } from '@/components/SearchFilterBar';
import { mockOperationLogs, operationLogActions } from '@/mock/system';

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
    action: undefined,
    user: '',
    result: undefined,
  });
  const [data] = useState(mockOperationLogs);

  const columns = [
    {
      title: '操作时间',
      dataIndex: 'time',
      render: (text: string) => text?.replace('T', ' ').slice(0, 19),
    },
    { title: '用户', dataIndex: 'user' },
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
        <StatusTag status={result === 'success' ? 'success' : 'danger'}>{result === 'success' ? '成功' : '失败'}</StatusTag>
      ),
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
          ]}
          values={filters}
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onSearch={() => message.info('执行查询')}
          onReset={() => setFilters({ module: '', action: undefined, user: '', result: undefined })}
          extra={
            <Button icon={<ExportOutlined />}>导出日志</Button>
          }
        />
      </TsCard>

      <TsCard title="操作日志">
        <Table rowKey="id" columns={columns} dataSource={data} pagination={{ pageSize: 10 }} />
      </TsCard>
    </div>
  );
}
