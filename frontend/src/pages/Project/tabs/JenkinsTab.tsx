import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Table, Button, Space, App, Modal, Select } from 'antd';
import { PlusOutlined, EditOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { jenkinsApi } from '@/api/jenkins';
import { repositoryApi } from '@/api/repository';
import { StatusTag } from '@/components/StatusTag';
import { JenkinsJobModal } from './JenkinsJobModal';
import type { JenkinsJob } from '@/types';

interface JenkinsTabProps {
  projectId: string;
}

const credentialModeMap: Record<string, string> = {
  personal: '个人',
  project: '项目',
};

const configModeMap: Record<string, string> = {
  simple: '简单',
  advanced: '高级',
};

export function JenkinsTab({ projectId }: JenkinsTabProps) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<JenkinsJob | null>(null);
  const [triggerJob, setTriggerJob] = useState<JenkinsJob | null>(null);
  const [triggerTag, setTriggerTag] = useState('');

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
    mutationFn: ({ id, tagName }: { id: string; tagName?: string }) =>
      jenkinsApi.triggerJob(id, tagName ? { tag_name: tagName } : {}),
    onSuccess: () => {
      message.success('触发构建成功');
      setTriggerJob(null);
      setTriggerTag('');
      queryClient.invalidateQueries({ queryKey: ['jenkins-jobs', projectId] });
    },
    onError: () => message.error('触发构建失败'),
  });

  const { data: tagData, isLoading: tagsLoading } = useQuery({
    queryKey: ['repository-tags', triggerJob?.repository_id],
    queryFn: () => repositoryApi.getTags(triggerJob?.repository_id || ''),
    enabled: !!triggerJob?.repository_id,
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

  const handleTrigger = (record: JenkinsJob) => {
    if (record.config_mode === 'simple') {
      setTriggerJob(record);
      setTriggerTag('');
      return;
    }
    triggerMutation.mutate({ id: record.id });
  };

  const columns = [
    {
      title: '任务名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <span className="font-semibold text-slate-900">{text}</span>,
    },
    {
      title: '模式',
      dataIndex: 'config_mode',
      key: 'config_mode',
      render: (mode?: string) => configModeMap[mode || ''] || mode || '-',
    },
    { title: 'Jenkins 地址', dataIndex: 'server_url', key: 'server_url' },
    {
      title: 'Job / 预设',
      key: 'job_or_preset',
      render: (_: unknown, record: JenkinsJob) =>
        record.config_mode === 'simple' ? (record.build_preset_name || '-') : record.job_name,
    },
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
      title: '自动打包',
      dataIndex: 'auto_build_on_release',
      key: 'auto_build_on_release',
      render: (enabled: boolean, record: JenkinsJob) =>
        record.config_mode === 'simple' ? (enabled ? '开启' : '关闭') : '-',
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
            loading={triggerMutation.isPending && triggerMutation.variables?.id === record.id}
            onClick={() => handleTrigger(record)}
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
      <Modal
        title="选择打包 Tag"
        open={!!triggerJob}
        okText="触发构建"
        cancelText="取消"
        confirmLoading={triggerMutation.isPending}
        okButtonProps={{ disabled: !triggerTag }}
        onCancel={() => { setTriggerJob(null); setTriggerTag(''); }}
        onOk={() => {
          if (!triggerJob || !triggerTag) return;
          triggerMutation.mutate({ id: triggerJob.id, tagName: triggerTag });
        }}
      >
        <Select
          showSearch
          className="w-full"
          placeholder="选择需要打包的 tag"
          loading={tagsLoading}
          value={triggerTag || undefined}
          options={(tagData || []).map((tag) => ({ label: tag.name, value: tag.name }))}
          optionFilterProp="label"
          onChange={setTriggerTag}
        />
      </Modal>
    </div>
  );
}
