import { useEffect, useMemo } from 'react';
import { Form, Input, Select, Switch, Button } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { TsModal } from '@/components/TsModal';
import { repositoryApi } from '@/api/repository';
import { credentialApi } from '@/api/credential';
import type { JenkinsJob, Repository } from '@/types';

interface JenkinsJobModalProps {
  open: boolean;
  job: JenkinsJob | null;
  projectId: string;
  onCancel: () => void;
  onOk: (values: Partial<JenkinsJob>) => void | Promise<void>;
}

const credentialModeOptions = [
  { label: '项目凭证', value: 'project' },
  { label: '个人凭证', value: 'personal' },
];

export function JenkinsJobModal({ open, job, projectId, onCancel, onOk }: JenkinsJobModalProps) {
  const [form] = Form.useForm();

  const { data: repoData, isLoading: reposLoading } = useQuery({
    queryKey: ['repositories', projectId],
    queryFn: () => repositoryApi.getRepositories({ project: projectId, page_size: 1000 }),
    enabled: open && !!projectId,
  });

  const credentialMode = (Form.useWatch('credential_mode', form) || 'project') as string;

  // 按凭证来源拉取 jenkins_token 凭证：个人来源取自己的，项目来源取挂靠在当前项目下的
  const { data: credentialData, isLoading: credentialsLoading } = useQuery({
    queryKey: ['jenkins-credentials', credentialMode, projectId],
    queryFn: () =>
      credentialApi.getCredentials({
        page_size: 1000,
        cred_type: 'jenkins_token',
        scope: credentialMode,
        project: credentialMode === 'project' ? projectId : undefined,
      }),
    enabled: open && !!projectId && !!credentialMode,
  });

  const repoOptions =
    repoData?.results.map((r: Repository) => ({ label: r.name, value: r.id })) || [];
  const credentialOptions = useMemo(
    () => credentialData?.results.map((c) => ({ label: c.name, value: c.id })) || [],
    [credentialData],
  );

  useEffect(() => {
    if (open) {
      if (job) {
        form.setFieldsValue({
          project: job.project_id,
          repository: job.repository_id,
          name: job.name,
          server_url: job.server_url,
          job_name: job.job_name,
          credential_mode: job.credential_mode || 'project',
          credential: job.credential_id,
          params_template: job.params_template ? JSON.stringify(job.params_template, null, 2) : '',
          is_active: job.is_active,
        });
      } else {
        form.resetFields();
        form.setFieldsValue({
          project: projectId,
          credential_mode: 'project',
          is_active: true,
          params_template: JSON.stringify({ VERSION: '{version}', BRANCH: '{branch}' }, null, 2),
        });
      }
    }
  }, [open, job, projectId, form]);

  // 可选凭证变化后，若已选凭证不在新列表中则清空
  useEffect(() => {
    const currentId = form.getFieldValue('credential');
    if (currentId && !credentialOptions.some((c) => c.value === currentId)) {
      form.setFieldsValue({ credential: undefined });
    }
  }, [credentialOptions, form]);

  const handleCancel = () => {
    form.resetFields();
    onCancel();
  };

  const handleOk = () => {
    form.validateFields().then((values) => {
      let paramsTemplate: unknown = {};
      if (values.params_template) {
        try {
          paramsTemplate = JSON.parse(values.params_template);
        } catch {
          // 允许非 JSON 字符串作为模板
          paramsTemplate = values.params_template;
        }
      }
      const payload: Partial<JenkinsJob> & Record<string, unknown> = {
        project: projectId,
        repository: values.repository,
        name: values.name,
        server_url: values.server_url,
        job_name: values.job_name,
        credential_mode: values.credential_mode,
        credential: values.credential,
        params_template: paramsTemplate,
        is_active: values.is_active,
      };
      onOk(payload as Partial<JenkinsJob>);
      form.resetFields();
    });
  };

  return (
    <TsModal
      title={job ? '编辑 Jenkins 任务' : '新增 Jenkins 任务'}
      open={open}
      onCancel={handleCancel}
      footerStyle={{ background: 'transparent' }}
      footer={
        <div className="flex items-center justify-end gap-3">
          <Button
            type="text"
            className="h-auto rounded-lg px-4 py-2 text-[13px] font-medium text-slate-700 transition hover:text-indigo-600"
            onClick={handleCancel}
          >
            取消
          </Button>
          <Button
            type="primary"
            className="btn-glow inline-flex h-auto items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium text-white"
            onClick={handleOk}
            loading={reposLoading || credentialsLoading}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2} />
            确认
          </Button>
        </div>
      }
    >
      <Form form={form} layout="vertical">
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
          label="凭证来源"
          rules={[{ required: true, message: '请选择凭证来源' }]}
        >
          <Select options={credentialModeOptions} />
        </Form.Item>
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
            notFoundContent={
              credentialMode === 'personal' ? '暂无可用的个人凭证' : '暂无可用的项目凭证'
            }
          />
        </Form.Item>
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
