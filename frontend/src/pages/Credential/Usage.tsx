import { useParams, useNavigate } from 'react-router-dom';
import { Card, Button, Table, Space, Typography } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { mockCredentials } from '@/mock/credentials';

const { Title } = Typography;

const mockUsageRecords = [
  { id: '1', time: '2026-06-22T10:00:00+08:00', module: '仓库管理', action: 'sync_commits', resource: '后端代码仓库', ip: '192.168.1.1', result: 'success' },
  { id: '2', time: '2026-06-21T15:30:00+08:00', module: 'Jenkins 构建', action: 'trigger_build', resource: '后端打包任务', ip: '192.168.1.1', result: 'success' },
];

export default function CredentialUsage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const credential = mockCredentials.find((c) => c.id === id);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/credentials')}>返回</Button>
        <Title level={4} className="!m-0">{credential?.name || '凭证'} - 使用记录</Title>
      </div>

      <Space className="w-full" size="middle">
        <Card className="flex-1">
          <div className="text-slate-500">累计使用次数</div>
          <div className="text-2xl font-bold">128</div>
        </Card>
        <Card className="flex-1">
          <div className="text-slate-500">今日使用次数</div>
          <div className="text-2xl font-bold">5</div>
        </Card>
        <Card className="flex-1">
          <div className="text-slate-500">最近使用时间</div>
          <div className="text-2xl font-bold">10 分钟前</div>
        </Card>
      </Space>

      <TsCard title="使用记录">
        <Table
          rowKey="id"
          dataSource={mockUsageRecords}
          pagination={false}
          columns={[
            { title: '使用时间', dataIndex: 'time', render: (t: string) => t?.replace('T', ' ').slice(0, 19) },
            { title: '操作模块', dataIndex: 'module' },
            {
              title: '操作类型',
              dataIndex: 'action',
              render: (action: string) => <StatusTag status="primary">{action}</StatusTag>,
            },
            { title: '资源', dataIndex: 'resource' },
            { title: 'IP 地址', dataIndex: 'ip' },
            {
              title: '结果',
              dataIndex: 'result',
              render: (result: string) => (
                <StatusTag status={result === 'success' ? 'success' : 'danger'}>{result === 'success' ? '成功' : '失败'}</StatusTag>
              ),
            },
          ]}
        />
      </TsCard>
    </div>
  );
}
