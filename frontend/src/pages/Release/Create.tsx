import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Steps, Form, Select, Button, Card, App, Radio } from 'antd';
import { useQuery, useMutation } from '@tanstack/react-query';
import { projectApi } from '@/api/project';
import { repositoryApi } from '@/api/repository';
import { releaseApi } from '@/api/release';
import type { Release, Repository } from '@/types';

interface ReleaseDoc {
  change_type?: string;
  updates?: { type?: string; content?: string }[];
  config_changes?: Record<string, Record<string, string>>;
  related_changes?: Record<string, string>;
  publisher?: string;
}

export default function ReleaseCreate() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectIdFromQuery = searchParams.get('project_id') || undefined;
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [currentStep, setCurrentStep] = useState(0);
  const [createdRelease, setCreatedRelease] = useState<Release | null>(null);
  const [releaseDoc, setReleaseDoc] = useState<ReleaseDoc | null>(null);

  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(projectIdFromQuery);
  const [selectedRepoId, setSelectedRepoId] = useState<string | undefined>();

  const { data: projectData, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects-all'],
    queryFn: () => projectApi.getProjects({ page_size: 1000 }),
    enabled: !projectIdFromQuery,
  });

  const { data: repoData, isLoading: reposLoading } = useQuery({
    queryKey: ['repositories', selectedProjectId],
    queryFn: () => repositoryApi.getRepositories({ project: selectedProjectId, page_size: 1000 }),
    enabled: !!selectedProjectId,
  });

  const { data: branches, isLoading: branchesLoading } = useQuery({
    queryKey: ['repository-branches', selectedRepoId],
    queryFn: () => repositoryApi.getBranches(selectedRepoId || ''),
    enabled: !!selectedRepoId,
  });

  const projectOptions = useMemo(
    () => (projectData?.results || []).map((p) => ({ label: p.name, value: p.id })),
    [projectData]
  );
  const repoOptions = useMemo(
    () => (repoData?.results || []).map((r: Repository) => ({ label: r.name, value: r.id })),
    [repoData]
  );
  const branchOptions = useMemo(
    () => (branches || []).map((b) => ({ label: b.name, value: b.name })),
    [branches]
  );

  useEffect(() => {
    if (projectIdFromQuery) {
      form.setFieldsValue({ project: projectIdFromQuery });
    }
  }, [projectIdFromQuery, form]);

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      releaseApi.createRelease({
        project: values.project as string,
        repository: values.repository as string,
        release_type: values.release_type as 'formal' | 'test',
        source_branch: values.source_branch as string,
        target_branch: values.target_branch as string,
      }),
    onSuccess: (release) => {
      setCreatedRelease(release);
      message.success('发布草稿创建成功');
      setCurrentStep(1);
      generateDocMutation.mutate(release.id);
    },
    onError: (err: { message?: string }) => message.error(err?.message || '创建发布失败'),
  });

  const generateDocMutation = useMutation({
    mutationFn: (id: string) => releaseApi.generateDoc(id),
    onSuccess: (doc) => setReleaseDoc(doc as ReleaseDoc),
    onError: () => message.error('生成发布说明失败'),
  });

  const submitMutation = useMutation({
    mutationFn: (id: string) => releaseApi.submitAudit(id),
    onSuccess: () => {
      message.success('提交审批成功');
      setCurrentStep(2);
    },
    onError: (err: { message?: string }) => message.error(err?.message || '提交审批失败'),
  });

  const handleProjectChange = (value: string) => {
    setSelectedProjectId(value);
    form.setFieldsValue({ repository: undefined, source_branch: undefined, target_branch: undefined });
    setSelectedRepoId(undefined);
  };

  const handleRepoChange = (value: string) => {
    setSelectedRepoId(value);
    form.setFieldsValue({ source_branch: undefined, target_branch: undefined });
  };

  const handleCreate = (values: Record<string, unknown>) => {
    createMutation.mutate(values);
  };

  const handleSubmitAudit = () => {
    if (createdRelease?.id) {
      submitMutation.mutate(createdRelease.id);
    }
  };

  const steps = [
    { title: '填写发布信息', key: 'basic' },
    { title: '预览发布说明', key: 'doc' },
    { title: '提交审批', key: 'submit' },
  ];

  return (
    <div className="space-y-4">
      <Card title="新建发布">
        <Steps current={currentStep} items={steps} className="mb-8" />

        {currentStep === 0 && (
          <Form form={form} layout="vertical" onFinish={handleCreate}>
            <Form.Item
              name="project"
              label="项目"
              rules={[{ required: true, message: '请选择项目' }]}
            >
              <Select
                showSearch
                placeholder="选择项目"
                loading={projectsLoading}
                options={projectOptions}
                optionFilterProp="label"
                onChange={handleProjectChange}
                disabled={!!projectIdFromQuery}
              />
            </Form.Item>

            <Form.Item
              name="repository"
              label="仓库"
              rules={[{ required: true, message: '请选择仓库' }]}
            >
              <Select
                showSearch
                placeholder="选择仓库"
                loading={reposLoading}
                options={repoOptions}
                optionFilterProp="label"
                onChange={handleRepoChange}
              />
            </Form.Item>

            <Form.Item
              name="release_type"
              label="发布类型"
              rules={[{ required: true, message: '请选择发布类型' }]}
              initialValue="formal"
            >
              <Radio.Group>
                <Radio value="formal">正式版本</Radio>
                <Radio value="test">测试版本</Radio>
              </Radio.Group>
            </Form.Item>

            <Form.Item
              name="source_branch"
              label="来源分支"
              rules={[{ required: true, message: '请输入来源分支' }]}
            >
              <Select
                showSearch
                placeholder="选择来源分支"
                loading={branchesLoading}
                options={branchOptions}
                optionFilterProp="label"
                allowClear
              />
            </Form.Item>

            <Form.Item
              name="target_branch"
              label="目标分支"
              rules={[{ required: true, message: '请输入目标分支' }]}
            >
              <Select
                showSearch
                placeholder="选择目标分支"
                loading={branchesLoading}
                options={branchOptions}
                optionFilterProp="label"
                allowClear
              />
            </Form.Item>

            <Form.Item>
              <Button type="primary" htmlType="submit" loading={createMutation.isPending}>
                创建草稿并生成发布说明
              </Button>
            </Form.Item>
          </Form>
        )}

        {currentStep >= 1 && createdRelease && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Card size="small" title="版本信息">
                <p>版本号：{createdRelease.version || '-'}</p>
                <p>Tag：{createdRelease.tag_name || '-'}</p>
                <p>目标分支：{createdRelease.target_branch}</p>
                <p>Git Hash：{createdRelease.git_hash}</p>
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
              <Button onClick={() => navigate('/releases')}>返回发布看板</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
