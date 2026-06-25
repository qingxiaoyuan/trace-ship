import { useState } from 'react';
import { Table, Button, Space, Tag, message, Popconfirm } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { EditOutlined, LinkOutlined, SyncOutlined, DeleteOutlined } from '@ant-design/icons';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { SearchFilterBar } from '@/components/SearchFilterBar';
import { RepositoryModal } from './modals/RepositoryModal';
import { repoTypeOptions } from '@/mock/repositories';
import { repositoryApi } from '@/api/repository';
import type { Repository } from '@/types';

export default function RepositoryList() {
  const [filters, setFilters] = useState({ keyword: '', project_id: undefined, repo_type: undefined });
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRepo, setEditingRepo] = useState<Repository | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['repositories', filters, pagination.current, pagination.pageSize],
    queryFn: () =>
      repositoryApi.getRepositories({
        page: pagination.current,
        page_size: pagination.pageSize,
        keyword: filters.keyword || undefined,
        project_id: filters.project_id || undefined,
        repo_type: filters.repo_type || undefined,
      }),
  });

  const handleTest = async (id: string) => {
    message.loading({ content: '连通性测试中...', key: 'test' });
    try {
      const res = await repositoryApi.testRepository(id);
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

  const handleSync = async (id: string) => {
    message.loading({ content: '同步提交中...', key: 'sync' });
    try {
      await repositoryApi.syncCommits(id);
      message.success({ content: '同步成功', key: 'sync' });
    } catch (error) {
      message.error({ content: '同步失败', key: 'sync' });
      console.error(error);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await repositoryApi.deleteRepository(id);
      message.success('删除成功');
      setPagination((prev) => ({ ...prev, current: 1 }));
      refetch();
    } catch (error) {
      message.error('删除失败');
      console.error(error);
    }
  };

  const handleSave = async (values: Partial<Repository>) => {
    try {
      if (editingRepo?.id) {
        await repositoryApi.updateRepository(editingRepo.id, values);
      } else {
        await repositoryApi.createRepository(values);
      }
      message.success('保存成功');
      setModalOpen(false);
      setEditingRepo(null);
      setPagination((prev) => ({ ...prev, current: 1 }));
      refetch();
    } catch (error) {
      message.error('保存失败');
      console.error(error);
    }
  };

  const columns = [
    {
      title: '仓库类型',
      dataIndex: 'vendor',
      key: 'vendor',
      render: (vendor: string) => <Tag color="blue">{vendor.toUpperCase()}</Tag>,
    },
    { title: '关联项目', dataIndex: 'project_name', key: 'project_name' },
    {
      title: '仓库地址',
      dataIndex: 'url',
      key: 'url',
      render: (url: string) => (
        <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1">
          {url} <LinkOutlined />
        </a>
      ),
    },
    { title: '默认分支', dataIndex: 'default_branch', key: 'default_branch' },
    { title: '凭证归属', dataIndex: 'credential_mode', key: 'credential_mode' },
    {
      title: '最近同步',
      dataIndex: 'last_sync_at',
      key: 'last_sync_at',
      render: (text: string) => text?.replace('T', ' ').slice(0, 16),
    },
    {
      title: '健康状态',
      dataIndex: 'health_status',
      key: 'health_status',
      render: (status: string) => (
        <StatusTag status={status === 'healthy' ? 'success' : 'danger'}>
          {status === 'healthy' ? '正常' : '异常'}
        </StatusTag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 240,
      render: (_: unknown, record: Repository) => (
        <Space size="small">
          <Button type="text" icon={<EditOutlined />} onClick={() => { setEditingRepo(record); setModalOpen(true); }}>编辑</Button>
          <Button type="text" onClick={() => handleTest(record.id)}>测试连通性</Button>
          <Button type="text" icon={<SyncOutlined />} onClick={() => handleSync(record.id)}>同步提交</Button>
          <Popconfirm title="确定删除该仓库？" onConfirm={() => handleDelete(record.id)}>
            <Button type="text" danger icon={<DeleteOutlined />}>删除</Button>
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
            { key: 'keyword', type: 'input', placeholder: '搜索仓库名称/地址', width: 256 },
            {
              key: 'project_id',
              type: 'select',
              placeholder: '关联项目',
              width: 176,
              options: [{ label: '核心交易平台', value: '1' }],
            },
            {
              key: 'repo_type',
              type: 'select',
              placeholder: '仓库类型',
              width: 144,
              options: repoTypeOptions,
            },
          ]}
          values={filters}
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onSearch={() => {
            setPagination((prev) => ({ ...prev, current: 1 }));
            refetch();
          }}
          onReset={() => {
            setFilters({ keyword: '', project_id: undefined, repo_type: undefined });
            setPagination((prev) => ({ ...prev, current: 1 }));
          }}
          addText="新增仓库"
          onAdd={() => { setEditingRepo(null); setModalOpen(true); }}
        />
      </TsCard>

      <TsCard title="仓库列表">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data?.results || []}
          loading={isLoading}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: data?.total || 0,
            showSizeChanger: true,
          }}
          onChange={(p) => {
            setPagination({ current: p.current || 1, pageSize: p.pageSize || 10 });
          }}
        />
      </TsCard>

      <RepositoryModal
        open={modalOpen}
        repo={editingRepo}
        onCancel={() => { setModalOpen(false); setEditingRepo(null); }}
        onOk={handleSave}
      />
    </div>
  );
}
