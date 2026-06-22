import { Table, Button, Space, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { StatusTag } from '@/components/StatusTag';
import { mockProjectRepos } from '@/mock/projectDetail';

export function RepoTab() {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="primary" icon={<PlusOutlined />}>添加仓库</Button>
      </div>
      <Table
        rowKey="id"
        dataSource={mockProjectRepos}
        pagination={false}
        columns={[
          { title: '仓库名称', dataIndex: 'name' },
          {
            title: '类型',
            dataIndex: 'type',
            render: (type: string) => <Tag color="blue">{type.toUpperCase()}</Tag>,
          },
          { title: '默认分支', dataIndex: 'defaultBranch' },
          { title: '凭证归属', dataIndex: 'credential' },
          {
            title: '健康状态',
            dataIndex: 'health',
            render: () => <StatusTag status="success">正常</StatusTag>,
          },
          {
            title: '操作',
            render: () => (
              <Space>
                <Button type="text">编辑</Button>
                <Button type="text">测试</Button>
                <Button type="text">同步提交</Button>
              </Space>
            ),
          },
        ]}
      />
    </div>
  );
}
