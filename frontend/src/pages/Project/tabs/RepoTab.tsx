import { Table, Button, Space } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { StatusTag } from '@/components/StatusTag';
import { mockProjectRepos } from '@/mock/projectDetail';

const repoTypeMap: Record<string, { label: string; status: 'primary' | 'info' | 'neutral' }> = {
  gitlab: { label: 'GitLab', status: 'primary' },
  gitea: { label: 'Gitea', status: 'info' },
  github: { label: 'GitHub', status: 'info' },
  svn: { label: 'SVN', status: 'neutral' },
};

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
          { title: '仓库名称', dataIndex: 'name', render: (text: string) => <span className="font-semibold text-slate-900">{text}</span> },
          {
            title: '类型',
            dataIndex: 'type',
            render: (type: string) => {
              const config = repoTypeMap[type] || { label: type.toUpperCase(), status: 'neutral' as const };
              return <StatusTag status={config.status}>{config.label}</StatusTag>;
            },
          },
          { title: '默认分支', dataIndex: 'defaultBranch', render: (text: string) => <span className="font-mono text-xs">{text}</span> },
          { title: '凭证归属', dataIndex: 'credential' },
          {
            title: '健康状态',
            dataIndex: 'health',
            render: (health: string) => (
              <StatusTag status={health === 'healthy' ? 'success' : 'danger'}>
                {health === 'healthy' ? '正常' : '异常'}
              </StatusTag>
            ),
          },
          {
            title: '操作',
            render: () => (
              <Space>
                <Button type="text">测试</Button>
                <Button type="text">同步提交</Button>
                <Button type="text">编辑</Button>
              </Space>
            ),
          },
        ]}
      />
    </div>
  );
}
