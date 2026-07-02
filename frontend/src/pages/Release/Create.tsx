import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Form, Select } from 'antd';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  ArrowLeft,
  ChevronDown,
  FolderKanban,
  GitBranch,
  Settings2,
  Tag,
  Link as LinkIcon,
  ListChecks,
  Plus,
  X,
  Sparkles,
  Info,
  Rocket,
  Package,
  Cpu,
  Check,
  DownloadCloud,
  FileCog,
  ShieldAlert,
  CheckSquare,
  GitCommitHorizontal,
  GitPullRequestArrow,
} from 'lucide-react';
import { projectApi } from '@/api/project';
import { repositoryApi } from '@/api/repository';
import { releaseApi } from '@/api/release';
import { useAppMessage } from '@/hooks/useAppMessage';
import { parseMdTable, buildMdTable, type MdTableRow } from '@/utils/markdownTable';
import type { Release, ReleaseType, Repository, ChangesPreview, ParsedUpdate } from '@/types';

/** 关联变更清单条目 */
interface RelatedChange {
  key: string;
  value: string;
}

/** 变更条目（A/F 类） */
interface UpdateItem extends ParsedUpdate {
  type: string;
  content: string;
}

/** 发布类型卡片配置 */
const RELEASE_TYPES: { value: ReleaseType; title: string; desc: string }[] = [
  { value: 'formal', title: '正式', desc: '目标分支须为 main / master' },
  { value: 'rc', title: 'RC', desc: 'Tag 自动加 -rc 后缀' },
  { value: 'beta', title: 'Beta', desc: 'Tag 自动加 -beta 后缀' },
];

