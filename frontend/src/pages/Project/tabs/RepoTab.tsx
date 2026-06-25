import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Table, Button, Space, App } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { repositoryApi } from '@/api/repository';
import { StatusTag } from '@/components/StatusTag';
import type { Repository } from '@/types';

const vendorMap: Record<string, { label: string; status: 'primary' | 'info' | 'neutral' }> = {
  gitlab: { label: 'GitLab', status: 'primary' },
  gitea: { label: 'Gitea', status: 'info' },
  github: { label: 'GitHub', status: 'info' },
  gitee: { label: 'Gitee', status: 'info' },
  svn: { label: 'SVN', status: 'neutral' },
};

interface RepoTabProps {
  projectId: string;
}

export function RepoTab({ projectId }: RepoTabProps) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['repositories', projectId],
    queryFn: () =>
      repositoryApi.getRepositories({ project: projectId, page_size: 1000 }),
    enabled: !!projectId,
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => repositoryApi.testRepository(id),
    onSuccess: (result) => {
      message.success(result.connected ? `连接成功：${result.detail || ''}` : `连接失败：${result.detail || ''}`);
    },
    onError: () => message.error('测试失败'),
  });

  const syncMutation = useMutation({
    mutationFn: (id: string) => repositoryApi.syncCommits(id),
    onSuccess: () => {
      message.success('同步提交成功');
      queryClient.invalidateQueries({ queryKey: ['repositories', projectId] });
    },
    onError: () => message.error('同步失败'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => repositoryApi.deleteRepository(id),
    onSuccess: () => {
      message.success('删除成功');
      queryClient.invalidateQueries({ queryKey: ['repositories', projectId] });
    },
    onError: () => message.error('删除失败'),
  });

  const handleDelete = (record: Repository) => {
    modal.confirm({
      title: '确认删除仓库',
      content: `确定要删除仓库「${record.name}」吗？删除后不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => deleteMutation.mutate(record.id),
    });
  };

  const columns = [
    {
      title: '仓库名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <span className="font-semibold text-slate-900">{text}</span>,
    },
    {
      title: '类型',
      key: 'type',
      render: (_: unknown, record: Repository) => {
        const config = vendorMap[record.vendor] || {
          label: record.vendor?.toUpperCase() || record.repo_type,
          status: 'neutral' as const,
        };
        return <StatusTag status={config.status}>{config.label}</StatusTag>;
      },
    },
    {
      title: '仓库地址',
      dataIndex: 'url',
      key: 'url',
      render: (url?: string) =>
        url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 hover:underline"
          >
            {url}
          </a>
        ) : (
          '-'
        ),
    },
    {
      title: '默认分支',
      dataIndex: 'default_branch',
      key: 'default_branch',
      render: (text?: string) => <span className="font-mono text-xs">{text || '-'}</span>,
    },
    {
      title: '凭证模式',
      dataIndex: 'credential_mode',
      key: 'credential_mode',
      render: (text?: string) => text || '-',
    },
    {
      title: '健康状态',
      dataIndex: 'health_status',
      key: 'health_status',
      render: (status?: string) => {
        const isHealthy = status === 'healthy';
        return (
          <StatusTag status={isHealthy ? 'success' : status === 'unhealthy' ? 'danger' : 'neutral'}>
            {isHealthy ? '正常' : status === 'unhealthy' ? '异常' : status || '-'}
          </StatusTag>
        );
      },
    },
    {
      title: '最后同步',
      dataIndex: 'last_sync_at',
      key: 'last_sync_at',
      render: (text?: string) => (text ? new Date(text).toLocaleString() : '-'),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: Repository) => (
        <Space>
          <Button
            type="text"
            loading={testMutation.isPending && testMutation.variables === record.id}
            onClick={() => testMutation.mutate(record.id)}
          >
            测试
          </Button>
          <Button
            type="text"
            loading={syncMutation.isPending && syncMutation.variables === record.id}
            onClick={() => syncMutation.mutate(record.id)}
          >
            同步提交
          </Button>
          <Button type="text" onClick={() => message.info('编辑功能待实现')}>
            编辑
          </Button>
          <Button
            type="text"
            danger
            loading={deleteMutation.isPending && deleteMutation.variables === record.id}
            onClick={() => handleDelete(record)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => message.info('添加仓库功能待实现')}
        >
          添加仓库
        </Button>
      </div>
      <Table
        rowKey="id"
        dataSource={data?.results || []}
        loading={isLoading}
        pagination={false}
        columns={columns}
      />
    </div>
  );
}
