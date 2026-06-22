import { Table, Button, Space, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { mockProjectIntegrations, integrationTypeMap } from '@/mock/projectDetail';

export function IntegrationTab() {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="primary" icon={<PlusOutlined />}>新增绑定</Button>
      </div>
      <Table
        rowKey="id"
        dataSource={mockProjectIntegrations}
        pagination={false}
        columns={[
          {
            title: '外站类型',
            dataIndex: 'type',
            render: (type: string) => <Tag color="blue">{integrationTypeMap[type]}</Tag>,
          },
          { title: '资源', dataIndex: 'resource' },
          { title: '凭证', dataIndex: 'credential' },
          { title: '凭证归属', dataIndex: 'owner' },
          {
            title: '操作',
            render: () => (
              <Space>
                <Button type="text">编辑</Button>
                <Button type="text" danger>解绑</Button>
              </Space>
            ),
          },
        ]}
      />
    </div>
  );
}
