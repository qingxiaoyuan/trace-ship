import { useParams, useNavigate } from 'react-router-dom';
import { Card, Button, Table, Space, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { credentialApi } from '@/api/credential';

const { Title } = Typography;

export default function CredentialUsage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: credential } = useQuery({
    queryKey: ['credential', id],
    queryFn: () => credentialApi.getCredential(id || ''),
    enabled: !!id,
  });

  const { data: usageData, isLoading } = useQuery({
    queryKey: ['credential-usage', id],
    queryFn: () => credentialApi.getUsage(id || '', { page_size: 1000 }),
    enabled: !!id,
  });

  const records = (usageData?.results || []) as {
    id: string;
    created_at: string;
    module: string;
    action: string;
    resource: string;
    ip_address: string;
    result: string;
  }[];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/credentials')}>返回</Button>
        <Title level={4} className="!m-0">{credential?.name || '凭证'} - 使用记录</Title>
      </div>

      <Space className="w-full" size="middle">
        <Card className="flex-1">
          <div className="text-slate-500">累计使用次数</div>
          <div className="text-2xl font-bold">{records.length}</div>
        </Card>
        <Card className="flex-1">
          <div className="text-slate-500">今日使用次数</div>
          <div className="text-2xl font-bold">-</div>
        </Card>
        <Card className="flex-1">
          <div className="text-slate-500">最近使用时间</div>
          <div className="text-2xl font-bold">{credential?.last_used_at?.replace('T', ' ').slice(0, 16) || '-'}</div>
        </Card>
      </Space>

      <TsCard title="使用记录">
        <Table
          rowKey="id"
          dataSource={records}
          loading={isLoading}
          pagination={false}
          columns={[
            { title: '使用时间', dataIndex: 'created_at', render: (t: string) => t?.replace('T', ' ').slice(0, 19) },
            { title: '操作模块', dataIndex: 'module' },
            {
              title: '操作类型',
              dataIndex: 'action',
              render: (action: string) => <StatusTag status="primary">{action}</StatusTag>,
            },
            { title: '资源', dataIndex: 'resource' },
            { title: 'IP 地址', dataIndex: 'ip_address' },
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
