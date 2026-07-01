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
} from 'lucide-react';
import { projectApi } from '@/api/project';
import { repositoryApi } from '@/api/repository';
import { releaseApi } from '@/api/release';
import { useAppMessage } from '@/hooks/useAppMessage';
import { releaseTypeText } from '@/pages/Release/constants';
import type { Release, ReleaseType, Repository } from '@/types';

/** 发布说明文档（generate-doc 返回结构） */
interface ReleaseDoc {
  change_type?: string;
  updates?: { type?: string; content?: string }[];
  config_changes?: Record<string, Record<string, string>>;
  related_changes?: Record<string, string>;
  publisher?: string;
}

/** 关联变更清单条目 */
interface RelatedChange {
  key: string;
  value: string;
}

/** 变更条目（A/F 类） */
interface UpdateItem {
  type: 'A' | 'F';
  content: string;
}

/** 发布类型卡片配置 */
const RELEASE_TYPES: { value: ReleaseType; title: string; desc: string }[] = [
  { value: 'formal', title: '正式', desc: '目标分支须为 main / master' },
  { value: 'rc', title: 'RC', desc: 'Tag 自动加 rc- 前缀' },
  { value: 'beta', title: 'Beta', desc: 'Tag 自动加 beta- 前缀' },
];

/** 变更条目类型说明 */
const UPDATE_TYPE_LABEL: Record<string, string> = { A: '功能增加', F: 'BUG 修复' };

