import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Steps,
  Form,
  Select,
  Radio,
  Button,
  Table,
  Checkbox,
  Tag,
  Input,
  List,
  Row,
  Col,
  Space,
  Typography,
  Divider,
  Tooltip,
  message,
  ConfigProvider,
} from 'antd';
import type { FormInstance } from 'antd';
import { useQuery } from '@tanstack/react-query';
import {
  SaveOutlined,
  FileWordOutlined,
  FilePdfOutlined,
  EyeOutlined,
  MergeCellsOutlined,
  DeleteOutlined,
  PlusOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { commitApi } from '@/api/commit';
import { releaseApi } from '@/api/release';
import { projectApi } from '@/api/project';
import { repositoryApi } from '@/api/repository';
import { useAuthStore } from '@/stores/authStore';
import type { CommitRecord, Repository } from '@/types';

interface RelatedChangeItem {
  id: string;
  softwareName: string;
  version: string;
}

const { TextArea } = Input;
const { Text, Title } = Typography;

const blueColors = {
  canvas: '#FFFFFF',
  bone: '#F0F9FF',
  border: '#DBEAFE',
  charcoal: '#1D4ED8',
  muted: '#64748B',
  paleRed: { bg: '#FEF2F2', text: '#DC2626' },
  paleBlue: { bg: '#DBEAFE', text: '#2563EB' },
  paleGreen: { bg: '#ECFDF5', text: '#059669' },
  paleYellow: { bg: '#FFFBEB', text: '#D97706' },
};

export default function TagGenerator() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedCommits, setSelectedCommits] = useState<string[]>([]);
  const [form] = Form.useForm();
  const [relatedChanges, setRelatedChanges] = useState<RelatedChangeItem[]>([]);
  const [updates, setUpdates] = useState<{ id: string; type: string; content: string }[]>([]);
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

function Step1Branch({
  form,
  projectOptions,
  repositoryOptions,
  branchOptions,
  tagOptions,
}: {
  form: FormInstance;
  projectOptions: { label: string; value: string }[];
  repositoryOptions: { label: string; value: string }[];
  branchOptions: { label: string; value: string }[];
  tagOptions: { label: string; value: string }[];
}) {
  return (
    <TsCard
      title={
        <div className="flex items-center justify-between">
          <span style={{ fontWeight: 600, fontSize: 16, color: blueColors.charcoal }}>
            步骤 1：选择项目与分支
          </span>
          <Text type="secondary" style={{ fontSize: 13, color: blueColors.muted }}>
            请确认发布来源
          </Text>
        </div>
      }
      style={{ borderColor: blueColors.border, borderRadius: 12 }}
    >
      <Form form={form} layout="vertical" className="max-w-3xl">
        <Row gutter={[24, 0]}>
          <Col xs={24} md={12}>
            <Form.Item name="project" label="项目" rules={[{ required: true }]}>
              <Select options={projectOptions} placeholder="选择项目" size="large" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="repository" label="仓库" rules={[{ required: true }]}>
              <Select
                options={repositoryOptions}
                placeholder="选择仓库"
                size="large"
                loading={repositoryOptions.length === 0}
                disabled={!projectOptions.find((p) => p.value === form.getFieldValue('project'))}
                notFoundContent={repositoryOptions.length === 0 ? '请先选择项目' : undefined}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="source_branch" label="来源分支" rules={[{ required: true }]}>
              <Select
                options={branchOptions}
                placeholder="选择来源分支"
                size="large"
                loading={branchOptions.length === 0}
                disabled={!form.getFieldValue('repository')}
                notFoundContent={branchOptions.length === 0 ? '请先选择仓库' : undefined}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="start_tag" label="起始 Tag">
              <Select
                options={tagOptions}
                placeholder="选择起始 Tag"
                size="large"
                allowClear
                disabled={!form.getFieldValue('repository')}
                notFoundContent={tagOptions.length === 0 ? '尚未发布过任何版本' : undefined}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="release_type" label="发布类型" rules={[{ required: true }]}>
              <Radio.Group size="large">
                <Radio value="formal">正式版本</Radio>
                <Radio value="rc">RC 版本</Radio>
                <Radio value="beta">Beta 版本</Radio>
              </Radio.Group>
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </TsCard>
  );
}

