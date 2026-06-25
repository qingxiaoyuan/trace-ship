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
} from 'antd';
import {
  EditOutlined,
  DeleteOutlined,
  SyncOutlined,
  ApiOutlined,
  ArrowLeftOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import { StatusTag } from '@/components/StatusTag';
import { RepositoryModal } from './modals/RepositoryModal';
import { repositoryApi } from '@/api/repository';
import type { Repository } from '@/types';

const { Title, Text } = Typography;

export default function RepositoryDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [modalOpen, setModalOpen] = useState(false);

  const { data: repo, isLoading, refetch } = useQuery({
    queryKey: ['repository', id],
    queryFn: () => repositoryApi.getRepository(id || ''),
    enabled: !!id,
  });

  const { data: branches, isLoading: branchesLoading } = useQuery({
    queryKey: ['repository-branches', id],
    queryFn: () => repositoryApi.getBranches(id || ''),
    enabled: !!id && activeTab === 'branches',
  });

  const handleTest = async () => {
    message.loading({ content: '连通性测试中...', key: 'test' });
    try {
      const res = await repositoryApi.testRepository(id || '');
      if (res.connected) {
        message.success({ content: '连接成功', key: 'test' });
      } else {
        message.error({ content: res.detail || '连接失败', key: 'test' });
      }
    } catch (error) {
      message.error({ content: '测试失败', key: 'test' });
      console.error(error);
    }
  };

  const handleSync = async () => {
    message.loading({ content: '同步提交中...', key: 'sync' });
    try {
      await repositoryApi.syncCommits(id || '');
      message.success({ content: '同步成功', key: 'sync' });
    } catch (error) {
      message.error({ content: '同步失败', key: 'sync' });
      console.error(error);
    }
  };

  const handleDelete = async () => {
    try {
      await repositoryApi.deleteRepository(id || '');
      message.success('删除成功');
      navigate('/repositories');
    } catch (error) {
      message.error('删除失败');
      console.error(error);
    }
  };

  const handleSave = async (values: Partial<Repository>) => {
    try {
      await repositoryApi.updateRepository(id || '', values);
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

  if (!repo) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Empty description="仓库不存在" />
        <Button type="primary" className="mt-4" onClick={() => navigate('/repositories')}>
          返回仓库列表
        </Button>
      </div>
    );
  }

  const isHealthy = repo.health_status === 'healthy';
  const repoUrl = repo.clone_url || repo.url;

  const overviewItems = [
    { label: '仓库类型', value: repo.repo_type?.toUpperCase() || '-' },
    { label: '平台', value: repo.vendor?.toUpperCase() || '-' },
    { label: '默认分支', value: repo.default_branch || '-' },
    { label: 'External Identity', value: repo.external_identity || '-' },
    { label: '凭证模式', value: repo.credential_mode_display || repo.credential_mode || '-' },
    { label: '凭证名称', value: repo.credential_name || '-' },
    { label: '创建时间', value: repo.created_at?.replace('T', ' ').slice(0, 16) || '-' },
    { label: '最后同步时间', value: repo.last_sync_at?.replace('T', ' ').slice(0, 16) || '-' },
  ];

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
                onClick={() => navigate('/repositories')}
                className="px-2! -ml-2"
              />
              <Title level={4} className="m-0! text-slate-900!">{repo.name}</Title>
            </div>
            <div className="mt-1.5 flex items-center gap-3 text-sm text-slate-500">
              <span>关联项目：{repo.project_name || '-'}</span>
              <a
                href={repoUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-blue-600 hover:text-blue-700"
              >
                {repoUrl} <LinkOutlined />
              </a>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <StatusTag status={isHealthy ? 'success' : 'danger'}>
              {isHealthy ? '正常' : '异常'}
            </StatusTag>
            <Space>
              <Button icon={<EditOutlined />} onClick={() => setModalOpen(true)}>编辑</Button>
              <Button icon={<ApiOutlined />} onClick={handleTest}>测试连通性</Button>
              <Button icon={<SyncOutlined />} onClick={handleSync}>同步提交</Button>
              <Popconfirm title="确定删除该仓库？" onConfirm={handleDelete}>
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
            { key: 'branches', label: '分支列表' },
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

        {activeTab === 'branches' && (
          <Table
            rowKey="name"
            loading={branchesLoading}
            dataSource={branches || []}
            pagination={false}
            columns={[
              { title: '分支名称', dataIndex: 'name' },
              {
                title: '是否默认',
                dataIndex: 'is_default',
                render: (isDefault: boolean) =>
                  isDefault ? <StatusTag status="primary">默认</StatusTag> : <Text type="secondary">-</Text>,
              },
              {
                title: '最后提交',
                dataIndex: 'last_commit_hash',
                render: (hash?: string) =>
                  hash ? <span className="font-mono text-xs text-slate-500">{hash.slice(0, 8)}</span> : '-',
              },
            ]}
          />
        )}
      </div>

      <RepositoryModal
        open={modalOpen}
        repo={repo}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
      />
    </div>
  );
}
