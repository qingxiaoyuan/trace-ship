import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, ConfigProvider, Form, Input, InputNumber, Modal, Radio, Select, Switch, Typography } from 'antd';
import { Check, ChevronDown, Container, FolderTree, Monitor, Settings2 } from 'lucide-react';
import type { AIGenerateScriptPayload, AIScriptDraft, PackageConfig } from '@/types';
import { projectApi } from '@/api/project';
import { repositoryApi } from '@/api/repository';
import { packageApi } from '@/api/package';
import { credentialApi } from '@/api/credential';
import { useAuthStore } from '@/stores/authStore';
import { SvnTestButton } from '@/components/SvnTestButton';
import { ImagePickerField } from '@/components/ImagePickerField';
import { ScriptEditorField } from '@/components/ScriptEditorField';
import { AIScriptModal } from '@/components/AIScriptModal';
import { toImageInfo, useAvailableImages } from '@/components/useAvailableImages';

interface PackageConfigModalProps {
  open: boolean;
  editing: PackageConfig | null;
  /** 项目内录入时传入：固定项目并隐藏项目选择 */
  fixedProjectId?: string;
  /** 只读查看（无配置维护权限时字段不可编辑，仅供查看模仿） */
  readOnly?: boolean;
  onClose: () => void;
}

/** 分区标题：小字标签 + 细分隔线 */
function SectionLabel({ children, extra }: { children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="mb-3 mt-7 flex items-center gap-2 first:mt-0">
      <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{children}</span>
      <div className="h-px flex-1 bg-slate-100" />
      {extra}
    </div>
  );
}

/** 表单项标签 */
function FieldLabel({ text, required }: { text: string; required?: boolean }) {
  return (
    <span className="text-[12px] font-medium text-slate-600">
      {text}
      {required && <span className="text-rose-500"> *</span>}
    </span>
  );
}

interface ExecutorSegmentProps {
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
}

const EXECUTOR_OPTIONS = [
  { value: 'local_docker', icon: Container, title: '本地 Docker', desc: '镜像内执行 pack.sh' },
  { value: 'remote_windows', icon: Monitor, title: '远程 Windows', desc: 'SSH 下发脚本执行' },
];

/** 执行方式分段选择器 */
function ExecutorSegment({ value, onChange, disabled }: ExecutorSegmentProps) {
  return (
    <div
      className={`grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1.5 ${
        disabled ? 'pointer-events-none opacity-60' : ''
      }`}
    >
      {EXECUTOR_OPTIONS.map((opt) => {
        const selected = value === opt.value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange?.(opt.value)}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all ${
              selected
                ? 'border border-indigo-200 bg-white text-indigo-700 shadow-sm'
                : 'border border-transparent text-slate-500 hover:bg-white hover:text-slate-700'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
            <span className="min-w-0">
              <span className="block text-[12px] font-medium">{opt.title}</span>
              <span className={`block text-[10px] ${selected ? 'text-indigo-400' : 'text-slate-400'}`}>
                {opt.desc}
              </span>
            </span>
            {selected && <Check className="ml-auto h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
          </button>
        );
      })}
    </div>
  );
}

interface ToggleCardProps {
  title: string;
  desc: string;
  name: string;
  /** 额外禁用（如依赖其他开关）；与 Form 级 disabled 合并 */
  disabled?: boolean;
  /** 禁用时替换显示的说明文案 */
  disabledHint?: string;
}

/** 开关卡片：标题 + 说明 + 开关 */
function ToggleCard({ title, desc, name, disabled, disabledHint }: ToggleCardProps) {
  return (
    <div
      className={`flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 transition-colors ${
        disabled ? 'opacity-50' : 'hover:border-slate-300'
      }`}
    >
      <div>
        <div className="text-[12px] font-medium text-slate-700">{title}</div>
        <div className="text-[10px] text-slate-400">{disabled && disabledHint ? disabledHint : desc}</div>
      </div>
      <Form.Item name={name} valuePropName="checked" noStyle>
        <Switch size="small" disabled={disabled} />
      </Form.Item>
    </div>
  );
}

