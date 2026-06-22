import { Table, Button, Space } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { StatusTag } from '@/components/StatusTag';
import { mockProjectWorkflows } from '@/mock/projectDetail';

export function WorkflowTab() {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="primary" icon={<PlusOutlined />}>新增流程</Button>
      </div>
      <Table
        rowKey="id"
        dataSource={mockProjectWorkflows}
        pagination={false}
        columns={[
          { title: '流程名称', dataIndex: 'name' },
          { title: '业务类型', dataIndex: 'bizType' },
          { title: '版本', dataIndex: 'version' },
          {
            title: '启用状态',
            dataIndex: 'active',
            render: (active: boolean) => (
              <StatusTag status={active ? 'success' : 'neutral'}>{active ? '启用' : '停用'}</StatusTag>
            ),
          },
          {
            title: '操作',
            render: () => (
              <Space>
                <Button type="text">编辑</Button>
                <Button type="text">停用/启用</Button>
              </Space>
            ),
          },
        ]}
      />
    </div>
  );
}