export default function ReleaseCreate() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectIdFromQuery = searchParams.get('project_id') || undefined;
  const { message } = useAppMessage();
  const [form] = Form.useForm();
  const [currentStep, setCurrentStep] = useState(0);
  const [createdRelease, setCreatedRelease] = useState<Release | null>(null);
  const [releaseDoc, setReleaseDoc] = useState<ReleaseDoc | null>(null);

  // 关联变更清单 / 变更条目为可选本地态（不在 antd Form 内管理）
  const [relatedChanges, setRelatedChanges] = useState<RelatedChange[]>([]);
  const [updates, setUpdates] = useState<UpdateItem[]>([]);

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

  // 分支拉取失败的错误信息（凭证失效 / 仓库无法连接等）
  const branchesErrorMsg = branchesError
    ? (branchesError as { message?: string })?.message || '获取分支失败，请检查仓库凭证与连通性'
    : undefined;

  // 自动版本号预览（选择分支后触发，tag 是仓库级概念但按需求在分支选定后再展示）
  const { data: nextVersionData, isLoading: nextVersionLoading } = useQuery({
    queryKey: ['repository-next-version', watchRepository, watchReleaseType, watchBranch],
    queryFn: () => repositoryApi.getNextVersion(watchRepository || '', watchReleaseType),
    enabled: !!watchRepository && !!watchBranch,
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

  // 分支 HEAD
  const branchHead = useMemo(() => {
    if (!watchBranch) return undefined;
    return (branches || []).find((b) => b.name === watchBranch)?.last_commit_hash;
  }, [branches, watchBranch]);

  useEffect(() => {
    if (projectIdFromQuery) {
      form.setFieldsValue({ project: projectIdFromQuery });
    }
  }, [projectIdFromQuery, form]);

  // tag_name 是否被用户手动编辑过（未手动改时自动跟随建议 tag 名）
  const tagNameDirtyRef = useRef(false);
  useEffect(() => {
    const suggested = nextVersionData?.next_tag_name;
    if (suggested && !tagNameDirtyRef.current) {
      form.setFieldsValue({ tag_name: suggested });
    }
  }, [nextVersionData?.next_tag_name, form]);

  // 切换仓库/分支/发布类型时重置 dirty 标记，允许重新回填
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
      } as never),
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

  const handleProjectChange = () => {
    form.setFieldsValue({ repository: undefined, branch: undefined });
  };
  const handleRepoChange = () => {
    form.setFieldsValue({ branch: undefined });
  };

  const handleSubmitAudit = () => {
    if (createdRelease?.id) submitMutation.mutate(createdRelease.id);
  };

  const steps = [
    { title: '创建发布' },
    { title: '生成说明' },
    { title: '提交审批' },
  ];

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
          选择项目与仓库，配置发布类型与分支，系统将自动计算版本号与 Tag 名
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

            <div className="grid grid-cols-1 gap-4 md:grid-cols-1">
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
            </div>

            {branchHead && (
              <div className="mt-1 flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/30 p-3">
                <Info className="h-3.5 w-3.5 shrink-0 text-indigo-500" style={{ strokeWidth: 1.5 }} />
                <span className="text-[12px] text-slate-600">
                  分支当前 HEAD：
                  <span className="font-mono text-indigo-600">{branchHead.slice(0, 12)}</span>
                </span>
              </div>
            )}
          </section>

          {/* 3. 版本号选择 */}
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
                onChange={() => {
                  tagNameDirtyRef.current = true;
                }}
                className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-mono text-[13px] text-slate-700 placeholder-slate-400 outline-none"
              />
            </Form.Item>
            <p className="mt-1 text-[11px] text-slate-400">正式无后缀 / RC 加 -rc / Beta 加 -beta</p>

            {/* 各发布类型最新 Tag（只读） */}
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
                      <div
                        key={rt}
                        className="rounded-md border border-slate-200 bg-white/70 px-2.5 py-2"
                      >
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

          {/* 4. 关联变更清单（可选） */}
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

          {/* 5. 变更条目（可选） */}
          <section className="tech-card mb-5 rounded-xl p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg icon-emerald">
                  <ListChecks className="h-3.5 w-3.5" style={{ strokeWidth: 1.5 }} />
                </div>
                <h3 className="text-[14px] font-semibold text-slate-900">变更条目</h3>
                <span className="text-[10px] text-slate-400">可选</span>
              </div>
              <button
                type="button"
                onClick={() => setUpdates((prev) => [...prev, { type: 'A', content: '' }])}
                className="inline-flex items-center gap-1 rounded-md border border-indigo-100 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-indigo-50 hover:text-indigo-600"
              >
                <Plus className="h-3 w-3" style={{ strokeWidth: 1.5 }} />
                添加条目
              </button>
            </div>

            {updates.length === 0 ? (
                <p className="text-[12px] text-slate-400">暂无条目，点击右上角添加</p>
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
                          prev.map((u, i) =>
                            i === idx ? { ...u, type: e.target.value as 'A' | 'F' } : u
                          )
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
            <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-400">
              {(Object.keys(UPDATE_TYPE_LABEL) as (keyof typeof UPDATE_TYPE_LABEL)[]).map((t) => (
                <span key={t} className="inline-flex items-center gap-1">
                  <span
                    className={`inline-flex w-4 justify-center rounded border py-0.5 font-mono font-medium ${
                      t === 'A'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-amber-200 bg-amber-50 text-amber-700'
                    }`}
                  >
                    {t}
                  </span>
                  {UPDATE_TYPE_LABEL[t]}
                </span>
              ))}
            </div>
          </section>

          {/* 底部操作 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Info className="h-3 w-3" style={{ strokeWidth: 1.5 }} />
              <span>创建后状态为草稿，可编辑分支与版本号，随后生成发布说明</span>
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

      {/* 步骤 2/3：预览发布说明 + 提交审批 */}
      {currentStep >= 1 && createdRelease && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <section className="tech-card rounded-xl p-5">
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg icon-violet">
                  <Tag className="h-3.5 w-3.5" style={{ strokeWidth: 1.5 }} />
                </div>
                <h3 className="text-[14px] font-semibold text-slate-900">版本信息</h3>
              </div>
              <dl className="space-y-2.5 text-[13px]">
                <InfoRow label="版本号" value={createdRelease.version || '-'} mono />
                <InfoRow label="Tag 名" value={createdRelease.tag_name || '-'} mono />
                <InfoRow label="发布类型" value={releaseTypeText[createdRelease.release_type]} />
                <InfoRow label="分支" value={createdRelease.branch} mono />
                <InfoRow label="Git Hash" value={createdRelease.git_hash?.slice(0, 12) || '-'} mono />
              </dl>
            </section>

            <section className="tech-card rounded-xl p-5">
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg icon-emerald">
                  <ListChecks className="h-3.5 w-3.5" style={{ strokeWidth: 1.5 }} />
                </div>
                <h3 className="text-[14px] font-semibold text-slate-900">发布说明</h3>
              </div>
              {generateDocMutation.isPending && (
                <p className="text-[13px] text-slate-400">生成中…</p>
              )}
              {releaseDoc && (
                <div className="space-y-3 text-[13px]">
                  <div>
                    <span className="text-slate-400">变更类型：</span>
                    <span className="text-slate-700">{releaseDoc.change_type || '-'}</span>
                  </div>
                  <div>
                    <p className="mb-1 font-medium text-slate-600">更新内容：</p>
                    {(releaseDoc.updates || []).length === 0 ? (
                      <p className="text-slate-400">无</p>
                    ) : (
                      <ul className="space-y-1">
                        {(releaseDoc.updates || []).map((u, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-slate-700">
                            <span
                              className={`mt-0.5 inline-flex w-4 shrink-0 justify-center rounded border py-0.5 font-mono text-[10px] font-medium ${
                                u.type === 'A'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                  : 'border-amber-200 bg-amber-50 text-amber-700'
                              }`}
                            >
                              {u.type || '-'}
                            </span>
                            <span>{u.content || '-'}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </section>
          </div>

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

/** 带左侧图标的 antd Select 封装 */
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

/** 发布类型卡片单选 */
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

/** 信息行 */
function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-400">{label}</dt>
      <dd className={`text-slate-700 ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}
