import { useEffect, useMemo } from 'react';
import { Form, Input, Select, Switch, Row, Col, Button, Segmented } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { TsModal } from '@/components/TsModal';
import { FormSection } from '@/components/FormSection';
import { jenkinsApi } from '@/api/jenkins';
import { projectApi } from '@/api/project';
import { repositoryApi } from '@/api/repository';
import { credentialApi } from '@/api/credential';
import type { JenkinsBuildPreset, JenkinsBuildType, JenkinsConfigMode, JenkinsJob } from '@/types';

interface JenkinsJobModalProps {
  open: boolean;
  job: JenkinsJob | null;
  onCancel: () => void;
  onOk: (values: Partial<JenkinsJob>) => void | Promise<void>;
}

const credentialModeOptions = [
  { label: '项目凭证', value: 'project' },
  { label: '个人凭证', value: 'personal' },
];

const buildTypeOptions = [
  { label: 'Web', value: 'web' },
  { label: 'Qt', value: 'qt' },
  { label: '自定义', value: 'custom' },
];

export function JenkinsJobModal({ open, job, onCancel, onOk }: JenkinsJobModalProps) {
  const [form] = Form.useForm();

  const { data: projectData, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects-all'],
    queryFn: () => projectApi.getProjects({ page_size: 1000 }),
    enabled: open,
  });

  const selectedProjectId = Form.useWatch('project', form) as string | undefined;
  const configMode = (Form.useWatch('config_mode', form) || 'simple') as JenkinsConfigMode;
  const buildType = (Form.useWatch('build_type', form) || 'web') as JenkinsBuildType;
  const credentialMode = (Form.useWatch('credential_mode', form) || 'project') as string;
  const selectedPresetId = Form.useWatch('build_preset', form) as string | undefined;

  const { data: repoData, isLoading: reposLoading } = useQuery({
    queryKey: ['repositories', selectedProjectId],
    queryFn: () => repositoryApi.getRepositories({ project: selectedProjectId, page_size: 1000 }),
    enabled: open && !!selectedProjectId,
  });

  // 按凭证来源拉取 jenkins_token 凭证：个人来源取自己的，项目来源取挂靠在当前项目下的
  const { data: credentialData, isLoading: credentialsLoading } = useQuery({
    queryKey: ['jenkins-credentials', credentialMode, selectedProjectId],
    queryFn: () =>
      credentialApi.getCredentials({
        page_size: 1000,
        cred_type: 'jenkins_token',
        scope: credentialMode,
        project: credentialMode === 'project' ? selectedProjectId : undefined,
      }),
    enabled:
      open &&
      !!credentialMode &&
      (credentialMode === 'personal' || !!selectedProjectId),
  });

  const { data: presetData, isLoading: presetsLoading } = useQuery({
    queryKey: ['jenkins-presets', buildType],
    queryFn: () => jenkinsApi.getPresets({ build_type: buildType, is_active: true, page_size: 1000 }),
    enabled: open && configMode === 'simple',
  });

  const projectOptions =
    projectData?.results.map((p) => ({ label: p.name, value: p.id })) || [];
  const repoOptions =
    repoData?.results.map((r) => ({ label: r.name, value: r.id })) || [];
  const credentialOptions = useMemo(
    () => credentialData?.results.map((c) => ({ label: c.name, value: c.id })) || [],
    [credentialData],
  );
  const presets = useMemo(() => presetData?.results || [], [presetData]);
  const presetOptions = useMemo(
    () => presets.map((p) => ({ label: `${p.name}（${p.image}）`, value: p.id })),
    [presets],
  );

  useEffect(() => {
    if (open) {
      if (job) {
        form.setFieldsValue({
          project: job.project_id,
          repository: job.repository_id,
          config_mode: job.config_mode || 'advanced',
          build_type: job.build_type || 'web',
          build_preset: job.build_preset_id,
          name: job.name,
          job_name: job.job_name,
          credential_mode: job.credential_mode || 'project',
          credential: job.credential_id,
          params_template: job.params_template ? JSON.stringify(job.params_template, null, 2) : '',
          build_path: job.build_path || '.',
          output_path: job.output_path || 'dist',
          auto_build_on_release: !!job.auto_build_on_release,
          is_active: job.is_active,
        });
      } else {
        form.resetFields();
        form.setFieldsValue({
          config_mode: 'simple',
          build_type: 'web',
          credential_mode: 'project',
          is_active: true,
          build_path: '.',
          output_path: 'dist',
          auto_build_on_release: false,
          params_template: JSON.stringify({ VERSION: '{version}', BRANCH: '{branch}' }, null, 2),
        });
      }
    }
  }, [open, job, form]);

  // 可选凭证变化后，若已选凭证不在新列表中则清空
  useEffect(() => {
    const currentId = form.getFieldValue('credential');
    if (currentId && !credentialOptions.some((c) => c.value === currentId)) {
      form.setFieldsValue({ credential: undefined });
    }
  }, [credentialOptions, form]);

  useEffect(() => {
    const currentPreset = presets.find((p: JenkinsBuildPreset) => p.id === selectedPresetId);
    if (configMode !== 'simple' || !currentPreset) return;
    const currentBuildPath = form.getFieldValue('build_path');
    const currentOutputPath = form.getFieldValue('output_path');
    form.setFieldsValue({
      build_path: currentBuildPath || currentPreset.default_build_path || '.',
      output_path: currentOutputPath || currentPreset.default_output_path || 'dist',
    });
  }, [configMode, selectedPresetId, presets, form]);

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
        config_mode: values.config_mode,
        build_type: values.build_type,
        build_preset: values.config_mode === 'simple' ? values.build_preset : undefined,
        name: values.name,
        job_name: values.job_name,
        credential_mode: values.credential_mode,
        credential: values.credential,
        params_template: values.config_mode === 'advanced' ? paramsTemplate : {},
        build_path: values.config_mode === 'simple' ? values.build_path : '',
        output_path: values.config_mode === 'simple' ? values.output_path : '',
        auto_build_on_release: values.config_mode === 'simple' ? !!values.auto_build_on_release : false,
        is_active: values.is_active,
      };
      onOk(payload as Partial<JenkinsJob>);
      form.resetFields();
    });
  };

  const confirmLoading = projectsLoading || reposLoading || credentialsLoading || presetsLoading;

  return (
    <TsModal
      title={job ? '编辑 Jenkins 任务' : '新增 Jenkins 任务'}
      open={open}
      onCancel={() => {
        form.resetFields();
        onCancel();
      }}
      width={720}
      footer={
        <div className="flex justify-end gap-3">
          <Button type="text" className="text-slate-500" onClick={() => {
            form.resetFields();
            onCancel();
          }}>
            取消
          </Button>
          <Button type="primary" onClick={handleOk} loading={confirmLoading}>
            确认
          </Button>
        </div>
      }
    >
      <Form form={form} layout="vertical">
        <FormSection title="基本信息">
          <Row gutter={[24, 16]}>
            <Col span={24}>
              <Form.Item
                name="config_mode"
                label="配置模式"
                rules={[{ required: true, message: '请选择配置模式' }]}
              >
                <Segmented
                  options={[
                    { label: '简单模式', value: 'simple' },
                    { label: '高级模式', value: 'advanced' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
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
            </Col>
            <Col span={12}>
              <Form.Item
                name="repository"
                label="关联仓库"
                rules={configMode === 'simple' ? [{ required: true, message: '请选择仓库' }] : []}
              >
                <Select
                  showSearch
                  allowClear
                  placeholder={configMode === 'simple' ? '选择需要打包的仓库' : '选择关联仓库（可选）'}
                  loading={reposLoading}
                  options={repoOptions}
                  optionFilterProp="label"
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="name"
                label="任务名称"
                rules={[{ required: true, message: '请输入任务名称' }]}
              >
                <Input placeholder="如：后端打包" />
              </Form.Item>
            </Col>
          </Row>
        </FormSection>

        {configMode === 'simple' && (
          <FormSection title="简单打包配置">
            <Row gutter={[24, 16]}>
              <Col span={12}>
                <Form.Item
                  name="build_type"
                  label="打包类型"
                  rules={[{ required: true, message: '请选择打包类型' }]}
                >
                  <Select
                    options={buildTypeOptions}
                    onChange={() => form.setFieldsValue({ build_preset: undefined })}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="build_preset"
                  label="镜像预设"
                  rules={[{ required: true, message: '请选择镜像预设' }]}
                >
                  <Select
                    showSearch
                    placeholder="选择系统白名单镜像"
                    loading={presetsLoading}
                    options={presetOptions}
                    optionFilterProp="label"
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="build_path"
                  label="构建目录"
                  rules={[{ required: true, message: '请输入构建目录' }]}
                >
                  <Input placeholder="如：." />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="output_path"
                  label="输出目录"
                  rules={[{ required: true, message: '请输入输出目录' }]}
                >
                  <Input placeholder="如：dist" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="auto_build_on_release" label="发布后自动打包" valuePropName="checked">
                  <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                </Form.Item>
              </Col>
            </Row>
          </FormSection>
        )}

        <FormSection title="Jenkins 任务">
          <Row gutter={[24, 16]}>
            <Col span={12}>
              <Form.Item
                name="job_name"
                label="Jenkins Job 名"
                rules={[{ required: true, message: '请输入 Jenkins Job 名' }]}
              >
                <Input placeholder="如：backend-build" />
              </Form.Item>
            </Col>
          </Row>
        </FormSection>

        <FormSection title="凭证配置">
          <Row gutter={[24, 16]}>
            <Col span={12}>
              <Form.Item
                name="credential_mode"
                label="凭证来源"
                rules={[{ required: true, message: '请选择凭证来源' }]}
              >
                <Select options={credentialModeOptions} />
              </Form.Item>
            </Col>
            <Col span={12}>
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
                    credentialMode === 'personal'
                      ? '暂无可用的个人凭证'
                      : '暂无可用的项目凭证'
                  }
                />
              </Form.Item>
            </Col>
          </Row>
        </FormSection>

        {configMode === 'advanced' && (
          <FormSection title="高级设置">
            <Row gutter={[24, 16]}>
              <Col span={24}>
                <Form.Item name="params_template" label="参数模板（JSON）">
                  <Input.TextArea
                    rows={4}
                    placeholder={`{\n  "VERSION": "{version}",\n  "BRANCH": "{branch}",\n  "TAG_NAME": "{tag_name}"\n}`}
                  />
                </Form.Item>
              </Col>
            </Row>
          </FormSection>
        )}

        <FormSection title="状态">
          <Row gutter={[24, 16]}>
            <Col span={12}>
              <Form.Item name="is_active" label="是否启用" valuePropName="checked">
                <Switch checkedChildren="启用" unCheckedChildren="停用" />
              </Form.Item>
            </Col>
          </Row>
        </FormSection>
      </Form>
    </TsModal>
  );
}