/** 打包配置弹窗（打包看板与项目内录入共用） */
export function PackageConfigModal({ open, editing, fixedProjectId, readOnly, onClose }: PackageConfigModalProps) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((state) => state.user);
  const [form] = Form.useForm<Partial<PackageConfig>>();
  const [aiModalOpen, setAiModalOpen] = useState(false);

  const projectId = Form.useWatch('project', form) ?? fixedProjectId;
  const executorType = Form.useWatch('executor_type', form) ?? 'local_docker';
  const isRemote = executorType === 'remote_windows';
  const autoCollectOutput = Form.useWatch('auto_collect_output', form) ?? false;
  const svnPushEnabled = Form.useWatch('svn_push_enabled', form) ?? false;
  const svnUrl = Form.useWatch('svn_url', form);
  const svnCredentialId = Form.useWatch('svn_credential', form);
  const svnPathTemplate = Form.useWatch('svn_path_template', form);

  const { data: projectsData } = useQuery({
    queryKey: ['package-modal-projects'],
    queryFn: () => projectApi.getProjects({ page: 1, page_size: 1000 }),
    enabled: open && !fixedProjectId,
  });

  // 项目内录入时：所属项目只读展示，需要项目名称
  const { data: fixedProject } = useQuery({
    queryKey: ['package-modal-project', fixedProjectId],
    queryFn: () => projectApi.getProject(fixedProjectId as string),
    enabled: open && !!fixedProjectId,
  });
  const fixedProjectName = editing?.project_name || fixedProject?.name || '';

  const { data: reposData } = useQuery({
    queryKey: ['package-modal-repos', projectId],
    queryFn: () => repositoryApi.getRepositories({ project: projectId, repo_type: 'git', page_size: 1000 }),
    enabled: open && !!projectId,
  });

  const { items: imageItems } = useAvailableImages();

  const { data: nodesData } = useQuery({
    queryKey: ['package-modal-nodes'],
    queryFn: () => packageApi.getNodes({ is_active: true, page_size: 100 }),
    enabled: open && isRemote,
  });

  const { data: svnCredsData } = useQuery({
    queryKey: ['package-modal-svn-creds', projectId],
    queryFn: () =>
      credentialApi.getCredentials({
        cred_type: 'svn_password',
        project: projectId,
        is_active: true,
        page_size: 1000,
      }),
    enabled: open && !!projectId && svnPushEnabled,
  });

  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.setFieldsValue({
        ...editing,
        project: fixedProjectId ?? editing.project,
        image_ref: editing.image_ref || undefined,
      });
    } else {
      form.setFieldsValue({
        project: fixedProjectId,
        executor_type: 'local_docker',
        build_path: '.',
        output_path: 'dist',
        auto_collect_output: false,
        auto_compress: false,
        env_vars: {},
        cpu_cores: 0,
        cpu_priority: '',
        mem_limit_mb: 0,
        auto_package_on_release: true,
        cleanup_workspace: true,
        is_active: true,
        svn_push_enabled: false,
        svn_path_template: '{version}',
        svn_commit_mode: 'new_dir',
        clone_submodules: false,
        inject_git_credential: false,
      });
    }
  }, [editing, form, open, fixedProjectId]);

  const saveMutation = useMutation({
    mutationFn: (values: Partial<PackageConfig>) => {
      const payload: Partial<PackageConfig> = { ...values };
      if (fixedProjectId) payload.project = fixedProjectId;
      if (payload.executor_type === 'remote_windows') {
        // 远程 Windows 不使用镜像；清理本地镜像字段避免后端校验冲突
        payload.image = null;
        delete payload.image_info;
      } else {
        payload.node = null;
        const ref = values.image_ref;
        const item = ref ? imageItems.find((i) => i.image === ref) : undefined;
        if (item) {
          payload.image_info = toImageInfo(item);
        }
      }
      // 未开启自动收集时，自动压缩无意义，统一落库为 false 保持数据干净
      if (!payload.auto_collect_output) {
        payload.auto_compress = false;
      }
      if (editing) return packageApi.updateConfig(editing.id, payload);
      return packageApi.createConfig(payload);
    },
    onSuccess: () => {
      message.success('保存成功');
      onClose();
      queryClient.invalidateQueries({ queryKey: ['package-configs'] });
      queryClient.invalidateQueries({ queryKey: ['package-tasks'] });
    },
  });

  // 打包配置仅项目管理员 / 软件管理员可维护：项目下拉只列出可管理的项目（超管放行）
  const projectOptions = useMemo(
    () =>
      (projectsData?.results || [])
        .filter(
          (p) =>
            currentUser?.is_superuser ||
            p.my_role === 'software_admin' ||
            p.my_role === 'manager',
        )
        .map((p) => ({ label: p.name, value: p.id })),
    [projectsData, currentUser],
  );
  const repoOptions = useMemo(
    () => (reposData?.results || []).map((r) => ({ label: r.name, value: r.id })),
    [reposData],
  );
  const nodeOptions = useMemo(
    () =>
      (nodesData?.results || []).map((n) => ({
        label: `${n.name}（${n.host}）`,
        value: n.id,
      })),
    [nodesData],
  );
  const svnCredentialOptions = useMemo(
    () => (svnCredsData?.results || []).map((c) => ({ label: c.name, value: c.id })),
    [svnCredsData],
  );

  /** 组装当前表单值并调用 AI 生成接口（支持未保存配置） */
  const buildAiPayload = (
    hint: string,
    referenceExemplars: boolean,
  ): AIGenerateScriptPayload => {
    const values = form.getFieldsValue() as Partial<PackageConfig>;
    const project = fixedProjectId ?? values.project;
    const repository = values.repository;
    if (!project || !repository) {
      throw new Error('请先选择项目与关联仓库');
    }
    const ref = values.image_ref;
    const item = ref ? imageItems.find((i) => i.image === ref) : undefined;
    const isRemote = values.executor_type === 'remote_windows';
    const payload: AIGenerateScriptPayload = {
      project,
      repository,
      executor_type: isRemote ? 'remote_windows' : 'local_docker',
      node: isRemote ? values.node : undefined,
      image_ref: isRemote ? undefined : ref,
      image_info: item ? toImageInfo(item) : undefined,
      build_path: values.build_path || '.',
      output_path: values.output_path || 'dist',
      auto_collect_output: !!values.auto_collect_output,
      auto_compress: !!values.auto_compress,
      env_vars: values.env_vars || {},
      custom_script: values.custom_script || '',
      hint,
      reference_exemplars: referenceExemplars,
    };
    return payload;
  };

  const handleAiGenerate = async (
    hint: string,
    referenceExemplars: boolean,
  ): Promise<AIScriptDraft> => {
    return packageApi.aiGenerateScript(buildAiPayload(hint, referenceExemplars));
  };

  /** SSE 流式生成：实时返回 delta / done / error 事件 */
  const handleAiGenerateStream = (hint: string, referenceExemplars: boolean) =>
    packageApi.aiGenerateScriptStream(buildAiPayload(hint, referenceExemplars));

  const handleAiApply = (script: string) => {
    form.setFieldValue('custom_script', script);
    setAiModalOpen(false);
    message.success('已应用到打包脚本，可继续编辑后保存');
  };

  const inputCls =
    'rounded-lg border-slate-200 text-[13px] hover:border-slate-300 focus:border-indigo-500';

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={880}
      centered
      destroyOnHidden
      title={
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-indigo-100 bg-indigo-50 text-indigo-600">
            <Settings2 className="h-4 w-4" strokeWidth={1.5} />
          </div>
          <div>
            <div className="text-[15px] font-semibold tracking-tight text-slate-900">
              {readOnly ? '查看打包配置' : editing ? '编辑打包配置' : '新建打包配置'}
              {readOnly && (
                <span className="ml-2 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                  只读
                </span>
              )}
            </div>
            <div className="text-[11px] font-normal text-slate-400">
              {readOnly
                ? '仅项目管理员或软件管理员可修改，当前为只读查看'
                : editing
                  ? `${editing.name} / ${editing.project_name || '-'}`
                  : '配置发布成功后的打包流程'}
            </div>
          </div>
        </div>
      }
      footer={
        <div className="flex items-center justify-between">
          <div>
            {svnPushEnabled && (
              <SvnTestButton
                projectId={projectId}
                svnUrl={svnUrl}
                svnCredentialId={svnCredentialId}
                svnPathTemplate={svnPathTemplate}
              />
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={onClose}>{readOnly ? '关闭' : '取消'}</Button>
            {!readOnly && (
              <Button
                type="primary"
                loading={saveMutation.isPending}
                onClick={() => form.submit()}
                icon={<Check className="h-3.5 w-3.5" strokeWidth={2} />}
              >
                保存配置
              </Button>
            )}
          </div>
        </div>
      }
      styles={{ body: { maxHeight: '68vh', overflowY: 'auto', paddingRight: 28 } }}
    >
      <ConfigProvider
        theme={{
          components: {
            Form: {
              // 紧凑表单：去掉 Form.Item 默认下边距与 label 默认下padding，行距由 space-y 控制
              itemMarginBottom: 0,
              verticalLabelPadding: '0 0 4px',
            },
          },
        }}
      >
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        disabled={readOnly}
        onFinish={(values) => saveMutation.mutate(values)}
      >
        {/* 基本信息 */}
        <SectionLabel>基本信息</SectionLabel>

        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <Form.Item
              name="name"
              label={<FieldLabel text="配置名称" required />}
              rules={[{ required: true, message: '请输入配置名称' }]}
              className="mb-0"
            >
              <Input placeholder="输入配置名称" className={inputCls} />
            </Form.Item>
            {!fixedProjectId ? (
              <Form.Item
                name="project"
                label={<FieldLabel text="所属项目" required />}
                rules={[{ required: true, message: '请选择项目' }]}
                className="mb-0"
                extra={<p className="mb-0 mt-1 text-[11px] text-slate-400">仅列出你是项目管理员或软件管理员的项目</p>}
              >
                <Select
                  options={projectOptions}
                  placeholder="选择项目"
                  showSearch
                  optionFilterProp="label"
                  suffixIcon={<ChevronDown className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />}
                />
              </Form.Item>
            ) : (
              <Form.Item label={<FieldLabel text="所属项目" />} className="mb-0">
                <Input value={fixedProjectName} disabled className={inputCls} />
              </Form.Item>
            )}
          </div>

          {/* 第二行：执行方式（与下一行额外留 8px） */}
          <Form.Item name="executor_type" label={<FieldLabel text="执行方式" />} className="!mb-2">
            <ExecutorSegment disabled={readOnly} />
          </Form.Item>

          <div className="grid grid-cols-2 gap-3">
            <Form.Item
              name="repository"
              label={<FieldLabel text="关联仓库" required />}
              rules={[{ required: true, message: '请选择仓库' }]}
              className="mb-0"
            >
              <Select
                options={repoOptions}
                placeholder={projectId ? '选择仓库' : '请先选择项目'}
                disabled={!projectId}
                showSearch
                optionFilterProp="label"
                suffixIcon={<ChevronDown className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />}
              />
            </Form.Item>
            {isRemote ? (
              <Form.Item
                name="node"
                label={<FieldLabel text="打包节点" required />}
                rules={[{ required: true, message: '请选择打包节点' }]}
                className="mb-0"
                extra={<p className="mb-0 mt-1 text-[11px] text-slate-400">节点在「系统配置 · 远程打包节点」中维护，可先测试连接</p>}
              >
                <Select
                  options={nodeOptions}
                  placeholder="选择远程 Windows 节点"
                  showSearch
                  optionFilterProp="label"
                  optionRender={(opt) => (
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      {opt.label}
                    </span>
                  )}
                  suffixIcon={<ChevronDown className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />}
                />
              </Form.Item>
            ) : (
              // Form.Item 必须直接包裹 ImagePickerField：value/onChange 只注入直接子组件，
              // 中间隔一层 div 会导致选择结果无法写回表单（镜像不回显）
              <Form.Item
                name="image_ref"
                label={<FieldLabel text="打包镜像" required />}
                rules={[{ required: true, message: '请选择打包镜像' }]}
                className="mb-0"
              >
                <ImagePickerField disabled={readOnly} />
              </Form.Item>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Form.Item
              name="build_path"
              label={<FieldLabel text="构建目录" />}
              rules={[{ required: true }]}
              className="mb-0"
            >
              <Input className={`${inputCls} font-mono text-[12px]`} />
            </Form.Item>
            <Form.Item
              name="output_path"
              label={<FieldLabel text="产物目录" />}
              rules={[{ required: true }]}
              className="mb-0"
            >
              <Input className={`${inputCls} font-mono text-[12px]`} />
            </Form.Item>
          </div>
        </div>

        {/* 打包脚本 */}
        <SectionLabel
          extra={
            <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-amber-600">
              {isRemote ? 'bat' : 'sh'}
            </span>
          }
        >
          打包脚本
        </SectionLabel>

        <Form.Item name="custom_script" noStyle>
          <ScriptEditorField
            lang={isRemote ? 'bat' : 'sh'}
            filename={isRemote ? 'pack-custom.bat' : 'custom-script.sh'}
            readOnly={readOnly}
            onAiGenerate={readOnly ? undefined : () => setAiModalOpen(true)}
            hint={
              isRemote
                ? 'Windows 批处理：BAT 无 set -e，平台按脚本最终退出码判定，失败须逐级返回非零——调用内部脚本后加 "if errorlevel 1 exit /b 1"，内部脚本内关键命令失败也请 "|| exit /b 1"'
                : '留空则执行镜像内置脚本；填写后在 /workspace/source 目录以 sh -ec 执行（遇错即停，编译失败会自动判为打包失败）'
            }
          />
        </Form.Item>

        {/* 高级选项 */}
        <SectionLabel>高级选项</SectionLabel>

        {isRemote && (
          <div className="mb-3 grid grid-cols-3 gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-3">
            <Form.Item
              name="cpu_cores"
              label={<FieldLabel text="CPU 核数" />}
              className="mb-0"
              extra={<p className="mb-0 mt-1 text-[11px] text-slate-400">0 = 跟随节点</p>}
            >
              <InputNumber min={0} max={64} className="w-full" disabled={readOnly} />
            </Form.Item>
            <Form.Item
              name="cpu_priority"
              label={<FieldLabel text="CPU 优先级" />}
              className="mb-0"
              extra={<p className="mb-0 mt-1 text-[11px] text-slate-400">跟随节点默认</p>}
            >
              <Select
                options={[
                  { label: '跟随节点', value: '' },
                  { label: '正常', value: 'normal' },
                  { label: '低于正常', value: 'belownormal' },
                  { label: '低', value: 'low' },
                ]}
                suffixIcon={<ChevronDown className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />}
              />
            </Form.Item>
            <Form.Item
              name="mem_limit_mb"
              label={<FieldLabel text="内存上限 (MB)" />}
              className="mb-0"
              extra={<p className="mb-0 mt-1 text-[11px] text-slate-400">0 = 不限</p>}
            >
              <InputNumber min={0} max={1048576} className="w-full" disabled={readOnly} />
            </Form.Item>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <ToggleCard title="发布后自动打包" desc="推 tag 成功后自动触发" name="auto_package_on_release" />
          <ToggleCard
            title="构建后自动收集产物"
            desc="构建后自动归集产物目录到 artifacts（脚本可不再手动拷贝）"
            name="auto_collect_output"
          />
          <ToggleCard
            title="自动压缩产物"
            desc="打包完成后将产物目录内所有内容压缩为单个 zip 压缩包（软件名-版本-日期）"
            name="auto_compress"
            disabled={readOnly || !autoCollectOutput}
            disabledHint="需先开启「构建后自动收集产物」"
          />
          <ToggleCard
            title="拉取 Git 子模块"
            desc="clone 时递归拉取 .gitmodules 子模块（完整克隆，便于脚本内提交推送）"
            name="clone_submodules"
          />
          <ToggleCard
            title="注入 Git 凭证"
            desc="构建环境注入 GIT_ASKPASS 凭证，打包脚本可自行 git push；凭证对脚本可见，谨慎开启"
            name="inject_git_credential"
          />
          {isRemote && (
            <ToggleCard
              title="打包后清理工作区"
              desc="成功后清理远程节点目录，关闭可保留源码与产物用于调试"
              name="cleanup_workspace"
            />
          )}
          <ToggleCard title="启用配置" desc="停用后不可触发打包" name="is_active" />
        </div>

        {/* SVN 推送 */}
        <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
          <div className="flex items-center justify-between bg-white px-3.5 py-2.5">
            <div className="flex items-center gap-2">
              <FolderTree className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
              <div>
                <div className="text-[12px] font-medium text-slate-700">SVN 产物推送</div>
                <div className="text-[10px] text-slate-400">打包成功后上传产物到 SVN</div>
              </div>
            </div>
            <Form.Item name="svn_push_enabled" valuePropName="checked" noStyle>
              <Switch size="small" />
            </Form.Item>
          </div>
          {svnPushEnabled && (
            <div className="space-y-2 border-t border-slate-100 bg-slate-50/60 px-3.5 py-3.5">
              <div className="grid grid-cols-2 gap-3">
                <Form.Item
                  name="svn_url"
                  label={<FieldLabel text="SVN 仓库地址" required />}
                  rules={[{ required: true, message: '请输入 SVN 仓库地址' }]}
                  className="mb-0"
                >
                  <Input placeholder="svn://192.168.1.100/releases" className={`${inputCls} font-mono text-[12px]`} />
                </Form.Item>
                <Form.Item
                  name="svn_credential"
                  label={<FieldLabel text="SVN 凭证" required />}
                  rules={[{ required: true, message: '请选择 SVN 凭证' }]}
                  className="mb-0"
                >
                  <Select
                    options={svnCredentialOptions}
                    placeholder={projectId ? '选择 SVN 凭证' : '请先选择项目'}
                    disabled={!projectId}
                    showSearch
                    optionFilterProp="label"
                    suffixIcon={<ChevronDown className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />}
                  />
                </Form.Item>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Form.Item name="svn_path_template" label={<FieldLabel text="目录模板" />} className="mb-0">
                  <Input placeholder="{version}" className={`${inputCls} font-mono text-[12px]`} />
                </Form.Item>
                <div className="flex items-end pb-1">
                  <Typography.Text type="secondary" className="text-[11px]">
                    占位符：{'{version}'}、{'{tag_name}'}、{'{project_code}'}、{'{release_type}'}；默认按版本号建目录，RC/测试版自动追加类型后缀
                  </Typography.Text>
                </div>
              </div>
              <Form.Item name="svn_commit_mode" label={<FieldLabel text="提交模式" />} className="mb-0">
                <Radio.Group>
                  <Radio value="new_dir">新建版本目录（目录已存在时报错）</Radio>
                  <Radio value="overwrite">覆盖式提交（目录已存在时镜像覆盖更新，会删除远程多余文件）</Radio>
                </Radio.Group>
              </Form.Item>
            </div>
          )}
        </div>
      </Form>
      </ConfigProvider>
      <AIScriptModal
        open={aiModalOpen}
        lang={isRemote ? 'bat' : 'sh'}
        filename={isRemote ? 'pack-custom.bat' : 'custom-script.sh'}
        onGenerate={handleAiGenerate}
        onGenerateStream={handleAiGenerateStream}
        onApply={handleAiApply}
        onClose={() => setAiModalOpen(false)}
      />
    </Modal>
  );
}
