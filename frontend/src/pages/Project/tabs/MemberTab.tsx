import { Table, Button, Space, Avatar } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { StatusTag } from '@/components/StatusTag';
import { mockProjectMembers, projectRoleMap } from '@/mock/projectDetail';
import { getAvatarColor } from '@/utils/avatar';

const roleStatusMap: Record<string, 'primary' | 'success' | 'info' | 'neutral'> = {
  manager: 'primary',
  tester: 'success',
  developer: 'info',
  auditor: 'neutral',
  viewer: 'neutral',
};

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
                <Avatar
                  size="small"
                  style={{ backgroundColor: getAvatarColor(name), color: '#fff' }}
                >
                  {name.charAt(0)}
                </Avatar>
                {name}
              </Space>
            ),
          },
          { title: '部门', dataIndex: 'department' },
          {
            title: '角色',
            dataIndex: 'role',
            render: (role: string) => (
              <StatusTag status={roleStatusMap[role] || 'neutral'}>
                {projectRoleMap[role] || role}
              </StatusTag>
            ),
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
