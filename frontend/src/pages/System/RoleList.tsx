import { useState } from 'react';
import { Table, Button, Space, Drawer, Tree, Checkbox, message } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { PlusOutlined, EditOutlined, SettingOutlined } from '@ant-design/icons';
import { TsCard } from '@/components/TsCard';
import { accountApi } from '@/api/account';
import type { AccountRole } from '@/api/account';

const menuTreeData = [
  {
    title: '工作台',
    key: 'dashboard',
    children: [{ title: '查看', key: 'dashboard.view' }],
  },
  {
    title: '项目管理',
    key: 'project',
    children: [
      { title: '查看', key: 'project.view' },
      { title: '编辑', key: 'project.edit' },
      { title: '删除', key: 'project.delete' },
    ],
  },
  {
    title: '系统管理',
    key: 'system',
    children: [
      { title: '用户管理', key: 'system.user' },
      { title: '角色权限', key: 'system.role' },
      { title: '系统配置', key: 'system.config' },
    ],
  },
];

export default function RoleList() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<AccountRole | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['account-roles'],
    queryFn: () => accountApi.getRoles({ page_size: 1000 }),
  });

  const handleEditPermission = (role: AccountRole) => {
    setSelectedRole(role);
    setDrawerOpen(true);
  };

  const columns = [
    { title: '角色名称', dataIndex: 'name' },
    { title: '角色编码', dataIndex: 'code' },
    { title: '描述', dataIndex: 'description' },
    {
      title: '操作',
      width: 180,
      render: (_: unknown, record: AccountRole) => (
        <Space size="small">
          <Button type="text" icon={<SettingOutlined />} onClick={() => handleEditPermission(record)}>编辑权限</Button>
          <Button type="text" icon={<EditOutlined />}>编辑</Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <TsCard
        title="角色权限"
        extra={<Button type="primary" icon={<PlusOutlined />}>新增角色</Button>}
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data?.results || []}
          loading={isLoading}
          pagination={false}
        />
      </TsCard>

      <Drawer
        title={`配置权限 - ${selectedRole?.name || ''}`}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={480}
      >
        <div className="space-y-6">
          <div>
            <div className="font-semibold mb-2">菜单权限</div>
            <Tree checkable treeData={menuTreeData} />
          </div>
          <div>
            <div className="font-semibold mb-2">按钮权限</div>
            <Checkbox.Group
              options={['新增', '编辑', '删除', '导出']}
              defaultValue={['新增', '编辑']}
            />
          </div>
          <div>
            <div className="font-semibold mb-2">接口权限</div>
            <Checkbox.Group
              options={['/api/projects/', '/api/releases/', '/api/system/configs/']}
              defaultValue={['/api/projects/']}
            />
          </div>

          <Button type="primary" block onClick={() => { setDrawerOpen(false); message.success('保存成功'); }}>
            保存权限
          </Button>
        </div>
      </Drawer>
    </div>
  );
}
