import { useEffect } from 'react';
import { Form, Input, Select, Switch } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { TsModal } from '@/components/TsModal';
import { projectApi } from '@/api/project';
import { repositoryApi } from '@/api/repository';
import { credentialApi } from '@/api/credential';
import { accountApi } from '@/api/account';
import type { JenkinsJob } from '@/types';

interface JenkinsJobModalProps {
  open: boolean;
  job: JenkinsJob | null;
  onCancel: () => void;
  onOk: (values: Partial<JenkinsJob>) => void | Promise<void>;
}

const credentialModeOptions = [
  { label: '项目固定凭证', value: 'fixed' },
  { label: '当前用户', value: 'current_user' },
  { label: '指定用户', value: 'specified_user' },
  { label: '系统全局凭证', value: 'global' },
];

export function JenkinsJobModal({ open, job, onCancel, onOk }: JenkinsJobModalProps) {
  const [form] = Form.useForm();

  const { data: projectData, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects-all'],
    queryFn: () => projectApi.getProjects({ page_size: 1000 }),
    enabled: open,
  });

  const selectedProjectId = Form.useWatch('project', form);

  const { data: repoData, isLoading: reposLoading } = useQuery({
    queryKey: ['repositories', selectedProjectId],
    queryFn: () => repositoryApi.getRepositories({ project: selectedProjectId, page_size: 1000 }),
    enabled: open && !!selectedProjectId,
  });

  const { data: credentialData, isLoading: credentialsLoading } = useQuery({
    queryKey: ['credentials-all'],
    queryFn: () => credentialApi.getCredentials({ page_size: 1000 }),
    enabled: open,
  });

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['account-users-all'],
    queryFn: () => accountApi.getUsers({ page_size: 1000 }),
    enabled: open,
  });

  const projectOptions =
    projectData?.results.map((p) => ({ label: p.name, value: p.id })) || [];
  const repoOptions =
    repoData?.results.map((r) => ({ label: r.name, value: r.id })) || [];
  const credentialOptions =
    credentialData?.results.map((c) => ({ label: c.name, value: c.id })) || [];
  const userOptions =
    usersData?.results.map((u) => ({
      label: `${u.nickname || u.username} (${u.username})`,
      value: u.id,
    })) || [];

  useEffect(() => {
    if (open) {
      if (job) {
        form.setFieldsValue({
          project: job.project_id,
          repository: job.repository_id,
          name: job.name,
          server_url: job.server_url,
          job_name: job.job_name,
          credential_mode: job.credential_mode || 'fixed',
          credential: job.credential_id,
          specified_user: job.specified_user_id,
          params_template: job.params_template ? JSON.stringify(job.params_template, null, 2) : '',
          is_active: job.is_active,
        });
      } else {
        form.resetFields();
        form.setFieldsValue({
          credential_mode: 'fixed',
          is_active: true,
          params_template: JSON.stringify({ VERSION: '{version}', BRANCH: '{branch}' }, null, 2),
        });
      }
    }
  }, [open, job, form]);

  const credentialMode = Form.useWatch('credential_mode', form);


  const handleOk = () => {
    form.validateFields().then((values) => {
      let paramsTemplate: unknown = {};
      if (values.params_template) {
        try {
          paramsTemplate = JSON.parse(values.params_template);
        } catch {
          paramsTemplate = values.params_template;
        }
      }
      const payload: Partial<JenkinsJob> & Record<string, unknown> = {
        project: values.project,
        repository: values.repository,
        name: values.name,
        server_url: values.server_url,
        job_name: values.job_name,
        credential_mode: values.credential_mode,
        credential: values.credential_mode === 'fixed' ? values.credential : undefined,
        specified_user:
          values.credential_mode === 'specified_user' ? values.specified_user : undefined,
        params_template: paramsTemplate,
        is_active: values.is_active,
      };
      onOk(payload as Partial<JenkinsJob>);
      form.resetFields();
    });
  };

  const isFixed = credentialMode === 'fixed';
  const isSpecifiedUser = credentialMode === 'specified_user';

  return (
    <TsModal
      title={job ? '编辑 Jenkins 任务' : '新增 Jenkins 任务'}
      open={open}
      onCancel={() => {
        form.resetFields();
        onCancel();
      }}
      onOk={handleOk}
      confirmLoading={projectsLoading || reposLoading || credentialsLoading || usersLoading}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="project"
          label="关联项目"
          rules={[{ required: true, message: '请选择项目' }]}
        >
          <Select
            showSearch
            placeholder="选择项目"
            loading={projectsLoading}
            options={projectOptions}
            optionFilterProp="label"
            onChange={() => form.setFieldsValue({ repository: undefined })}
          />
        </Form.Item>
        <Form.Item name="repository" label="关联仓库">
          <Select
            showSearch
            allowClear
            placeholder="选择关联仓库（用于匹配发布流程）"
            loading={reposLoading}
            options={repoOptions}
            optionFilterProp="label"
          />
        </Form.Item>
        <Form.Item
          name="name"
          label="任务名称"
          rules={[{ required: true, message: '请输入任务名称' }]}
        >
          <Input placeholder="如：后端打包" />
        </Form.Item>
        <Form.Item
          name="server_url"
          label="Jenkins 地址"
          rules={[{ required: true, message: '请输入 Jenkins 地址' }]}
        >
          <Input placeholder="https://jenkins.example.com" />
        </Form.Item>
        <Form.Item
          name="job_name"
          label="Jenkins Job 名"
          rules={[{ required: true, message: '请输入 Jenkins Job 名' }]}
        >
          <Input placeholder="如：backend-build" />
        </Form.Item>
        <Form.Item
          name="credential_mode"
          label="凭证模式"
          rules={[{ required: true, message: '请选择凭证模式' }]}
        >
          <Select options={credentialModeOptions} />
        </Form.Item>
        {isFixed && (
          <Form.Item
            name="credential"
            label="凭证"
            rules={[{ required: true, message: '请选择凭证' }]}
          >
            <Select
              showSearch
              placeholder="选择 jenkins_token 类型凭证"
              loading={credentialsLoading}
              options={credentialOptions}
              optionFilterProp="label"
            />
          </Form.Item>
        )}
        {isSpecifiedUser && (
          <Form.Item
            name="specified_user"
            label="指定用户"
            rules={[{ required: true, message: '请选择指定用户' }]}
          >
            <Select
              showSearch
              placeholder="选择用户"
              loading={usersLoading}
              options={userOptions}
              optionFilterProp="label"
            />
          </Form.Item>
        )}
        <Form.Item name="params_template" label="参数模板（JSON）">
          <Input.TextArea
            rows={4}
            placeholder={`{\n  "VERSION": "{version}",\n  "BRANCH": "{branch}"\n}`}
          />
        </Form.Item>
        <Form.Item name="is_active" label="是否启用" valuePropName="checked">
          <Switch checkedChildren="启用" unCheckedChildren="停用" />
        </Form.Item>
      </Form>
    </TsModal>
  );
}
