import { useState } from 'react';
import { Table, Button, Space, Avatar, App } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { SearchFilterBar } from '@/components/SearchFilterBar';
import { ProjectModal } from './modals/ProjectModal';
import { projectStatusOptions } from '@/mock/projects';
import { projectApi } from '@/api/project';
import { getAvatarColor } from '@/utils/avatar';
import type { Project } from '@/types';

export default function ProjectList() {
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const [filters, setFilters] = useState({ keyword: '', status: undefined });
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });
  const [modalOpen, setModalOpen] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['projects', filters, pagination.current, pagination.pageSize],
    queryFn: () =>
      projectApi.getProjects({
        page: pagination.current,
        page_size: pagination.pageSize,
        keyword: filters.keyword || undefined,
        status: filters.status || undefined,
      }),
  });

  const handleAdd = () => {
    setModalOpen(true);
  };

  const handleSave = async (values: Partial<Project>) => {
    try {
      await projectApi.createProject(values);
      message.success('新增成功');
      setModalOpen(false);
      setPagination((prev) => ({ ...prev, current: 1 }));
      refetch();
    } catch (error) {
      message.error('新增失败');
      console.error(error);
    }
  };

  const handleDelete = (record: Project) => {
    modal.confirm({
      title: '确认删除项目',
      content: `确定要删除「${record.name}」吗？删除后不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      async onOk() {
        try {
          await projectApi.deleteProject(record.id);
          message.success('删除成功');
          refetch();
        } catch (error) {
          message.error('删除失败');
          console.error(error);
        }
      },
    });
  };

  const columns = [
    {
      title: '项目编码',
      dataIndex: 'code',
      key: 'code',
      render: (text: string) => (
        <span className="font-mono text-xs text-slate-600">{text}</span>
      ),
    },
    {
      title: '项目名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => (
        <span className="font-semibold text-slate-900">{text}</span>
      ),
    },
    {
      title: '负责人',
      dataIndex: 'leader_name',
      key: 'leader_name',
      render: (text?: string) => (
        text ? (
          <Space>
            <Avatar
              size="small"
              style={{ backgroundColor: getAvatarColor(text), color: '#fff' }}
            >
              {text?.charAt(0)}
            </Avatar>
            {text}
          </Space>
        ) : (
          '-'
        )
      ),
    },
    { title: '仓库数', dataIndex: 'repo_count', key: 'repo_count' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: number | string) => {
        const isActive = status === 1 || status === 'active';
        return (
          <StatusTag status={isActive ? 'success' : 'neutral'}>
            {isActive ? '启用' : '停用'}
          </StatusTag>
        );
      },
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (text: string) => text?.split('T')[0],
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: Project) => (
        <Space size="small">
          <Button
            type="link"
            className="px-0! text-sm font-medium"
            onClick={() => navigate(`/projects/${record.id}`)}
          >
            编辑
          </Button>
          <Button
            type="link"
            danger
            className="px-0! text-sm font-medium"
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
      <TsCard
        title="项目列表"
        extra={
          <Button type="primary" onClick={handleAdd}>
            新增项目
          </Button>
        }
        bodyStyle={{ padding: 0 }}
      >
        <div className="px-5 py-4 bg-[#F7F6F3] border-b border-[#EAEAEA]">
          <SearchFilterBar
            filters={[
              { key: 'keyword', type: 'input', placeholder: '搜索项目编码/名称', width: 256 },
              {
                key: 'status',
                type: 'select',
                placeholder: '全部状态',
                width: 144,
                options: projectStatusOptions,
              },
            ]}
            values={filters}
            onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
            onSearch={() => {
              setPagination((prev) => ({ ...prev, current: 1 }));
              refetch();
            }}
            onReset={() => {
              setFilters({ keyword: '', status: undefined });
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

      <ProjectModal
        open={modalOpen}
        project={null}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
      />
    </div>
  );
}
