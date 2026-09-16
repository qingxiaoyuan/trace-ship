import { useEffect, useMemo, useState } from 'react';
import { Modal, Steps, Form, Select, Button, Card, App, Radio, Input, Alert, Space } from 'antd';
import { useWatch } from 'antd/es/form/Form';
import { useQuery, useMutation } from '@tanstack/react-query';
import { repositoryApi } from '@/api/repository';
import { releaseApi } from '@/api/release';
import type { Release, Repository, ReleaseType } from '@/types';

interface ReleaseDoc {
  change_type?: string;
  updates?: { type?: string; content?: string }[];
  config_changes?: Record<string, Record<string, string>>;
  related_changes?: Record<string, string>;
  publisher?: string;
}

interface CreateTagModalProps {
  open: boolean;
  projectId: string;
  repository: Repository;
  onCancel: () => void;
  onSuccess: () => void;
}

const releaseTypeOptions = [
  { label: '正式版本', value: 'formal' },
  { label: 'RC 版本', value: 'rc' },
  { label: 'Beta 版本', value: 'beta' },
];

export function CreateTagModal({ open, projectId, repository, onCancel, onSuccess }: CreateTagModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [currentStep, setCurrentStep] = useState(0);
  const [createdRelease, setCreatedRelease] = useState<Release | null>(null);
  const [releaseDoc, setReleaseDoc] = useState<ReleaseDoc | null>(null);
  const releaseType = useWatch('release_type', form) || 'formal';

  const { data: branches, isLoading: branchesLoading } = useQuery({
    queryKey: ['repository-branches', repository.id],
    queryFn: () => repositoryApi.getBranches(repository.id),
    enabled: open && !!repository.id,
  });

  const {
    data: nextVersion,
    isLoading: nextVersionLoading,
    refetch: refetchNextVersion,
  } = useQuery({
    queryKey: ['repository-next-version', repository.id, releaseType],
    queryFn: () => repositoryApi.getNextVersion(repository.id, releaseType),
    enabled: open && !!repository.id,
  });

  const branchOptions = useMemo(
    () => (branches || []).map((b) => ({ label: b.name, value: b.name })),
    [branches]
  );

  // 弹窗打开时初始化表单默认值（依赖 destroyOnHidden 重置组件状态）
  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        release_type: 'formal',
        branch: repository.default_branch,
      });
    }
  }, [open, repository.id, repository.default_branch, form]);

  // releaseType 变化时重新拉取建议版本号
  useEffect(() => {
    if (open) {
      refetchNextVersion();
    }
  }, [releaseType, open, refetchNextVersion]);

  // 版本号建议变化时自动填充
  useEffect(() => {
    if (nextVersion) {
      form.setFieldsValue({
        version: nextVersion.next_version,
        tag_name: nextVersion.next_tag_name,
      });
    }
  }, [nextVersion, form]);

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      releaseApi.createRelease({
        project: projectId,
        repository: repository.id,
        release_type: values.release_type as ReleaseType,
        branch: values.branch as string,
        version: values.version as string,
        tag_name: values.tag_name as string,
        redmine_url: (values.redmine_url as string)?.trim() || undefined,
      }),
    onSuccess: (release) => {
      setCreatedRelease(release);
      message.success('发布草稿创建成功');
      setCurrentStep(1);
      generateDocMutation.mutate(release.id);
    },
  });

  const generateDocMutation = useMutation({
    mutationFn: (id: string) => releaseApi.generateDoc(id),
    onSuccess: (doc) => setReleaseDoc(doc as ReleaseDoc),
  });

  const submitMutation = useMutation({
    mutationFn: (id: string) => releaseApi.submitAudit(id),
    onSuccess: () => {
      message.success('提交审批成功');
      setCurrentStep(2);
      onSuccess();
    },
  });

  const handleReleaseTypeChange = (value: ReleaseType) => {
    form.setFieldsValue({ release_type: value });
  };

  const handleCreate = (values: Record<string, unknown>) => {
    createMutation.mutate(values);
  };

  const handleSubmitAudit = () => {
    if (createdRelease?.id) {
      submitMutation.mutate(createdRelease.id);
    }
  };

  const handleCancel = () => {
    if (submitMutation.isSuccess) {
      onCancel();
      return;
    }
    Modal.confirm({
      title: '确认取消',
      content: '取消后当前填写的信息将不会保存，是否确认取消？',
      onOk: onCancel,
    });
  };

  const steps = [
    { title: '填写发布信息', key: 'basic' },
    { title: '预览发布说明', key: 'doc' },
    { title: '提交审批', key: 'submit' },
  ];

  return (
    <Modal
      open={open}
      title={`新建 Tag - ${repository.name}`}
      width={720}
      onCancel={handleCancel}
      footer={null}
      destroyOnHidden
    >
      <Steps current={currentStep} items={steps} className="mb-6" />

      {currentStep === 0 && (
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          {nextVersion && !nextVersion.has_existing_tags && (
            <Alert
              message="当前仓库暂无匹配 Tag，将使用仓库初始版本号"
              type="info"
              showIcon
              className="mb-4"
            />
          )}

          <Form.Item label="产品">
            <Input value={repository.project_name || repository.project_id} disabled />
          </Form.Item>

          <Form.Item label="仓库">
            <Input value={repository.name} disabled />
          </Form.Item>

          <Form.Item
            name="release_type"
            label="发布类型"
            rules={[{ required: true, message: '请选择发布类型' }]}
            initialValue="formal"
          >
            <Radio.Group options={releaseTypeOptions} onChange={(e) => handleReleaseTypeChange(e.target.value)} />
          </Form.Item>

          <Form.Item
            name="branch"
            label="分支"
            rules={[{ required: true, message: '请选择分支' }]}
          >
            <Select
              showSearch
              placeholder="选择分支"
              loading={branchesLoading}
              options={branchOptions}
              optionFilterProp="label"
              allowClear
            />
          </Form.Item>

          <Form.Item
            name="version"
            label="版本号"
            rules={[{ required: true, message: '请输入版本号' }]}
          >
            <Input
              placeholder="例如 1.0.0"
              style={{ fontFamily: 'monospace' }}
              disabled={nextVersionLoading}
            />
          </Form.Item>

          <Form.Item
            name="tag_name"
            label="Tag 名称"
            rules={[{ required: true, message: '请输入 Tag 名称' }]}
          >
            <Input
              placeholder="例如 v1.0.0"
              style={{ fontFamily: 'monospace' }}
              disabled={nextVersionLoading}
            />
          </Form.Item>

          <Form.Item
            name="redmine_url"
            label="Redmine 任务地址（可选）"
            rules={[
              {
                type: 'url',
                message: '请输入完整 URL，例如 https://redmine.example.com/issues/12345',
              },
            ]}
            extra="发布后可在版本详情中直接打开关联任务"
          >
            <Input
              type="url"
              placeholder="https://redmine.example.com/issues/12345"
            />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={createMutation.isPending || nextVersionLoading}>
                创建草稿并生成发布说明
              </Button>
              <Button onClick={handleCancel}>取消</Button>
            </Space>
          </Form.Item>
        </Form>
      )}

      {currentStep >= 1 && createdRelease && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
            <Card size="small" title="版本信息">
              <p>版本号：{createdRelease.version || '-'}</p>
              <p>Tag：{createdRelease.tag_name || '-'}</p>
              <p>发布类型：{releaseTypeOptions.find((o) => o.value === createdRelease.release_type)?.label || createdRelease.release_type}</p>
              <p>分支：{createdRelease.branch}</p>
              <p>Git Hash：{createdRelease.git_hash}</p>
              {createdRelease.redmine_url ? (
                <p>
                  Redmine：{' '}
                  <a
                    href={createdRelease.redmine_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    打开关联任务
                  </a>
                </p>
              ) : null}
            </Card>
            <Card size="small" title="发布说明">
              {generateDocMutation.isPending && <p>生成中...</p>}
              {releaseDoc && (
                <div className="space-y-2">
                  <p>变更类型：{releaseDoc.change_type || '-'}</p>
                  <div>
                    <p className="font-medium">更新内容：</p>
                    <ul className="list-disc pl-5">
                      {(releaseDoc.updates || []).map((u, idx) => (
                        <li key={idx}>[{u.type || '-'}] {u.content || '-'}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </Card>
          </div>

          <div className="flex gap-3">
            <Button
              type="primary"
              loading={submitMutation.isPending}
              onClick={handleSubmitAudit}
              disabled={currentStep === 2}
            >
              提交审批
            </Button>
            {currentStep === 2 && (
              <Button onClick={onCancel}>关闭</Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
