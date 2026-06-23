import { Table, Button, Space } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { StatusTag } from '@/components/StatusTag';
import { mockProjectIntegrations, integrationTypeMap } from '@/mock/projectDetail';

const integrationStatusMap: Record<string, 'primary' | 'warning' | 'neutral'> = {
  git_repo: 'primary',
  jenkins_job: 'warning',
  svn_repo: 'neutral',
};

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
            render: (type: string) => (
              <StatusTag status={integrationStatusMap[type] || 'neutral'}>
                {integrationTypeMap[type] || type}
              </StatusTag>
            ),
          },
          { title: '资源', dataIndex: 'resource', render: (text: string) => <span className="font-semibold text-slate-900">{text}</span> },
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