function Step2Diff({
  commits,
  commitsLoading,
  selectedCommits,
  toggleCommit,
  toggleAll,
}: {
  commits: CommitRecord[];
  commitsLoading: boolean;
  selectedCommits: string[];
  toggleCommit: (id: string) => void;
  toggleAll: () => void;
}) {
  const allSelected = selectedCommits.length === commits.length && commits.length > 0;
  const indeterminate = selectedCommits.length > 0 && selectedCommits.length < commits.length;

  const stats = useMemo(() => {
    const aCount = commits.filter((c) => c.change_type === 'A类').length;
    const fCount = commits.filter((c) => c.change_type === 'F类').length;
    const configCount = commits.filter(
      (c) => c.message.includes('[System]') || c.message.includes('config')
    ).length;
    const illegalCount = commits.filter((c) => c.review_status === 'illegal').length;
    return [
      { label: '总 commit 数', value: commits.length, accent: blueColors.paleBlue },
      { label: 'A 类更新', value: aCount, accent: blueColors.paleGreen },
      { label: 'F 类更新', value: fCount, accent: blueColors.paleYellow },
      { label: '配置项改动', value: configCount, accent: blueColors.paleBlue },
      { label: '不合规提交', value: illegalCount, accent: blueColors.paleRed },
    ];
  }, [commits]);

  const columns = [
    {
      title: (
        <Checkbox
          checked={allSelected}
          indeterminate={indeterminate}
          onChange={toggleAll}
        />
      ),
      width: 56,
      render: (_: unknown, record: CommitRecord) => (
        <Checkbox
          checked={selectedCommits.includes(record.id)}
          onChange={() => toggleCommit(record.id)}
        />
      ),
    },
    {
      title: 'Commit',
      dataIndex: 'commit_hash',
      width: 120,
      render: (hash: string) => (
        <Text
          style={{
            fontFamily: '"SF Mono", "JetBrains Mono", monospace',
            fontSize: 12,
            color: blueColors.charcoal,
          }}
        >
          {hash.slice(0, 12)}
        </Text>
      ),
    },
    { title: '作者', dataIndex: 'author', width: 90 },
    {
      title: '消息摘要',
      dataIndex: 'message',
      ellipsis: true,
      render: (text: string) => text?.split('\n')[0],
    },
    {
      title: '变更类型',
      dataIndex: 'change_type',
      width: 100,
      render: (type: string) => {
        if (type === 'A类') {
          return <Tag style={{ background: blueColors.paleBlue.bg, color: blueColors.paleBlue.text, border: 'none', borderRadius: 9999, fontWeight: 600 }}>A类</Tag>;
        }
        if (type === 'F类') {
          return <Tag style={{ background: blueColors.paleYellow.bg, color: blueColors.paleYellow.text, border: 'none', borderRadius: 9999, fontWeight: 600 }}>F类</Tag>;
        }
        return <Tag style={{ background: blueColors.bone, color: blueColors.muted, border: 'none', borderRadius: 9999 }}>-</Tag>;
      },
    },
    {
      title: '合规状态',
      dataIndex: 'review_status',
      width: 100,
      render: (status: string) => (
        <StatusTag status={status === 'pass' ? 'success' : status === 'warning' ? 'warning' : 'danger'}>
          {status === 'pass' ? '合规' : status === 'warning' ? '警告' : '不合规'}
        </StatusTag>
      ),
    },
    {
      title: '操作',
      width: 70,
      render: () => (
        <Space size="small">
          <Tooltip title="详情">
            <Button type="text" size="small" icon={<EyeOutlined />} style={{ color: blueColors.muted }} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <Row gutter={[24, 24]}>
      <Col xs={24} lg={16}>
        <TsCard
          title={
            <div className="flex items-center justify-between">
              <span style={{ fontWeight: 600, fontSize: 16, color: blueColors.charcoal }}>
                步骤 2：提取并编辑 commit 差异
              </span>
              <Text type="secondary" style={{ fontSize: 13, color: blueColors.muted }}>
                已选 {selectedCommits.length} / {commits.length} 条
              </Text>
            </div>
          }
          extra={
            <Space>
              <Button icon={<MergeCellsOutlined />} disabled={selectedCommits.length === 0} style={{ borderRadius: 6, borderColor: blueColors.border }}>
                合并选中
              </Button>
              <Button icon={<DeleteOutlined />} disabled={selectedCommits.length === 0} style={{ borderRadius: 6, borderColor: blueColors.border }}>
                排除选中
              </Button>
            </Space>
          }
          style={{ borderColor: blueColors.border, borderRadius: 12 }}
        >
          <Table
            rowKey="id"
            columns={columns}
            dataSource={commits}
            loading={commitsLoading}
            pagination={false}
            size="middle"
            style={{ borderRadius: 8, overflow: 'hidden' }}
          />
        </TsCard>
      </Col>
      <Col xs={24} lg={8} className="space-y-5">
        <TsCard
          title={<span style={{ fontWeight: 600, fontSize: 15, color: blueColors.charcoal }}>差异统计</span>}
          style={{ borderColor: blueColors.border, borderRadius: 12 }}
        >
          <List
            dataSource={stats}
            renderItem={(item, index) => (
              <List.Item
                className="px-0! flex justify-between items-center"
                style={{
                  borderBottom: index < stats.length - 1 ? `1px solid ${blueColors.border}` : 'none',
                  padding: '12px 0',
                }}
              >
                <span style={{ color: blueColors.muted, fontSize: 14 }}>{item.label}</span>
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: 16,
                    color: item.accent.text,
                    background: item.accent.bg,
                    padding: '4px 12px',
                    borderRadius: 9999,
                    minWidth: 36,
                    textAlign: 'center',
                  }}
                >
                  {item.value}
                </span>
              </List.Item>
            )}
          />
        </TsCard>
      </Col>
    </Row>
  );
}

