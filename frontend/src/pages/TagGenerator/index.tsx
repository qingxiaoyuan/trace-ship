import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Steps, Form, Button, Space, message, ConfigProvider } from 'antd';
import { useQuery } from '@tanstack/react-query';
import {
  SaveOutlined,
  FileWordOutlined,
  FilePdfOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { TsCard } from '@/components/TsCard';
import { commitApi } from '@/api/commit';
import { releaseApi } from '@/api/release';
import { projectApi } from '@/api/project';
import { repositoryApi } from '@/api/repository';
import { useAuthStore } from '@/stores/authStore';
import type { Repository } from '@/types';
import { blueColors } from './constants';
import type { RelatedChangeItem, UpdateItem } from './types';
import { Step1Branch } from './components/Step1Branch';
import { Step2Diff } from './components/Step2Diff';
import { Step3Doc } from './components/Step3Doc';

export default function TagGenerator() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedCommits, setSelectedCommits] = useState<string[]>([]);
  const [form] = Form.useForm();
  const [relatedChanges, setRelatedChanges] = useState<RelatedChangeItem[]>([]);
  const [updates, setUpdates] = useState<UpdateItem[]>([]);
  const currentUser = useAuthStore((s) => s.user);

  // 表单受控字段，便于在分支/仓库/类型变化时联动
  const repositoryId = Form.useWatch('repository', form);
  const sourceBranch = Form.useWatch('source_branch', form);
  const releaseType = Form.useWatch('release_type', form);
  const version = Form.useWatch('version', form);
  const gitHash = Form.useWatch('git_hash', form);

  const { data: projectData } = useQuery({
    queryKey: ['tagger-projects'],
    queryFn: () => projectApi.getProjects({ page_size: 1000 }),
  });

  // 仓库列表（按所选项目过滤）
  const projectId = Form.useWatch('project', form);
  const { data: repoData } = useQuery({
    queryKey: ['tagger-repositories', projectId],
    queryFn: () => repositoryApi.getRepositories({ project: projectId, page_size: 1000 }),
    enabled: !!projectId,
  });

  // 分支列表（按所选仓库）
  const { data: branchesData } = useQuery({
    queryKey: ['tagger-branches', repositoryId],
    queryFn: () => repositoryApi.getBranches(repositoryId),
    enabled: !!repositoryId,
  });

  // 自动算版本号
  const { data: nextVersionData } = useQuery({
    queryKey: ['tagger-next-version', repositoryId, releaseType],
    queryFn: () => repositoryApi.getNextVersion(repositoryId, releaseType || 'formal'),
    enabled: !!repositoryId && !!releaseType,
  });

  const { data: commitData, isLoading: commitsLoading } = useQuery({
    queryKey: ['tagger-commits'],
    queryFn: () => commitApi.getCommits({ page_size: 1000 }),
  });

  const commits = commitData?.results || [];
  const projectOptions = (projectData?.results || []).map((p) => ({ label: p.name, value: p.id }));
  const repositoryOptions = (repoData?.results || []).map((r: Repository) => ({ label: r.name, value: r.id }));
  const branchOptions = (branchesData || []).map((b) => ({ label: b.name, value: b.name }));
  const tagOptions = useMemo(() => {
    if (!nextVersionData) return [] as { label: string; value: string }[];
    const items: { label: string; value: string }[] = [];
    if (nextVersionData.latest_tag) {
      items.push({ label: nextVersionData.latest_tag, value: nextVersionData.latest_tag });
    }
    if (nextVersionData.next_tag_name) {
      items.push({ label: `${nextVersionData.next_tag_name}（建议）`, value: nextVersionData.next_tag_name });
    }
    return items;
  }, [nextVersionData]);

  // 初次加载：填充项目、发布人、变更类型等与仓库无关的默认字段
  useEffect(() => {
    form.setFieldsValue({
      project: projectData?.results?.[0]?.id,
      release_type: 'formal',
      change_type: 'none',
      config_changes: '',
      test_status: ['self_test'],
      publisher: currentUser?.nickname || currentUser?.username || '',
      impact_other: false,
    });
  }, [form, projectData, currentUser]);

  // 选择仓库后，联动分支、起始 tag、版本号、git_hash
  useEffect(() => {
    if (!repositoryId || !branchesData || !nextVersionData) return;
    const defaultBranch = branchesData.find((b) => b.is_default)?.name || branchesData[0]?.name;
    const values: Record<string, unknown> = {
      source_branch: defaultBranch,
      start_tag: nextVersionData.latest_tag || '',
      version: nextVersionData.next_version || '',
      tag_name: nextVersionData.next_tag_name || '',
    };
    // 起始分支的最近提交作为 git_hash
    const branchInfo = branchesData.find((b) => b.name === defaultBranch);
    if (branchInfo?.last_commit_hash) {
      values.git_hash = branchInfo.last_commit_hash;
    }
    form.setFieldsValue(values);
  }, [repositoryId, branchesData, nextVersionData, form]);

  // 切换来源分支时，更新 git_hash
  useEffect(() => {
    if (!sourceBranch || !branchesData) return;
    const branchInfo = branchesData.find((b) => b.name === sourceBranch);
    if (branchInfo?.last_commit_hash) {
      form.setFieldValue('git_hash', branchInfo.last_commit_hash);
    }
  }, [sourceBranch, branchesData, form]);

  // 切换发布类型时，重新拉取 nextVersion
  // （已在 useQuery 的 queryKey 中依赖 releaseType，自动重拉）

  const toggleCommit = (id: string) => {
    setSelectedCommits((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    setSelectedCommits((prev) =>
      prev.length === commits.length ? [] : commits.map((c) => c.id)
    );
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const release = await releaseApi.createRelease({
        project: values.project,
        repository: values.repository,
        release_type: values.release_type,
        source_branch: values.source_branch,
        target_branch: values.source_branch,
        version: values.version,
        tag_name: values.tag_name,
        git_hash: values.git_hash,
        related_changes: relatedChanges.filter((r) => r.softwareName || r.version),
        updates: updates.filter((u) => u.content),
      } as never);
      // submit_audit 要求 release_doc 非空，先调 generate-doc 写一份初稿
      await releaseApi.generateDoc(release.id);
      await releaseApi.submitAudit(release.id);
      message.success('提交审批成功');
      navigate('/workflows');
    } catch (error) {
      console.error(error);
    }
  };

  const handleAddUpdate = () => {
    setUpdates((prev) => [
      ...prev,
      { id: `${Date.now()}`, type: 'A', content: '' },
    ]);
  };

  const handleUpdateChange = (id: string, key: 'type' | 'content', value: string) => {
    setUpdates((prev) => prev.map((u) => (u.id === id ? { ...u, [key]: value } : u)));
  };

  const handleRemoveUpdate = (id: string) => {
    setUpdates((prev) => prev.filter((u) => u.id !== id));
  };

  const handleRelatedChange = (id: string, key: keyof RelatedChangeItem, value: string) => {
    setRelatedChanges((prev) => prev.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
  };

  const stepContent = [
    <Step1Branch
      key="step1"
      form={form}
      projectOptions={projectOptions}
      repositoryOptions={repositoryOptions}
      branchOptions={branchOptions}
      tagOptions={tagOptions}
    />,
    <Step2Diff
      key="step2"
      commits={commits}
      commitsLoading={commitsLoading}
      selectedCommits={selectedCommits}
      toggleCommit={toggleCommit}
      toggleAll={toggleAll}
    />,
    <Step3Doc
      key="step3"
      form={form}
      version={version}
      gitHash={gitHash}
      updates={updates}
      relatedChanges={relatedChanges}
      onAddUpdate={handleAddUpdate}
      onUpdateChange={handleUpdateChange}
      onRemoveUpdate={handleRemoveUpdate}
      onRelatedChange={handleRelatedChange}
    />,
  ];

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: blueColors.charcoal,
          colorInfo: blueColors.charcoal,
        },
      }}
    >
      <div className="space-y-6" style={{ fontFamily: '"PingFang SC", "Helvetica Neue", Arial, sans-serif' }}>
      <TsCard
        bodyStyle={{ padding: 28 }}
        style={{ borderColor: blueColors.border, borderRadius: 12 }}
      >
        <Steps
          current={currentStep}
          labelPlacement="vertical"
          items={[
            { title: '选择项目与分支', description: '确认发布来源' },
            { title: '提取并编辑差异', description: '筛选并合并 commit' },
            { title: '生成发布说明', description: '编辑发布文档' },
          ]}
        />
      </TsCard>

      {/* 所有 Step 常驻渲染,通过 display 控制可见性,避免 Form.Item 卸载导致字段丢失 */}
      <div className="min-h-100">
        {stepContent.map((node, i) => (
          <div
            key={i}
            style={{ display: i === currentStep ? 'block' : 'none' }}
            className={i === currentStep ? 'animate-ts-fade-in-up' : undefined}
          >
            {node}
          </div>
        ))}
      </div>

      <div
        className="flex justify-between items-center pt-4"
        style={{ borderTop: `1px solid ${blueColors.border}` }}
      >
        <Button
          disabled={currentStep === 0}
          onClick={() => setCurrentStep((s) => s - 1)}
          icon={<ArrowLeftOutlined />}
          style={{ borderRadius: 6, borderColor: blueColors.border }}
        >
          上一步
        </Button>
        <Space>
          {currentStep === 2 && (
            <>
              <Button icon={<SaveOutlined />} style={{ borderRadius: 6, borderColor: blueColors.border }}>
                保存草稿
              </Button>
              <Button icon={<FileWordOutlined />} style={{ borderRadius: 6, borderColor: blueColors.border }}>
                导出 Word
              </Button>
              <Button icon={<FilePdfOutlined />} style={{ borderRadius: 6, borderColor: blueColors.border }}>
                导出 PDF
              </Button>
            </>
          )}
          <Button
            type="primary"
            icon={currentStep === 2 ? <SendOutlined /> : <ArrowRightOutlined />}
            onClick={() => {
              if (currentStep === 2) {
                handleSubmit();
              } else {
                setCurrentStep((s) => s + 1);
              }
            }}
            style={{
              borderRadius: 6,
              background: blueColors.charcoal,
              borderColor: blueColors.charcoal,
              boxShadow: 'none',
            }}
          >
            {currentStep === 2 ? '提交审批' : '下一步'}
          </Button>
        </Space>
      </div>
    </div>
  </ConfigProvider>
  );
}
