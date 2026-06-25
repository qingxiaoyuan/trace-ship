import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Tabs,
  Typography,
  Button,
  Space,
  Descriptions,
  Table,
  message,
  Popconfirm,
  Empty,
  Tag,
} from 'antd';
import {
  EditOutlined,
  DeleteOutlined,
  ApiOutlined,
  ArrowLeftOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import { StatusTag } from '@/components/StatusTag';
import { CredentialModal } from './modals/CredentialModal';
import { credentialApi } from '@/api/credential';
import { credentialTypeMap, credentialScopeMap } from '@/mock/credentials';
import type { Credential } from '@/types';

const { Title } = Typography;

export default function CredentialDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [modalOpen, setModalOpen] = useState(false);

  const { data: credential, isLoading, refetch } = useQuery({
    queryKey: ['credential', id],
    queryFn: () => credentialApi.getCredential(id || ''),
    enabled: !!id,
  });

  const { data: usageData, isLoading: usageLoading } = useQuery({
    queryKey: ['credential-usage', id],
    queryFn: () => credentialApi.getUsage(id || '', { page_size: 1000 }),
    enabled: !!id && activeTab === 'usage',
  });

  const isExpired = (date?: string) => date && new Date(date) < new Date();
  const isNearExpiry = (date?: string) => {
    if (!date) return false;
    const d = new Date(date);
    const now = new Date();
    const diff = d.getTime() - now.getTime();
    return diff > 0 && diff < 30 * 24 * 60 * 60 * 1000;
  };

  const handleTest = async () => {
    message.loading({ content: '凭证有效性检测中...', key: 'test' });
    try {
      const res = await credentialApi.testCredential(id || '');
      if (res.valid) {
        message.success({ content: '凭证有效', key: 'test' });
      } else {
        message.error({ content: res.detail || '凭证无效', key: 'test' });
      }
    } catch (error) {
      message.error({ content: '检测失败', key: 'test' });
      console.error(error);
    }
  };

  const handleDelete = async () => {
    try {
      await credentialApi.deleteCredential(id || '');
      message.success('删除成功');
      navigate('/credentials');
    } catch (error) {
      message.error('删除失败');
      console.error(error);
    }
  };

  const handleSave = async (values: Partial<Credential>) => {
    try {
      await credentialApi.updateCredential(id || '', values);
      message.success('保存成功');
      setModalOpen(false);
      refetch();
    } catch (error) {
      message.error('保存失败');
      console.error(error);
    }
  };

  if (isLoading) {
    return <div className="p-6 text-center">加载中...</div>;
  }

  if (!credential) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Empty description="凭证不存在" />
        <Button type="primary" className="mt-4" onClick={() => navigate('/credentials')}>
          返回凭证列表
        </Button>
      </div>
    );
  }

  const expiryDate = credential.expires_at;
  const expired = isExpired(expiryDate);
  const nearExpiry = isNearExpiry(expiryDate);

  const overviewItems = [
    { label: '凭证类型', value: credentialTypeMap[credential.cred_type] || credential.cred_type },
    { label: '认证模式', value: credential.auth_mode || '-' },
    { label: '用户名', value: credential.username || '-' },
    { label: '凭证内容', value: <span className="font-mono text-slate-500">{credential.masked_data}</span> },
    { label: '过期时间', value: expiryDate ? expiryDate.split('T')[0] : '-' },
    { label: '作用范围', value: credentialScopeMap[credential.scope] || credential.scope },
    { label: '关联项目', value: credential.project_name || '-' },
    { label: '创建时间', value: credential.created_at?.replace('T', ' ').slice(0, 16) || '-' },
    { label: '最后使用时间', value: credential.last_used_at?.replace('T', ' ').slice(0, 16) || '-' },
  ];

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
      {/* 头部信息区 */}
      <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <Button
                type="text"
                icon={<ArrowLeftOutlined />}
                onClick={() => navigate('/credentials')}
                className="px-2! -ml-2"
              />
              <Title level={4} className="m-0! text-slate-900!">{credential.name}</Title>
            </div>
            <div className="mt-1.5 flex items-center gap-3 text-sm text-slate-500">
              <Tag color="blue">{credentialTypeMap[credential.cred_type] || credential.cred_type}</Tag>
              <span>作用范围：{credentialScopeMap[credential.scope] || credential.scope}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Space>
              <StatusTag status={credential.is_active ? 'success' : 'neutral'}>
                {credential.is_active ? '正常' : '停用'}
              </StatusTag>
              {expired && <StatusTag status="danger">已过期</StatusTag>}
              {!expired && nearExpiry && <StatusTag status="warning">即将过期</StatusTag>}
            </Space>
            <Space>
              <Button icon={<EditOutlined />} onClick={() => setModalOpen(true)}>编辑</Button>
              <Button icon={<ApiOutlined />} onClick={handleTest}>测试有效性</Button>
              <Button
                icon={<HistoryOutlined />}
                onClick={() => navigate(`/credentials/${credential.id}/usage`)}
              >
                使用记录
              </Button>
              <Popconfirm title="确定删除该凭证？" onConfirm={handleDelete}>
                <Button danger icon={<DeleteOutlined />}>删除</Button>
              </Popconfirm>
            </Space>
          </div>
        </div>

        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            { key: 'overview', label: '基本信息' },
            { key: 'usage', label: '使用记录' },
          ]}
          tabBarStyle={{ padding: '0 16px', marginBottom: 0, background: 'rgba(248, 250, 252, 0.5)' }}
        />
      </div>

      {/* Tab 内容 */}
      <div className="bg-white rounded-xl border border-slate-100 p-6">
        {activeTab === 'overview' && (
          <Descriptions bordered column={2} labelStyle={{ width: 160, background: '#F9F9F8' }}>
            {overviewItems.map((item) => (
              <Descriptions.Item key={item.label} label={item.label}>
                {item.value}
              </Descriptions.Item>
            ))}
          </Descriptions>
        )}

        {activeTab === 'usage' && (
          <Table
            rowKey="id"
            loading={usageLoading}
            dataSource={records}
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
                  <StatusTag status={result === 'success' ? 'success' : 'danger'}>
                    {result === 'success' ? '成功' : '失败'}
                  </StatusTag>
                ),
              },
            ]}
          />
        )}
      </div>

      <CredentialModal
        open={modalOpen}
        credential={credential}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
      />
    </div>
  );
}