export default function ReleaseCreate() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectIdFromQuery = searchParams.get('project_id') || undefined;
  const { message } = useAppMessage();
  const [form] = Form.useForm();
  const [currentStep, setCurrentStep] = useState(0);
  const [createdRelease, setCreatedRelease] = useState<Release | null>(null);
  const [docRows, setDocRows] = useState<MdTableRow[]>([]);
  const [docSaved, setDocSaved] = useState(true);

  // 本地态：更新内容 / 关联变更 / 配置项 / 影响验证
  const [updates, setUpdates] = useState<UpdateItem[]>([]);
  const [relatedChanges, setRelatedChanges] = useState<RelatedChange[]>([]);
  const [hasConfigChanges, setHasConfigChanges] = useState(false);
  const [configChangeDoc, setConfigChangeDoc] = useState('');
  const [impactOther, setImpactOther] = useState(false);
  const [impactDesc, setImpactDesc] = useState('');
  const [selfTestPassed, setSelfTestPassed] = useState(false);
  const [retestPassed, setRetestPassed] = useState(false);

  // 响应式跟踪关键字段
  const watchProject = Form.useWatch('project', form) as string | undefined;
  const watchRepository = Form.useWatch('repository', form) as string | undefined;
  const watchReleaseType = (Form.useWatch('release_type', form) as ReleaseType) || 'formal';
  const watchBranch = Form.useWatch('branch', form) as string | undefined;

  const { data: projectData, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects-all'],
    queryFn: () => projectApi.getProjects({ page_size: 1000 }),
    enabled: !projectIdFromQuery,
  });

  const { data: repoData, isLoading: reposLoading } = useQuery({
    queryKey: ['repositories', watchProject],
    queryFn: () => repositoryApi.getRepositories({ project: watchProject, page_size: 1000 }),
    enabled: !!watchProject,
  });

  const {
    data: branches,
    isLoading: branchesLoading,
    error: branchesError,
  } = useQuery({
    queryKey: ['repository-branches', watchRepository],
    queryFn: () => repositoryApi.getBranches(watchRepository || ''),
    enabled: !!watchRepository,
    retry: false,
  });

  const branchesErrorMsg = branchesError
    ? (branchesError as { message?: string })?.message || '获取分支失败，请检查仓库凭证与连通性'
    : undefined;

  // 自动版本号预览
  const { data: nextVersionData, isLoading: nextVersionLoading } = useQuery({
    queryKey: ['repository-next-version', watchRepository, watchReleaseType, watchBranch],
    queryFn: () => repositoryApi.getNextVersion(watchRepository || '', watchReleaseType),
    enabled: !!watchRepository && !!watchBranch,
  });

  // 变更预览：选 branch 后拉取 commits + MRs + parsed_updates
  const { data: changesPreview, isLoading: changesLoading } = useQuery<ChangesPreview>({
    queryKey: ['repository-changes-preview', watchRepository, watchBranch],
    queryFn: () => repositoryApi.previewChanges(watchRepository || '', watchBranch || ''),
    enabled: !!watchRepository && !!watchBranch,
    retry: false,
  });

  // 选 branch 后自动回填 parsed_updates（仅在首次拉取或切换分支时触发）
  const lastPreviewRef = useRef<string>('');
  useEffect(() => {
    if (!changesPreview) return;
    const key = `${watchRepository}-${watchBranch}`;
    if (key === lastPreviewRef.current) return;
    lastPreviewRef.current = key;
    if (changesPreview.parsed_updates?.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUpdates(
        changesPreview.parsed_updates.map((u) => ({
          type: u.type || 'A',
          content: u.content || '',
          source: u.source,
          source_ref: u.source_ref,
        }))
      );
    }
  }, [changesPreview, watchRepository, watchBranch]);

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

  // tag_name 自动回填
  const tagNameDirtyRef = useRef(false);
  useEffect(() => {
    const suggested = nextVersionData?.next_tag_name;
    if (suggested && !tagNameDirtyRef.current) {
      form.setFieldsValue({ tag_name: suggested });
    }
  }, [nextVersionData?.next_tag_name, form]);

  useEffect(() => {
    tagNameDirtyRef.current = false;
  }, [watchRepository, watchBranch, watchReleaseType]);

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      releaseApi.createRelease({
        project: values.project as string,
        repository: values.repository as string,
        release_type: values.release_type as ReleaseType,
        branch: values.branch as string,
        tag_name: (values.tag_name as string)?.trim() || undefined,
        related_changes: relatedChanges.filter((r) => r.key.trim()),
        updates: updates.filter((u) => u.content.trim()),
        has_config_changes: hasConfigChanges,
        config_change_doc: configChangeDoc,
        impact_other: impactOther,
        impact_desc: impactDesc,
        self_test_passed: selfTestPassed,
        retest_passed: retestPassed,
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
    onSuccess: (md) => {
      const mdStr = md as string;
      setDocRows(parseMdTable(mdStr));
      setDocSaved(true);
    },
    onError: (err: { message?: string }) => message.error(err?.message || '生成发布说明失败'),
  });

  const updateDocMutation = useMutation({
    mutationFn: ({ id, md }: { id: string; md: string }) => releaseApi.updateDoc(id, md),
    onSuccess: () => {
      message.success('发布说明已保存');
      setDocSaved(true);
    },
    onError: (err: { message?: string }) => message.error(err?.message || '保存失败'),
  });

  const submitMutation = useMutation({
    mutationFn: (id: string) => releaseApi.submitAudit(id),
    onSuccess: () => {
      message.success('提交审批成功');
      setCurrentStep(2);
    },
    onError: (err: { message?: string }) => message.error(err?.message || '提交审批失败'),
  });

  const handleProjectChange = () => {
    form.setFieldsValue({ repository: undefined, branch: undefined });
  };
  const handleRepoChange = () => {
    form.setFieldsValue({ branch: undefined });
  };

  const handleSubmitAudit = () => {
    if (createdRelease?.id) submitMutation.mutate(createdRelease.id);
  };

  const handleSaveDoc = () => {
    if (createdRelease?.id) {
      const md = buildMdTable(docRows);
      updateDocMutation.mutate({ id: createdRelease.id, md });
    }
  };

  const steps = [
    { title: '创建发布' },
    { title: '生成说明' },
    { title: '提交审批' },
  ];

  // 步骤 1 表单字段是否就绪
  const formReady = !!watchProject && !!watchRepository && !!watchBranch;

  return (
    <div className="mx-auto max-w-[960px] space-y-5 page-fade-in">
      {/* 返回 + 标题 */}
      <div>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-2 inline-flex items-center gap-1 text-[13px] text-slate-400 hover:text-indigo-600"
        >
          <ArrowLeft className="h-3.5 w-3.5" style={{ strokeWidth: 1.5 }} />
          <span>返回</span>
        </button>
        <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">创建发布</h1>
        <p className="mt-1 text-[13px] text-slate-500">
          选择项目与仓库，配置发布类型与分支，系统将自动拉取提交与 MR 记录并解析更新内容
        </p>
      </div>

      {/* 步骤条 */}
      <div className="tech-card rounded-xl p-4">
        <div className="flex items-center">
          {steps.map((s, idx) => {
            const done = idx < currentStep;
            const current = idx === currentStep;
            return (
              <div key={s.title} className="flex flex-1 items-center last:flex-none">
                <div className="flex items-center gap-2">
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-[12px] font-semibold ${
                      done
                        ? 'border-indigo-600 bg-indigo-600 text-white'
                        : current
                        ? 'border-indigo-600 bg-white text-indigo-600'
                        : 'border-slate-200 bg-white text-slate-400'
                    }`}
                  >
                    {done ? <Check className="h-3.5 w-3.5" style={{ strokeWidth: 2.5 }} /> : idx + 1}
                  </div>
                  <span
                    className={`text-[12px] font-medium ${
                      done || current ? 'text-indigo-600' : 'text-slate-400'
                    }`}
                  >
                    {s.title}
                  </span>
                </div>
                {idx < steps.length - 1 && (
                  <div
                    className={`mx-3 h-0.5 flex-1 ${idx < currentStep ? 'bg-indigo-600' : 'bg-slate-200'}`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ========== 步骤 1：填写表单 ========== */}
      {currentStep === 0 && (
        <Form form={form} layout="vertical" onFinish={(v) => createMutation.mutate(v)} requiredMark={false}>
          {/* 1. 基础配置 */}
          <section className="tech-card mb-5 rounded-xl p-5">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg icon-indigo">
                <Settings2 className="h-3.5 w-3.5" style={{ strokeWidth: 1.5 }} />
              </div>
              <h3 className="text-[14px] font-semibold text-slate-900">基础配置</h3>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Form.Item name="project" label="项目" rules={[{ required: true, message: '请选择项目' }]}>
                <SelectField
                  icon={<FolderKanban className="h-4 w-4 text-slate-400" style={{ strokeWidth: 1.5 }} />}
                  placeholder="选择项目"
                  loading={projectsLoading}
                  options={projectOptions}
                  onChange={handleProjectChange}
                  disabled={!!projectIdFromQuery}
                  hint="只有你参与的项目才会显示"
                />
              </Form.Item>
              <Form.Item name="repository" label="目标仓库" rules={[{ required: true, message: '请选择仓库' }]}>
                <SelectField
                  icon={<GitBranch className="h-4 w-4 text-slate-400" style={{ strokeWidth: 1.5 }} />}
                  placeholder="选择仓库"
                  loading={reposLoading}
                  options={repoOptions}
                  onChange={handleRepoChange}
                  hint="Tag 将推送至此仓库"
                />
              </Form.Item>
            </div>
            <Form.Item
              name="release_type"
              label="发布类型"
              initialValue="formal"
              rules={[{ required: true, message: '请选择发布类型' }]}
              className="mb-0 mt-1"
            >
              <ReleaseTypeCards />
            </Form.Item>
          </section>

          {/* 2. 分支配置 */}
          <section className="tech-card mb-5 rounded-xl p-5">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg icon-cyan">
                <GitBranch className="h-3.5 w-3.5" style={{ strokeWidth: 1.5 }} />
              </div>
              <h3 className="text-[14px] font-semibold text-slate-900">分支配置</h3>
            </div>
            <Form.Item name="branch" label="分支" rules={[{ required: true, message: '请选择分支' }]}>
              <SelectField
                icon={<GitBranch className="h-4 w-4 text-slate-400" style={{ strokeWidth: 1.5 }} />}
                placeholder="选择分支"
                loading={branchesLoading}
                options={branchOptions}
                hint={
                  branchesErrorMsg
                    ? branchesErrorMsg
                    : '发布说明将拉取此分支的提交，Tag 将推送到此分支；正式版本只能从 main / master 发布'
                }
                error={!!branchesErrorMsg}
              />
            </Form.Item>

            {/* 基线信息 */}
            {formReady && changesPreview && (
              <div className="mt-1 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/30 p-3">
                  <GitPullRequestArrow className="h-3.5 w-3.5 shrink-0 text-indigo-500" style={{ strokeWidth: 1.5 }} />
                  <span className="text-[12px] text-slate-600">
                    上一个 Tag（基线）：
                    <span className="font-mono text-indigo-600">{changesPreview.last_tag || '无'}</span>
                  </span>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-cyan-100 bg-cyan-50/30 p-3">
                  <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0 text-cyan-500" style={{ strokeWidth: 1.5 }} />
                  <span className="text-[12px] text-slate-600">
                    本次基线 HEAD：
                    <span className="font-mono text-cyan-600">{changesPreview.head_hash?.slice(0, 12) || '-'}</span>
                  </span>
                </div>
              </div>
            )}
          </section>

          {/* 3. 版本号配置 */}
          <section className="tech-card mb-5 rounded-xl p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg icon-violet">
                  <Tag className="h-3.5 w-3.5" style={{ strokeWidth: 1.5 }} />
                </div>
                <h3 className="text-[14px] font-semibold text-slate-900">需要发布的版本号</h3>
              </div>
              <span className="text-[11px] text-slate-400">不填则自动计算</span>
            </div>
            <Form.Item name="tag_name" label="Tag 名" className="mb-0">
              <input
                placeholder="留空自动生成"
                onChange={() => { tagNameDirtyRef.current = true; }}
                className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-mono text-[13px] text-slate-700 placeholder-slate-400 outline-none"
              />
            </Form.Item>
            <p className="mt-1 text-[11px] text-slate-400">正式无后缀 / RC 加 -rc / Beta 加 -beta</p>

            {/* 自动计算预览 */}
            {nextVersionData?.all_types && (
              <div className="mt-4 rounded-lg border border-indigo-100 bg-gradient-to-br from-indigo-50/40 to-cyan-50/30 p-4">
                <div className="mb-3 flex items-center gap-1.5 text-[11px] font-medium text-indigo-600">
                  <Sparkles className="h-3.5 w-3.5" style={{ strokeWidth: 1.5 }} />
                  各类型最新 Tag
                  {nextVersionLoading && <span className="text-slate-400">（计算中…）</span>}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {(['formal', 'rc', 'beta'] as const).map((rt) => {
                    const item = nextVersionData.all_types[rt];
                    const label = rt === 'formal' ? '正式' : rt === 'rc' ? 'RC' : 'Beta';
                    return (
                      <div key={rt} className="rounded-md border border-slate-200 bg-white/70 px-2.5 py-2">
                        <div className="text-[10px] text-slate-400">{label}</div>
                        <div className="mt-0.5 truncate font-mono text-[11px] text-slate-600" title={item?.latest_tag || '无'}>
                          {item?.latest_tag || '无'}
                        </div>
                        <div className="mt-1 text-[9px] text-slate-300">下一个 {item?.next_tag_name || '—'}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* 4. 提交与 MR 记录 */}
          {formReady && (
            <section className="tech-card mb-5 rounded-xl p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg icon-cyan">
                    <DownloadCloud className="h-3.5 w-3.5" style={{ strokeWidth: 1.5 }} />
                  </div>
                  <h3 className="text-[14px] font-semibold text-slate-900">提交与 MR 记录</h3>
                  {changesPreview && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600 border border-emerald-200">
                      {changesLoading ? '拉取中…' : '已拉取'}
                    </span>
                  )}
                </div>
              </div>

              {/* 统计条 */}
              {changesPreview && (
                <div className="mb-4 grid grid-cols-3 gap-3">
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                      <GitCommitHorizontal className="h-3 w-3" style={{ strokeWidth: 1.5 }} />Commit 总数
                    </div>
                    <div className="mt-1 font-mono text-[18px] font-semibold text-slate-900">
                      {changesPreview.commits.length}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                      <GitPullRequestArrow className="h-3 w-3" style={{ strokeWidth: 1.5 }} />MR 总数
                    </div>
                    <div className="mt-1 font-mono text-[18px] font-semibold text-slate-900">
                      {changesPreview.merge_requests.length}
                    </div>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                    <div className="flex items-center gap-1.5 text-[10px] text-emerald-600">
                      <Check className="h-3 w-3" style={{ strokeWidth: 1.5 }} />已解析条目
                    </div>
                    <div className="mt-1 font-mono text-[18px] font-semibold text-emerald-600">
                      {changesPreview.parsed_updates.length}
                    </div>
                  </div>
                </div>
              )}

              {/* Commit 列表 */}
              {changesPreview && changesPreview.commits.length > 0 && (
                <div className="space-y-2">
                  {changesPreview.commits.map((c, idx) => (
                    <div
                      key={idx}
                      className={`rounded-lg border p-3 ${
                        c.has_af
                          ? 'border-emerald-200 bg-emerald-50/30'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="mb-1.5 flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            c.has_af
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-slate-100 text-slate-400'
                          }`}
                        >
                          {c.has_af ? 'AF 命中' : '未命中'}
                        </span>
                        <span className="font-mono text-[11px] text-slate-500">{c.hash.slice(0, 12)}</span>
                        <span className="text-[11px] text-slate-400">· {c.author}</span>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-[12px] text-slate-700">
                        {c.message}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {changesLoading && (
                <p className="py-4 text-center text-[13px] text-slate-400">拉取中…</p>
              )}
            </section>
          )}

          {/* 5. 更新内容 */}
          <section className="tech-card mb-5 rounded-xl p-5">
            <div className="mb-1 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg icon-emerald">
                  <ListChecks className="h-3.5 w-3.5" style={{ strokeWidth: 1.5 }} />
                </div>
                <h3 className="text-[14px] font-semibold text-slate-900">更新内容</h3>
                {updates.length > 0 && (
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600 border border-indigo-200">
                    {updates.length} 条
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setUpdates((prev) => [...prev, { type: 'A', content: '' }])}
                className="inline-flex items-center gap-1 rounded-md border border-indigo-100 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-indigo-50 hover:text-indigo-600"
              >
                <Plus className="h-3 w-3" style={{ strokeWidth: 1.5 }} />
                手动添加
              </button>
            </div>
            <p className="mb-3 text-[11px] text-slate-400">
              来源：Commit 中含「A 」或「F 」前缀的行 + MR 描述中正则匹配的行，可在此编辑
            </p>

            {updates.length === 0 ? (
              <p className="text-[12px] text-slate-400">暂无条目</p>
            ) : (
              <div className="space-y-2">
                {updates.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 rounded-lg border border-indigo-50 bg-white px-3 py-2"
                  >
                    <select
                      value={item.type}
                      onChange={(e) =>
                        setUpdates((prev) =>
                          prev.map((u, i) => (i === idx ? { ...u, type: e.target.value } : u))
                        )
                      }
                      className={`rounded-md border bg-white px-2 py-1 text-[11px] font-mono font-medium outline-none ${
                        item.type === 'A'
                          ? 'border-emerald-200 text-emerald-700'
                          : 'border-amber-200 text-amber-700'
                      }`}
                    >
                      <option value="A">A</option>
                      <option value="F">F</option>
                    </select>
                    <input
                      value={item.content}
                      onChange={(e) =>
                        setUpdates((prev) =>
                          prev.map((u, i) => (i === idx ? { ...u, content: e.target.value } : u))
                        )
                      }
                      placeholder="变更内容描述"
                      className="input-field flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-[12px] text-slate-700 outline-none focus:border-indigo-200 focus:bg-white"
                    />
                    {item.source && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] border ${
                          item.source === 'commit'
                            ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                            : 'bg-violet-50 text-violet-600 border-violet-100'
                        }`}
                      >
                        {item.source === 'commit' ? (
                          <GitCommitHorizontal className="h-2.5 w-2.5" style={{ strokeWidth: 1.5 }} />
                        ) : (
                          <GitPullRequestArrow className="h-2.5 w-2.5" style={{ strokeWidth: 1.5 }} />
                        )}
                        {item.source_ref}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setUpdates((prev) => prev.filter((_, i) => i !== idx))}
                      className="rounded-md p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-500"
                    >
                      <X className="h-3.5 w-3.5" style={{ strokeWidth: 1.5 }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 6. 配置项改动 */}
          <section className="tech-card mb-5 rounded-xl p-5">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg icon-amber">
                <FileCog className="h-3.5 w-3.5" style={{ strokeWidth: 1.5 }} />
              </div>
              <h3 className="text-[14px] font-semibold text-slate-900">配置项改动</h3>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5">
              <div>
                <div className="text-[13px] font-medium text-slate-700">是否有配置项改动</div>
                <div className="text-[11px] text-slate-400">若涉及配置文件、环境变量等变更，需填写配置项变更文档</div>
              </div>
              <button
                type="button"
                onClick={() => setHasConfigChanges((v) => !v)}
                className={`relative h-[22px] w-[38px] rounded-full transition-colors ${
                  hasConfigChanges ? 'bg-indigo-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`absolute left-0 top-[3px] h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    hasConfigChanges ? 'translate-x-[18px]' : 'translate-x-[3px]'
                  }`}
                />
              </button>
            </div>

            {hasConfigChanges && (
              <div className="mt-4">
                <label className="mb-1.5 block text-[12px] font-medium text-slate-600">配置项变更文档</label>
                <textarea
                  rows={6}
                  value={configChangeDoc}
                  onChange={(e) => setConfigChangeDoc(e.target.value)}
                  placeholder="请填写配置项变更文档，说明新增 / 修改 / 删除的配置项及取值"
                  className="input-field w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-mono text-[13px] text-slate-700 placeholder-slate-400 outline-none"
                />
              </div>
            )}
          </section>

          {/* 7. 关联变更清单 */}
          <section className="tech-card mb-5 rounded-xl p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg icon-amber">
                  <LinkIcon className="h-3.5 w-3.5" style={{ strokeWidth: 1.5 }} />
                </div>
                <h3 className="text-[14px] font-semibold text-slate-900">关联变更清单</h3>
                <span className="text-[10px] text-slate-400">可选</span>
              </div>
              <button
                type="button"
                onClick={() => setRelatedChanges((prev) => [...prev, { key: '', value: '' }])}
                className="inline-flex items-center gap-1 rounded-md border border-indigo-100 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-indigo-50 hover:text-indigo-600"
              >
                <Plus className="h-3 w-3" style={{ strokeWidth: 1.5 }} />
                添加条目
              </button>
            </div>
            {relatedChanges.length === 0 ? (
              <p className="text-[12px] text-slate-400">暂无条目，点击右上角添加</p>
            ) : (
              <div className="space-y-2">
                {relatedChanges.map((item, idx) => {
                  const Icon = idx % 2 === 0 ? Package : Cpu;
                  return (
                    <div
                      key={idx}
                      className="flex items-center gap-2 rounded-lg border border-indigo-50 bg-white px-3 py-2"
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 text-amber-500" style={{ strokeWidth: 1.5 }} />
                      <input
                        value={item.key}
                        onChange={(e) =>
                          setRelatedChanges((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r))
                          )
                        }
                        placeholder="条目名（如：固件版本）"
                        className="input-field flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-[12px] text-slate-700 outline-none focus:border-indigo-200 focus:bg-white"
                      />
                      <span className="text-[11px] text-slate-300">:</span>
                      <input
                        value={item.value}
                        onChange={(e) =>
                          setRelatedChanges((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r))
                          )
                        }
                        placeholder="取值"
                        className="input-field w-28 rounded-md border border-transparent bg-transparent px-2 py-1 text-[12px] font-mono text-slate-700 outline-none focus:border-indigo-200 focus:bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => setRelatedChanges((prev) => prev.filter((_, i) => i !== idx))}
                        className="rounded-md p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-500"
                      >
                        <X className="h-3.5 w-3.5" style={{ strokeWidth: 1.5 }} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="mt-2 text-[11px] text-slate-400">记录硬件版本、依赖模块等关联变更信息，将写入发布说明</p>
          </section>

          {/* 8. 影响与验证 */}
          <section className="tech-card mb-5 rounded-xl p-5">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg icon-rose" style={{ background: 'linear-gradient(135deg,#FFF1F2,#FFE4E6)', color: '#BE123C', border: '1px solid #FECDD3' }}>
                <ShieldAlert className="h-3.5 w-3.5" style={{ strokeWidth: 1.5 }} />
              </div>
              <h3 className="text-[14px] font-semibold text-slate-900">影响与验证</h3>
            </div>

            {/* 是否影响其他功能 */}
            <div className="mb-3 flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5">
              <div>
                <div className="text-[13px] font-medium text-slate-700">是否影响其他功能</div>
                <div className="text-[11px] text-slate-400">本次发布是否对其他模块或上下游系统产生影响</div>
              </div>
              <button
                type="button"
                onClick={() => setImpactOther((v) => !v)}
                className={`relative h-[22px] w-[38px] rounded-full transition-colors ${
                  impactOther ? 'bg-indigo-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`absolute left-0 top-[3px] h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    impactOther ? 'translate-x-[18px]' : 'translate-x-[3px]'
                  }`}
                />
              </button>
            </div>

            {impactOther && (
              <div className="mb-4">
                <label className="mb-1.5 block text-[12px] font-medium text-slate-600">影响范围说明</label>
                <textarea
                  rows={2}
                  value={impactDesc}
                  onChange={(e) => setImpactDesc(e.target.value)}
                  placeholder="说明受影响的模块、接口、上下游系统"
                  className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[13px] text-slate-700 placeholder-slate-400 outline-none"
                />
              </div>
            )}

            {/* 测试验证 */}
            <div className="rounded-lg border border-slate-200 bg-white p-3.5">
              <div className="mb-3 flex items-center gap-1.5">
                <CheckSquare className="h-4 w-4 text-indigo-500" style={{ strokeWidth: 1.5 }} />
                <span className="text-[13px] font-medium text-slate-700">测试验证</span>
                <span className="text-[11px] text-slate-400">提交审批前请确认测试状态</span>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <CheckCard
                  checked={selfTestPassed}
                  onChange={setSelfTestPassed}
                  title="自测试通过"
                  desc="开发人员已完成自测"
                />
                <CheckCard
                  checked={retestPassed}
                  onChange={setRetestPassed}
                  title="研发测试复验通过"
                  desc="测试团队已复验通过"
                />
              </div>
            </div>
          </section>

          {/* 底部操作 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Info className="h-3 w-3" style={{ strokeWidth: 1.5 }} />
              <span>创建后状态为草稿，提交审批前请确认更新内容、配置项与测试状态</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-4 py-2.5 text-[13px] font-medium text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-[13px] font-medium text-white disabled:opacity-60"
              >
                <Rocket className="h-3.5 w-3.5" style={{ strokeWidth: 1.5 }} />
                {createMutation.isPending ? '创建中…' : '创建发布'}
              </button>
            </div>
          </div>
        </Form>
      )}

      {/* ========== 步骤 2：编辑发布说明（表格组件，无表头） ========== */}
      {currentStep >= 1 && createdRelease && (
        <div className="space-y-5">
          <section className="tech-card rounded-xl p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg icon-emerald">
                  <ListChecks className="h-3.5 w-3.5" style={{ strokeWidth: 1.5 }} />
                </div>
                <h3 className="text-[14px] font-semibold text-slate-900">发布说明</h3>
                {generateDocMutation.isPending && (
                  <span className="text-[12px] text-slate-400">生成中…</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-slate-400">
                  {docSaved ? '已保存' : '有未保存的修改'}
                </span>
                <button
                  type="button"
                  onClick={handleSaveDoc}
                  disabled={updateDocMutation.isPending || docSaved}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" style={{ strokeWidth: 1.5 }} />
                  保存编辑
                </button>
              </div>
            </div>

            {/* 可编辑 2 列表格（无表头），左列标题只读，右列内容可编辑 */}
            {docRows.length > 0 ? (
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full border-collapse">
                  <tbody>
                    {docRows.map((row, idx) => (
                      <tr key={idx} className="border-b border-slate-100 last:border-0">
                        <td className="w-[160px] shrink-0 bg-slate-50/60 px-4 py-2 align-top text-[12px] font-medium text-slate-500">
                          {row.key}
                        </td>
                        <td className="px-3 py-2">
                          <textarea
                            value={row.value}
                            onChange={(e) => {
                              const newVal = e.target.value;
                              setDocRows((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, value: newVal } : r))
                              );
                              setDocSaved(false);
                            }}
                            rows={Math.max(1, Math.ceil((row.value.length || 0) / 50))}
                            className="input-field w-full resize-y rounded-md border border-transparent bg-transparent px-2 py-1 text-[13px] text-slate-700 outline-none focus:border-indigo-200 focus:bg-white"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="py-8 text-center text-[13px] text-slate-400">
                {generateDocMutation.isPending ? '生成中…' : '发布说明为空'}
              </p>
            )}
            <p className="mt-2 text-[11px] text-slate-400">
              变更内容中 A 为功能增加，F 为 BUG 修复；保存后将序列化为 Markdown 文档
            </p>
          </section>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => navigate('/releases')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-4 py-2.5 text-[13px] font-medium text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
            >
              返回发布看板
            </button>
            <button
              type="button"
              onClick={handleSubmitAudit}
              disabled={currentStep === 2 || submitMutation.isPending}
              className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-[13px] font-medium text-white disabled:opacity-60"
            >
              {currentStep === 2 ? '已提交审批' : submitMutation.isPending ? '提交中…' : '提交审批'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- 子组件 ---------------- */

function SelectField({
  icon,
  hint,
  loading,
  options,
  placeholder,
  disabled,
  onChange,
  error,
}: {
  icon: React.ReactNode;
  hint?: string;
  loading?: boolean;
  options: { label: string; value: string }[];
  placeholder?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
  error?: boolean;
}) {
  return (
    <div>
      <Select
        showSearch
        placeholder={placeholder}
        loading={loading}
        options={options}
        optionFilterProp="label"
        allowClear
        disabled={disabled}
        onChange={onChange}
        prefix={icon}
        suffixIcon={<ChevronDown className="h-4 w-4 text-slate-400" style={{ strokeWidth: 1.5 }} />}
        className="w-full"
      />
      {hint && (
        <p className={`mt-1 text-[11px] ${error ? 'text-rose-500' : 'text-slate-400'}`}>{hint}</p>
      )}
    </div>
  );
}

function ReleaseTypeCards({ value, onChange }: { value?: ReleaseType; onChange?: (v: ReleaseType) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {RELEASE_TYPES.map((t) => {
        const on = value === t.value;
        return (
          <button
            type="button"
            key={t.value}
            onClick={() => onChange?.(t.value)}
            className={`flex items-center gap-2.5 rounded-lg border p-3 text-left transition-colors ${
              on
                ? 'border-indigo-500 bg-indigo-50 shadow-[0_0_0_1px_#6366F1]'
                : 'border-slate-200 bg-white hover:border-indigo-300'
            }`}
          >
            <span
              className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                on ? 'border-indigo-500 bg-indigo-500' : 'border-slate-300'
              }`}
            >
              {on && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
            </span>
            <div>
              <div className="text-[13px] font-medium text-slate-900">{t.title}</div>
              <div className="text-[11px] text-slate-400">{t.desc}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function CheckCard({
  checked,
  onChange,
  title,
  desc,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors ${
        checked
          ? 'border-indigo-300 bg-indigo-50/40'
          : 'border-slate-200 bg-slate-50/40 hover:border-indigo-200'
      }`}
    >
      <span
        className={`mt-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border-[1.5px] transition-colors ${
          checked ? 'border-indigo-600 bg-indigo-600' : 'border-slate-300 bg-white'
        }`}
      >
        {checked && <Check className="h-3 w-3 text-white" style={{ strokeWidth: 3 }} />}
      </span>
      <div>
        <div className="text-[13px] font-medium text-slate-700">{title}</div>
        <div className="text-[11px] text-slate-400">{desc}</div>
      </div>
    </button>
  );
}
