import { Table, Button, Space, Avatar, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { mockProjectMembers, projectRoleMap } from '@/mock/projectDetail';

export function MemberTab() {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="primary" icon={<PlusOutlined />}>添加成员</Button>
      </div>
      <Table
        rowKey="id"
        dataSource={mockProjectMembers}
        pagination={false}
        columns={[
          {
            title: '成员',
            dataIndex: 'name',
            render: (name: string) => (
              <Space>
                <Avatar size="small" style={{ background: '#2563EB' }}>{name.charAt(0)}</Avatar>
                {name}
              </Space>
            ),
          },
          { title: '部门', dataIndex: 'department' },
          {
            title: '角色',
            dataIndex: 'role',
            render: (role: string) => <Tag color="blue">{projectRoleMap[role]}</Tag>,
          },
          { title: '加入时间', dataIndex: 'joinTime' },
          {
            title: '操作',
            render: () => (
              <Space>
                <Button type="text">修改角色</Button>
                <Button type="text" danger>移除</Button>
              </Space>
            ),
          },
        ]}
      />
    </div>
  );
}
