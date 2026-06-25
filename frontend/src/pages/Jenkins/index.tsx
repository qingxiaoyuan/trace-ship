import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Table, Button, Space, App, Tabs } from 'antd';
import { PlusOutlined, EditOutlined, PlayCircleOutlined, FileTextOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { TsCard } from '@/components/TsCard';
import { StatusTag, type StatusType } from '@/components/StatusTag';
import { SearchFilterBar } from '@/components/SearchFilterBar';
import { JenkinsJobModal } from './modals/JenkinsJobModal';
import { jenkinsApi } from '@/api/jenkins';
import { projectApi } from '@/api/project';
import type { JenkinsJob, BuildRecord } from '@/types';

const jobStatusMap: Record<string, { status: StatusType; text: string }> = {
  true: { status: 'success', text: '启用' },
  false: { status: 'neutral', text: '停用' },
};

const buildStatusMap: Record<string, { status: StatusType; text: string }> = {
  queue: { status: 'info', text: '排队中' },
  running: { status: 'warning', text: '构建中' },
  success: { status: 'success', text: '成功' },
  failure: { status: 'danger', text: '失败' },
  aborted: { status: 'neutral', text: '中止' },
};

const credentialModeMap: Record<string, string> = {
  fixed: '项目固定凭证',
  current_user: '当前用户',
  specified_user: '指定用户',
  global: '系统全局凭证',
};

export default function Jenkins() {
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('jobs');

  const [jobFilters, setJobFilters] = useState<{ project?: string; keyword?: string }>({ project: undefined, keyword: '' });
  const [jobPagination, setJobPagination] = useState({ current: 1, pageSize: 10 });
  const [jobModalOpen, setJobModalOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<JenkinsJob | null>(null);

  const [buildFilters, setBuildFilters] = useState<{ status?: string }>({ status: undefined });
  const [buildPagination, setBuildPagination] = useState({ current: 1, pageSize: 10 });

  const { data: projectData } = useQuery({
    queryKey: ['projects-all'],
    queryFn: () => projectApi.getProjects({ page_size: 1000 }),
  });

  const { data: jobData, isLoading: jobsLoading } = useQuery({
    queryKey: ['jenkins-jobs', jobFilters, jobPagination.current, jobPagination.pageSize],
    queryFn: () => jenkinsApi.getJobs({
      project: jobFilters.project,
      page: jobPagination.current,
      page_size: jobPagination.pageSize,
    }),
  });

  const { data: buildData, isLoading: buildsLoading } = useQuery({
    queryKey: ['jenkins-builds', buildFilters, buildPagination.current, buildPagination.pageSize],
    queryFn: () => jenkinsApi.getBuilds({
      status: buildFilters.status,
      page: buildPagination.current,
      page_size: buildPagination.pageSize,
    }),
  });

  const saveMutation = useMutation({
    mutationFn: (values: Partial<JenkinsJob> & { id?: string }) => {
      if (values.id) return jenkinsApi.updateJob(values.id, values);
      return jenkinsApi.createJob(values);
    },
    onSuccess: () => {
      message.success('保存成功');
      setJobModalOpen(false);
      setEditingJob(null);
      queryClient.invalidateQueries({ queryKey: ['jenkins-jobs'] });
    },
    onError: () => message.error('保存失败'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => jenkinsApi.deleteJob(id),
    onSuccess: () => {
      message.success('删除成功');
      queryClient.invalidateQueries({ queryKey: ['jenkins-jobs'] });
    },
    onError: () => message.error('删除失败'),
  });

  const triggerMutation = useMutation({
    mutationFn: (id: string) => jenkinsApi.triggerJob(id),
    onSuccess: () => message.success('触发构建成功'),
    onError: () => message.error('触发构建失败'),
  });

  const projectOptions = (projectData?.results || []).map((p) => ({ label: p.name, value: p.id }));

  const handleAddJob = () => {
    setEditingJob(null);
    setJobModalOpen(true);
  };

  const handleEditJob = (record: JenkinsJob) => {
    setEditingJob(record);
    setJobModalOpen(true);
  };

  const handleDeleteJob = (record: JenkinsJob) => {
    modal.confirm({
      title: '确认删除任务',
      content: `确定要删除任务「${record.name}」吗？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => deleteMutation.mutate(record.id),
    });
  };

  const handleSaveJob = (values: Partial<JenkinsJob>) => {
    if (editingJob?.id) {
      saveMutation.mutate({ ...values, id: editingJob.id });
    } else {
      saveMutation.mutate(values);
    }
  };

  const jobColumns = [
    { title: '任务名称', dataIndex: 'name', key: 'name' },
    { title: '项目', dataIndex: 'project_name', key: 'project_name' },
    { title: 'Jenkins 地址', dataIndex: 'server_url', key: 'server_url' },
    { title: 'Job 名', dataIndex: 'job_name', key: 'job_name' },
    { title: '关联仓库', dataIndex: 'repository_name', key: 'repository_name', render: (v?: string) => v || '-' },
    { title: '凭证模式', dataIndex: 'credential_mode', key: 'credential_mode', render: (v?: string) => credentialModeMap[v || ''] || v || '-' },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (v: boolean) => {
        const item = jobStatusMap[String(v)];
        return <StatusTag status={item.status}>{item.text}</StatusTag>;
      },
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: JenkinsJob) => (
        <Space>
          <Button type="text" icon={<PlayCircleOutlined />} loading={triggerMutation.isPending && triggerMutation.variables === record.id} onClick={() => triggerMutation.mutate(record.id)}>触发构建</Button>
          <Button type="text" icon={<EditOutlined />} onClick={() => handleEditJob(record)}>编辑</Button>
          <Button type="text" danger loading={deleteMutation.isPending && deleteMutation.variables === record.id} onClick={() => handleDeleteJob(record)}>删除</Button>
        </Space>
      ),
    },
  ];

  const buildColumns = [
    { title: '任务名', dataIndex: 'job_name', key: 'job_name' },
    { title: '构建号', dataIndex: 'build_number', key: 'build_number', render: (n?: number) => (n ? <span className="font-mono text-xs">#{n}</span> : '-') },
    { title: '版本号', dataIndex: 'version', key: 'version', render: (v?: string) => v || '-' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const item = buildStatusMap[status];
        return item ? <StatusTag status={item.status}>{item.text}</StatusTag> : status;
      },
    },
    { title: '开始时间', dataIndex: 'started_at', key: 'started_at', render: (v?: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-') },
    { title: '结束时间', dataIndex: 'finished_at', key: 'finished_at', render: (v?: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-') },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: BuildRecord) => (
        <Button type="text" icon={<FileTextOutlined />} onClick={() => navigate(`/jenkins/logs/${record.id}`)}>查看日志</Button>
      ),
    },
  ];

  const statusOptions = Object.entries(buildStatusMap).map(([value, { text }]) => ({ value, label: text }));

  return (
    <div className="space-y-4">
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
        {
          key: 'jobs',
          label: 'Jenkins 任务',
          children: (
            <TsCard title="任务列表" extra={<Button type="primary" icon={<PlusOutlined />} onClick={handleAddJob}>新增任务</Button>} bodyStyle={{ padding: 0 }}>
              <div className="px-5 py-4 bg-[#F7F6F3] border-b border-[#EAEAEA]">
                <SearchFilterBar
                  filters={[
                    { key: 'project', type: 'select', placeholder: '关联项目', width: 176, options: projectOptions },
                    { key: 'keyword', type: 'input', placeholder: '搜索任务/Job 名', width: 256 },
                  ]}
                  values={jobFilters}
                  onChange={(key, value) => setJobFilters((prev) => ({ ...prev, [key]: value }))}
                  onSearch={() => setJobPagination((prev) => ({ ...prev, current: 1 }))}
                  onReset={() => { setJobFilters({ project: undefined, keyword: '' }); setJobPagination((prev) => ({ ...prev, current: 1 })); }}
                />
              </div>
              <div className="p-5">
                <Table
                  rowKey="id"
                  columns={jobColumns}
                  dataSource={jobData?.results || []}
                  loading={jobsLoading}
                  pagination={{
                    current: jobPagination.current,
                    pageSize: jobPagination.pageSize,
                    total: jobData?.total || 0,
                    showSizeChanger: true,
                  }}
                  onChange={(p) => setJobPagination({ current: p.current || 1, pageSize: p.pageSize || 10 })}
                />
              </div>
            </TsCard>
          ),
        },
        {
          key: 'builds',
          label: '构建记录',
          children: (
            <TsCard title="构建记录" bodyStyle={{ padding: 0 }}>
              <div className="px-5 py-4 bg-[#F7F6F3] border-b border-[#EAEAEA]">
                <SearchFilterBar
                  filters={[
                    { key: 'status', type: 'select', placeholder: '构建状态', width: 144, options: statusOptions },
                  ]}
                  values={buildFilters}
                  onChange={(key, value) => setBuildFilters((prev) => ({ ...prev, [key]: value }))}
                  onSearch={() => setBuildPagination((prev) => ({ ...prev, current: 1 }))}
                  onReset={() => { setBuildFilters({ status: undefined }); setBuildPagination((prev) => ({ ...prev, current: 1 })); }}
                />
              </div>
              <div className="p-5">
                <Table
                  rowKey="id"
                  columns={buildColumns}
                  dataSource={buildData?.results || []}
                  loading={buildsLoading}
                  pagination={{
                    current: buildPagination.current,
                    pageSize: buildPagination.pageSize,
                    total: buildData?.total || 0,
                    showSizeChanger: true,
                  }}
                  onChange={(p) => setBuildPagination({ current: p.current || 1, pageSize: p.pageSize || 10 })}
                />
              </div>
            </TsCard>
          ),
        },
      ]} />
      <JenkinsJobModal
        open={jobModalOpen}
        job={editingJob}
        onCancel={() => { setJobModalOpen(false); setEditingJob(null); }}
        onOk={handleSaveJob}
      />
    </div>
  );
}
