import { useState } from 'react';
import { Table, Button, Space, Avatar, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { SearchFilterBar } from '@/components/SearchFilterBar';
import { ProjectModal } from './modals/ProjectModal';
import { mockProjects, projectStatusOptions } from '@/mock/projects';
import { getAvatarColor } from '@/utils/avatar';
import type { Project } from '@/types';

export default function ProjectList() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ keyword: '', status: undefined });
  const [data] = useState<Project[]>(mockProjects);
  const [modalOpen, setModalOpen] = useState(false);

  const handleAdd = () => {
    setModalOpen(true);
  };

  const handleSave = (values: Partial<Project>) => {
    console.log('save project', values);
    setModalOpen(false);
    message.success('新增成功');
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
      render: (text: string) => (
        <Space>
          <Avatar
            size="small"
            style={{ backgroundColor: getAvatarColor(text), color: '#fff' }}
          >
            {text?.charAt(0)}
          </Avatar>
          {text}
        </Space>
      ),
    },
    { title: '仓库数', dataIndex: 'repo_count', key: 'repo_count' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <StatusTag status={status === 'active' ? 'success' : 'neutral'}>
          {status === 'active' ? '启用' : '停用'}
        </StatusTag>
      ),
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
        <Button
          type="link"
          className="px-0! text-sm font-medium"
          onClick={() => navigate(`/projects/${record.id}`)}
        >
          编辑
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <TsCard bodyStyle={{ padding: 20 }}>
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
          onSearch={() => message.info('执行查询')}
          onReset={() => setFilters({ keyword: '', status: undefined })}
          addText="新增项目"
          onAdd={handleAdd}
        />
      </TsCard>

      <TsCard title="项目列表">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data}
          pagination={{ pageSize: 10 }}
        />
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
