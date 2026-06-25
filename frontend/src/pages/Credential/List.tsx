import { useState } from 'react';
import { Table, Button, Space, message, Popconfirm } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { EditOutlined, HistoryOutlined, DeleteOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { SearchFilterBar } from '@/components/SearchFilterBar';
import { CredentialModal } from './modals/CredentialModal';
import {
  credentialTypeMap,
  credentialScopeMap,
  credentialTypeOptions,
  credentialScopeOptions,
} from '@/mock/credentials';
import { credentialApi } from '@/api/credential';
import type { Credential } from '@/types';

export default function CredentialList() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ keyword: '', cred_type: undefined, scope: undefined });
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCredential, setEditingCredential] = useState<Credential | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['credentials', filters, pagination.current, pagination.pageSize],
    queryFn: () =>
      credentialApi.getCredentials({
        page: pagination.current,
        page_size: pagination.pageSize,
        keyword: filters.keyword || undefined,
        cred_type: filters.cred_type || undefined,
        scope: filters.scope || undefined,
      }),
  });

  const isExpired = (date?: string) => date && new Date(date) < new Date();
  const isNearExpiry = (date?: string) => {
    if (!date) return false;
    const d = new Date(date);
    const now = new Date();
    const diff = d.getTime() - now.getTime();
    return diff > 0 && diff < 30 * 24 * 60 * 60 * 1000;
  };

  const handleDelete = async (id: string) => {
    try {
      await credentialApi.deleteCredential(id);
      message.success('删除成功');
      setPagination((prev) => ({ ...prev, current: 1 }));
      refetch();
    } catch (error) {
      message.error('删除失败');
      console.error(error);
    }
  };

  const handleSave = async (values: Partial<Credential>) => {
    try {
      if (editingCredential?.id) {
        await credentialApi.updateCredential(editingCredential.id, values);
      } else {
        await credentialApi.createCredential(values);
      }
      message.success('保存成功');
      setModalOpen(false);
      setEditingCredential(null);
      setPagination((prev) => ({ ...prev, current: 1 }));
      refetch();
    } catch (error) {
      message.error('保存失败');
      console.error(error);
    }
  };

  const columns = [
    {
      title: '凭证名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: Credential) => (
        <Button type="link" className="px-0! text-sm font-medium" onClick={() => navigate(`/credentials/${record.id}`)}>
          {name}
        </Button>
      ),
    },
    {
      title: '类型',
      dataIndex: 'cred_type',
      key: 'cred_type',
      render: (type: string) => credentialTypeMap[type] || type,
    },
    { title: '认证模式', dataIndex: 'auth_mode', key: 'auth_mode' },
    {
      title: '凭证内容',
      dataIndex: 'masked_data',
      key: 'masked_data',
      render: (text: string) => <span className="font-mono text-slate-500">{text}</span>,
    },
    {
      title: '作用范围',
      dataIndex: 'scope',
      key: 'scope',
      render: (scope: string) => credentialScopeMap[scope] || scope,
    },
    {
      title: '过期时间',
      dataIndex: 'expires_at',
      key: 'expires_at',
      render: (date?: string) => {
        if (!date) return '-';
        if (isExpired(date)) return <StatusTag status="danger">已过期</StatusTag>;
        if (isNearExpiry(date)) return <StatusTag status="warning">即将过期</StatusTag>;
        return date.split('T')[0];
      },
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (active: boolean) => (
        <StatusTag status={active ? 'success' : 'neutral'}>{active ? '正常' : '停用'}</StatusTag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 220,
      render: (_: unknown, record: Credential) => (
        <Space size="small">
          <Button type="text" icon={<EditOutlined />} onClick={() => { setEditingCredential(record); setModalOpen(true); }}>编辑</Button>
          <Button type="text" icon={<HistoryOutlined />} onClick={() => navigate(`/credentials/${record.id}/usage`)}>使用记录</Button>
          <Popconfirm title="确定删除该凭证？" onConfirm={() => handleDelete(record.id)}>
            <Button type="text" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <TsCard
        title="凭证列表"
        extra={
          <Button type="primary" onClick={() => { setEditingCredential(null); setModalOpen(true); }}>
            新增凭证
          </Button>
        }
        bodyStyle={{ padding: 0 }}
      >
        <div className="px-5 py-4 bg-[#F7F6F3] border-b border-[#EAEAEA]">
          <SearchFilterBar
            filters={[
              { key: 'keyword', type: 'input', placeholder: '搜索凭证名称', width: 256 },
              {
                key: 'cred_type',
                type: 'select',
                placeholder: '凭证类型',
                width: 160,
                options: credentialTypeOptions,
              },
              {
                key: 'scope',
                type: 'select',
                placeholder: '作用范围',
                width: 144,
                options: credentialScopeOptions,
              },
            ]}
            values={filters}
            onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
            onSearch={() => {
              setPagination((prev) => ({ ...prev, current: 1 }));
              refetch();
            }}
            onReset={() => {
              setFilters({ keyword: '', cred_type: undefined, scope: undefined });
              setPagination((prev) => ({ ...prev, current: 1 }));
            }}
          />
        </div>

        <div className="p-5">
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
        </div>
      </TsCard>

      <CredentialModal
        open={modalOpen}
        credential={editingCredential}
        onCancel={() => { setModalOpen(false); setEditingCredential(null); }}
        onOk={handleSave}
      />
    </div>
  );
}