function Step3Doc({
  form,
  version,
  gitHash,
  updates,
  relatedChanges,
  onAddUpdate,
  onUpdateChange,
  onRemoveUpdate,
  onRelatedChange,
}: {
  form: FormInstance;
  version?: string;
  gitHash?: string;
  updates: { id: string; type: string; content: string }[];
  relatedChanges: RelatedChangeItem[];
  onAddUpdate: () => void;
  onUpdateChange: (id: string, key: 'type' | 'content', value: string) => void;
  onRemoveUpdate: (id: string) => void;
  onRelatedChange: (id: string, key: keyof RelatedChangeItem, value: string) => void;
}) {
  const impactOther = Form.useWatch('impact_other', form);

  return (
    <Row gutter={[24, 24]}>
      <Col xs={24} lg={16}>
        <TsCard
          title={
            <div className="flex items-center justify-between">
              <span style={{ fontWeight: 600, fontSize: 16, color: blueColors.charcoal }}>
                步骤 3：生成发布说明并提交
              </span>
              <Text type="secondary" style={{ fontSize: 13, color: blueColors.muted }}>
                编辑后提交审批
              </Text>
            </div>
          }
          style={{ borderColor: blueColors.border, borderRadius: 12 }}
        >
          <div
            style={{
              background: blueColors.canvas,
              border: `1px solid ${blueColors.border}`,
              borderRadius: 12,
              padding: '32px 40px',
            }}
          >
            <div
              style={{
                textAlign: 'center',
                borderBottom: `2px solid ${blueColors.charcoal}`,
                paddingBottom: 20,
                marginBottom: 32,
              }}
            >
              <Title level={4} style={{ margin: 0, fontWeight: 700, letterSpacing: '-0.02em', color: blueColors.charcoal }}>
                软件发布规范
              </Title>
              <Text style={{ color: blueColors.muted, fontSize: 13 }}>Release Specification</Text>
            </div>

            <Form form={form} layout="vertical">
              <Row gutter={[24, 0]}>
                <Col xs={24} md={12}>
                  <Form.Item name="version" label="当前版本号" rules={[{ required: true }]}>
                    <Input placeholder="选择仓库与发布类型后自动生成" size="large" style={{ fontFamily: 'monospace' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="tag_name" label="Tag 名称">
                    <Input placeholder="选择仓库与发布类型后自动生成" size="large" style={{ fontFamily: 'monospace' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="git_hash" label="Git 提交哈希">
                    <Input
                      placeholder="选择来源分支后自动填充"
                      disabled
                      size="large"
                      style={{ fontFamily: '"SF Mono", "JetBrains Mono", monospace', background: blueColors.bone, color: blueColors.muted }}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="change_type" label="变更类型">
                    <Radio.Group size="large">
                      <Radio value="none">无配置项改动</Radio>
                      <Radio value="config">有配置项改动</Radio>
                    </Radio.Group>
                  </Form.Item>
                </Col>
              </Row>

              <Divider style={{ borderColor: blueColors.border, margin: '28px 0' }} />

              <div style={{ marginBottom: 24 }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
                  <Text style={{ fontWeight: 600, color: blueColors.charcoal }}>更新内容</Text>
                  <Button
                    type="dashed"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={onAddUpdate}
                    style={{ borderColor: blueColors.border, color: blueColors.muted }}
                  >
                    新增一条
                  </Button>
                </div>
                <Space direction="vertical" style={{ width: '100%' }} size="small">
                  {updates.map((item, index) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3"
                      style={{
                        padding: '10px 12px',
                        background: blueColors.bone,
                        borderRadius: 8,
                        border: `1px solid ${blueColors.border}`,
                      }}
                    >
                      <span
                        style={{
                          color: blueColors.muted,
                          fontSize: 13,
                          fontFamily: '"SF Mono", monospace',
                          minWidth: 36,
                        }}
                      >
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <Select
                        value={item.type}
                        onChange={(v) => onUpdateChange(item.id, 'type', v)}
                        options={[
                          { label: 'A类', value: 'A' },
                          { label: 'F类', value: 'F' },
                        ]}
                        style={{ width: 80 }}
                      />
                      <Input
                        value={item.content}
                        onChange={(e) => onUpdateChange(item.id, 'content', e.target.value)}
                        placeholder="更新内容"
                        style={{ flex: 1 }}
                      />
                      <Button
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={() => onRemoveUpdate(item.id)}
                        disabled={updates.length <= 1}
                      />
                    </div>
                  ))}
                </Space>
              </div>

              <Form.Item name="config_changes" label="配置项改动">
                <TextArea
                  rows={4}
                  placeholder="[System]\nDeviceType=0"
                  style={{ fontFamily: '"SF Mono", "JetBrains Mono", monospace', background: blueColors.bone }}
                />
              </Form.Item>

              <Divider style={{ borderColor: blueColors.border, margin: '28px 0' }} />

              <div style={{ marginBottom: 24 }}>
                <div style={{ marginBottom: 16 }}>
                  <Text style={{ fontWeight: 600, color: blueColors.charcoal }}>关联性改动</Text>
                  <Text style={{ color: blueColors.muted, fontSize: 13, marginLeft: 8 }}>[选填] 可修改软件名称与版本号</Text>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
                    gap: 12,
                  }}
                >
                  {relatedChanges.map((item, index) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3"
                      style={{
                        padding: '10px 12px',
                        background: blueColors.bone,
                        borderRadius: 8,
                        border: `1px solid ${blueColors.border}`,
                        animationDelay: `${index * 40}ms`,
                      }}
                    >
                      <Input
                        value={item.softwareName}
                        onChange={(e) => onRelatedChange(item.id, 'softwareName', e.target.value)}
                        placeholder="软件名称"
                        style={{
                          width: 180,
                          fontWeight: 500,
                          color: blueColors.charcoal,
                          background: blueColors.canvas,
                        }}
                      />
                      <span style={{ color: blueColors.muted, fontSize: 12, whiteSpace: 'nowrap' }}>版本</span>
                      <Input
                        value={item.version}
                        onChange={(e) => onRelatedChange(item.id, 'version', e.target.value)}
                        placeholder="版本号"
                        style={{ flex: 1, fontFamily: 'monospace' }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <Form.Item name="impact_other" label="是否影响其他功能" initialValue={false}>
                <Radio.Group>
                  <Radio value={false}>否</Radio>
                  <Radio value={true}>是</Radio>
                </Radio.Group>
              </Form.Item>
              {impactOther && (
                <Form.Item name="impact_description" style={{ marginTop: -8 }}>
                  <Input placeholder="例：影响功率控制" />
                </Form.Item>
              )}

              <Form.Item name="test_status" label="测试验证">
                <Checkbox.Group
                  options={[
                    { label: '自测试通过', value: 'self_test' },
                    { label: '研发测试复验通过', value: 'dev_test' },
                  ]}
                />
              </Form.Item>

              <Form.Item name="publisher" label="发布人">
                <Input placeholder="发布人姓名" size="large" />
              </Form.Item>
            </Form>
          </div>
        </TsCard>
      </Col>

      <Col xs={24} lg={8}>
        <TsCard
          title={<span style={{ fontWeight: 600, fontSize: 15, color: blueColors.charcoal }}>实时预览</span>}
          style={{ borderColor: blueColors.border, borderRadius: 12 }}
        >
          <PreviewPanel version={version} gitHash={gitHash} updates={updates} relatedChanges={relatedChanges} />
        </TsCard>
      </Col>
    </Row>
  );
}

function PreviewPanel({
  version,
  gitHash,
  updates,
  relatedChanges,
}: {
  version?: string;
  gitHash?: string;
  updates: { id: string; type: string; content: string }[];
  relatedChanges: RelatedChangeItem[];
}) {
  const visibleRelated = relatedChanges.filter((r) => r.version.trim());
  const versionText = version || '—';
  const hashText = gitHash ? `${gitHash.slice(0, 8)}...${gitHash.slice(-8)}` : '—';

  return (
    <div style={{ color: blueColors.charcoal, lineHeight: 1.7 }}>
      <div style={{ marginBottom: 16 }}>
        <Text style={{ color: blueColors.muted, fontSize: 12 }}>版本</Text>
        <div style={{ fontWeight: 700, fontSize: 18, fontFamily: 'monospace' }}>{versionText}</div>
      </div>
      <div style={{ marginBottom: 20 }}>
        <Text style={{ color: blueColors.muted, fontSize: 12 }}>Git 哈希</Text>
        <div style={{ fontFamily: 'monospace', fontSize: 13 }}>{hashText}</div>
      </div>

      <Divider style={{ borderColor: blueColors.border }} />

      <div style={{ marginBottom: 20 }}>
        <Text style={{ fontWeight: 600, display: 'block', marginBottom: 8 }}>更新内容</Text>
        {updates.map((u) =>
          u.content ? (
            <div key={u.id} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <Tag
                style={{
                  background: u.type === 'A' ? blueColors.paleBlue.bg : blueColors.paleYellow.bg,
                  color: u.type === 'A' ? blueColors.paleBlue.text : blueColors.paleYellow.text,
                  border: 'none',
                  borderRadius: 9999,
                  fontWeight: 600,
                }}
              >
                {u.type}类
              </Tag>
              <Text style={{ fontSize: 13 }}>{u.content}</Text>
            </div>
          ) : null
        )}
      </div>

      {visibleRelated.length > 0 && (
        <>
          <Divider style={{ borderColor: blueColors.border }} />
          <div>
            <Text style={{ fontWeight: 600, display: 'block', marginBottom: 8 }}>关联性改动</Text>
            {visibleRelated.map((r) => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                <Text style={{ color: blueColors.muted }}>{r.softwareName}</Text>
                <Text style={{ fontFamily: 'monospace' }}>{r.version}</Text>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
