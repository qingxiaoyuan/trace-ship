import { useState } from 'react';
import { Table, Button, Space, Avatar, message, Popconfirm } from 'antd';
import { SyncOutlined, EditOutlined, ReloadOutlined } from '@ant-design/icons';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { SearchFilterBar } from '@/components/SearchFilterBar';
import { mockUsers, sourceMap } from '@/mock/system';
import { tokens } from '@/styles/theme';

export default function SystemUserList() {
  const [filters, setFilters] = useState({ keyword: '', source: undefined, is_active: undefined });
  const [data] = useState(mockUsers);

  const columns = [
    { title: '用户名', dataIndex: 'username' },
    {
      title: '显示名',
      dataIndex: 'nickname',
      render: (name: string) => (
        <Space>
          <Avatar size="small" style={{ background: tokens.colors.userAvatar }}>{name?.charAt(0)}</Avatar>
          {name}
        </Space>
      ),
    },
    { title: '部门', dataIndex: 'department' },
    {
      title: '来源',
      dataIndex: 'source',
      render: (source: string) => (
        <StatusTag status={source === 'ldap' ? 'primary' : 'neutral'}>{sourceMap[source] || source}</StatusTag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      render: (active: boolean) => (
        <StatusTag status={active ? 'success' : 'neutral'}>{active ? '启用' : '停用'}</StatusTag>
      ),
    },
    {
      title: '最近登录',
      dataIndex: 'last_login',
      render: (text: string) => text?.replace('T', ' ').slice(0, 16),
    },
    {
      title: '操作',
      width: 220,
      render: () => (
        <Space size="small">
          <Button type="text" icon={<EditOutlined />}>编辑角色</Button>
          <Button type="text" icon={<ReloadOutlined />}>重置密码</Button>
          <Popconfirm title="确定操作？" onConfirm={() => message.success('操作成功')}>
            <Button type="text">停用</Button>
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
            { key: 'keyword', type: 'input', placeholder: '搜索用户名/昵称/邮箱', width: 256 },
            {
              key: 'source',
              type: 'select',
              placeholder: '来源',
              width: 128,
              options: [
                { label: 'LDAP', value: 'ldap' },
                { label: '本地', value: 'local' },
              ],
            },
            {
              key: 'is_active',
              type: 'select',
              placeholder: '状态',
              width: 128,
              options: [{ label: '启用', value: 'true' }, { label: '停用', value: 'false' }],
            },
          ]}
          values={filters}
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onSearch={() => message.info('执行查询')}
          onReset={() => setFilters({ keyword: '', source: undefined, is_active: undefined })}
          extra={
            <Button icon={<SyncOutlined />}>同步 LDAP</Button>
          }
          addText="新增本地用户"
          onAdd={() => message.info('打开新增用户弹窗')}
        />
      </TsCard>

      <TsCard title="用户列表">
        <Table rowKey="id" columns={columns} dataSource={data} pagination={{ pageSize: 10 }} />
      </TsCard>
    </div>
  );
}
