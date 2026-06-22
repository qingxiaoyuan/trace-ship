import { Table, Button } from 'antd';
import { StatusTag } from '@/components/StatusTag';
import { mockProjectReleases } from '@/mock/projectDetail';

export function ReleaseTab() {
  return (
    <Table
      rowKey="id"
      dataSource={mockProjectReleases}
      pagination={false}
      columns={[
        { title: '版本号', dataIndex: 'version' },
        {
          title: '发布类型',
          dataIndex: 'type',
          render: (type: string) => (
            <StatusTag status={type === 'formal' ? 'primary' : 'warning'}>
              {type === 'formal' ? '正式' : '测试'}
            </StatusTag>
          ),
        },
        {
          title: '状态',
          dataIndex: 'status',
          render: () => <StatusTag status="success">已发布</StatusTag>,
        },
        { title: '发布时间', dataIndex: 'time' },
        {
          title: '操作',
          render: () => <Button type="text">详情</Button>,
        },
      ]}
    />
  );
}
