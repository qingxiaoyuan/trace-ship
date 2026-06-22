import { useState } from 'react';
import { Table, Button, Space, Avatar, message, Popconfirm } from 'antd';
import {
  EditOutlined,
  TeamOutlined,
  LinkOutlined,
  StopOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { SearchFilterBar } from '@/components/SearchFilterBar';
import { ProjectModal } from './modals/ProjectModal';
import { mockProjects, projectStatusOptions } from '@/mock/projects';
import type { Project } from '@/types';

export default function ProjectList() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ keyword: '', status: undefined });
  const [data] = useState<Project[]>(mockProjects);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  const handleEdit = (project: Project) => {
    setEditingProject(project);
    setModalOpen(true);
  };

  const handleAdd = () => {
    setEditingProject(null);
    setModalOpen(true);
  };

  const handleSave = (values: Partial<Project>) => {
    console.log('save project', values);
    setModalOpen(false);
    message.success(editingProject ? '编辑成功' : '新增成功');
  };

  const columns = [
    {
      title: '项目编码',
      dataIndex: 'code',
      key: 'code',
      render: (text: string, record: Project) => (
        <Button type="link" onClick={() => navigate(`/projects/${record.id}`)} className="!px-0">
          {text}
        </Button>
      ),
    },
    { title: '项目名称', dataIndex: 'name', key: 'name' },
    {
      title: '负责人',
      dataIndex: 'leader_name',
      key: 'leader_name',
      render: (text: string) => (
        <Space>
          <Avatar size="small" style={{ background: '#2563EB' }}>{text?.charAt(0)}</Avatar>
          {text}
        </Space>
      ),
    },
    { title: '关联仓库数', dataIndex: 'repo_count', key: 'repo_count' },
    { title: '成员数', dataIndex: 'member_count', key: 'member_count' },
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
      width: 280,
      render: (_: unknown, record: Project) => (
        <Space size="small">
          <Button type="text" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          <Button type="text" icon={<TeamOutlined />} onClick={() => navigate(`/projects/${record.id}/members`)}>成员</Button>
          <Button type="text" icon={<LinkOutlined />} onClick={() => navigate(`/projects/${record.id}/integrations`)}>外站绑定</Button>
          <Popconfirm
            title={`确定要${record.status === 'active' ? '停用' : '启用'}该项目吗？`}
            onConfirm={() => message.success('操作成功')}
          >
            <Button
              type="text"
              icon={record.status === 'active' ? <StopOutlined /> : <CheckCircleOutlined />}
            >
              {record.status === 'active' ? '停用' : '启用'}
            </Button>
          </Popconfirm>
          <Popconfirm title="确定要删除该项目吗？" onConfirm={() => message.success('删除成功')}>
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
        project={editingProject}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
      />
    </div>
  );
}
