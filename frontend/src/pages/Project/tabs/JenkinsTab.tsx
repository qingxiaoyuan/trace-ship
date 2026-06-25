import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Table, Button, Space, App } from 'antd';
import { PlusOutlined, EditOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { jenkinsApi } from '@/api/jenkins';
import { StatusTag } from '@/components/StatusTag';
import { JenkinsJobModal } from './JenkinsJobModal';
import type { JenkinsJob } from '@/types';

interface JenkinsTabProps {
  projectId: string;
}

const credentialModeMap: Record<string, string> = {
  fixed: '项目固定凭证',
  current_user: '当前用户',
  specified_user: '指定用户',
  global: '系统全局凭证',
};

export function JenkinsTab({ projectId }: JenkinsTabProps) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<JenkinsJob | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['jenkins-jobs', projectId],
    queryFn: () => jenkinsApi.getJobs({ project: projectId, page_size: 1000 }),
    enabled: !!projectId,
  });

  const saveMutation = useMutation({
    mutationFn: (values: Partial<JenkinsJob> & { id?: string }) => {
      if (values.id) {
        return jenkinsApi.updateJob(values.id, values);
      }
      return jenkinsApi.createJob(values);
    },
    onSuccess: () => {
      message.success('保存成功');
      setModalOpen(false);
      setEditingJob(null);
      queryClient.invalidateQueries({ queryKey: ['jenkins-jobs', projectId] });
    },
    onError: () => message.error('保存失败'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => jenkinsApi.deleteJob(id),
    onSuccess: () => {
      message.success('删除成功');
      queryClient.invalidateQueries({ queryKey: ['jenkins-jobs', projectId] });
    },
    onError: () => message.error('删除失败'),
  });

  const triggerMutation = useMutation({
    mutationFn: (id: string) => jenkinsApi.triggerJob(id),
    onSuccess: () => message.success('触发构建成功'),
    onError: () => message.error('触发构建失败'),
  });

  const handleAdd = () => {
    setEditingJob(null);
    setModalOpen(true);
  };

  const handleEdit = (record: JenkinsJob) => {
    setEditingJob(record);
    setModalOpen(true);
  };

  const handleDelete = (record: JenkinsJob) => {
    modal.confirm({
      title: '确认删除任务',
      content: `确定要删除任务「${record.name}」吗？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => deleteMutation.mutate(record.id),
    });
  };

  const handleSave = (values: Partial<JenkinsJob>) => {
    if (editingJob?.id) {
      saveMutation.mutate({ ...values, id: editingJob.id });
    } else {
      saveMutation.mutate(values);
    }
  };

  const columns = [
    {
      title: '任务名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <span className="font-semibold text-slate-900">{text}</span>,
    },
    { title: 'Jenkins 地址', dataIndex: 'server_url', key: 'server_url' },
    { title: 'Job 名', dataIndex: 'job_name', key: 'job_name' },
    {
      title: '关联仓库',
      dataIndex: 'repository_name',
      key: 'repository_name',
      render: (text?: string) => text || '-',
    },
    {
      title: '凭证模式',
      dataIndex: 'credential_mode',
      key: 'credential_mode',
      render: (mode?: string) => credentialModeMap[mode || ''] || mode || '-',
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (active: boolean) => (
        <StatusTag status={active ? 'success' : 'neutral'}>
          {active ? '启用' : '停用'}
        </StatusTag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: JenkinsJob) => (
        <Space>
          <Button
            type="text"
            icon={<PlayCircleOutlined />}
            loading={triggerMutation.isPending && triggerMutation.variables === record.id}
            onClick={() => triggerMutation.mutate(record.id)}
          >
            触发构建
          </Button>
          <Button type="text" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
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
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          新增 Jenkins 任务
        </Button>
      </div>
      <Table
        rowKey="id"
        dataSource={data?.results || []}
        loading={isLoading}
        pagination={false}
        columns={columns}
      />
      <JenkinsJobModal
        open={modalOpen}
        job={editingJob}
        projectId={projectId}
        onCancel={() => { setModalOpen(false); setEditingJob(null); }}
        onOk={handleSave}
      />
    </div>
  );
}
