import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Form, Input, Modal, Select, Switch, Typography } from 'antd';
import { Button } from 'antd';
import {
  Plus,
  Search,
  Pencil,
  Hammer,
  Trash2,
  Container,
  Package as PackageIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { packageApi } from '@/api/package';
import { releaseApi } from '@/api/release';
import { repositoryApi } from '@/api/repository';
import { projectApi } from '@/api/project';
import { SvnTestButton } from '@/components/SvnTestButton';
import { PermissionAlert } from '@/components/PermissionAlert';
import { ImagePickerField } from '@/components/ImagePickerField';
import { toImageInfo, useAvailableImages } from '@/components/useAvailableImages';
import { credentialApi } from '@/api/credential';
import { useProjectRole } from '@/hooks/useProjectRole';
import type { PackageConfig } from '@/types';

interface PackageTabProps {
  projectId: string;
}


export function PackageTab({ projectId }: PackageTabProps) {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [editing, setEditing] = useState<PackageConfig | null>(null);
  const [triggerConfig, setTriggerConfig] = useState<PackageConfig | null>(null);
  const [keyword, setKeyword] = useState('');
  const [form] = Form.useForm<Partial<PackageConfig>>();
  const [triggerForm] = Form.useForm<{ release_id: string }>();
  const svnPushEnabled = Form.useWatch('svn_push_enabled', form) ?? false;

  const svnUrl = Form.useWatch('svn_url', form);
  const svnCredentialId = Form.useWatch('svn_credential', form);
  const svnPathTemplate = Form.useWatch('svn_path_template', form);

  const { data, isLoading, error } = useQuery({
    queryKey: ['package-configs', projectId],
    queryFn: () => packageApi.getConfigs({ project: projectId, page_size: 1000 }),
    enabled: !!projectId,
  });

  // 项目内操作权限：配置增删改需 manager，触发打包需 tester/developer/manager
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectApi.getProject(projectId),
    enabled: !!projectId,
  });
  const { canManage, canTriggerPackage } = useProjectRole(project);

  const { data: reposData } = useQuery({
    queryKey: ['repositories', projectId],
    queryFn: () => repositoryApi.getRepositories({ project: projectId, repo_type: 'git', page_size: 1000 }),
    enabled: !!projectId,
  });

  const { items: imageItems } = useAvailableImages();

  const { data: svnCredsData } = useQuery({
    queryKey: ['svn-credentials', projectId],
    queryFn: () =>
      credentialApi.getCredentials({
        cred_type: 'svn_password',
        project: projectId,
        is_active: true,
        page_size: 1000,
      }),
    enabled: !!projectId && svnPushEnabled,
  });

  const { data: releasedData, isLoading: releasesLoading } = useQuery({
    queryKey: ['package-trigger-releases', projectId, triggerConfig?.repository],
    queryFn: () =>
      releaseApi.getReleases({
        project: projectId,
        repository: triggerConfig?.repository,
        status: 'released',
        page_size: 1000,
      }),
    enabled: triggerOpen && !!projectId && !!triggerConfig?.repository,
  });

  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.setFieldsValue({
        ...editing,
        image_ref: editing.image_ref || undefined,
      });
    } else {
      form.setFieldsValue({
        project: projectId,
        build_path: '.',
        output_path: 'dist',
        env_vars: {},
        auto_package_on_release: true,
        is_active: true,
        svn_push_enabled: false,
        svn_path_template: '{version}',
      });
    }
  }, [editing, form, open, projectId]);

  const saveMutation = useMutation({
    mutationFn: (values: Partial<PackageConfig>) => {
      const payload = { ...values, project: projectId };
      const ref = values.image_ref;
      const item = ref ? imageItems.find((i) => i.image === ref) : undefined;
      if (item) {
        payload.image_info = toImageInfo(item);
      }
      if (editing) return packageApi.updateConfig(editing.id, payload);
      return packageApi.createConfig(payload);
    },
    onSuccess: () => {
      message.success('保存成功');
      setOpen(false);
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['package-configs', projectId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => packageApi.deleteConfig(id),
    onSuccess: () => {
      message.success('删除成功');
      queryClient.invalidateQueries({ queryKey: ['package-configs', projectId] });
    },
  });

  const triggerMutation = useMutation({
    mutationFn: ({ configId, releaseId }: { configId: string; releaseId: string }) =>
      packageApi.triggerConfig(configId, releaseId),
    onSuccess: (task) => {
      if (task.status === 'failure') {
        message.warning(task.error_message || '打包任务创建成功，但任务投递失败');
      } else {
        message.success('已创建打包任务');
        navigate(`/packages/${task.id}`);
      }
      setTriggerOpen(false);
      setTriggerConfig(null);
      triggerForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['package-tasks'] });
    },
  });

  const rows = useMemo(() => {
    const allRows = data?.results || [];
    if (!keyword.trim()) return allRows;
    const kw = keyword.toLowerCase();
    return allRows.filter(
      (r) =>
        r.name.toLowerCase().includes(kw) ||
        (r.repository_name || '').toLowerCase().includes(kw) ||
        (r.image_name || '').toLowerCase().includes(kw),
    );
  }, [data, keyword]);

  const repoOptions = (reposData?.results || []).map((repo) => ({ label: repo.name, value: repo.id }));
  const svnCredentialOptions = (svnCredsData?.results || []).map((c) => ({ label: c.name, value: c.id }));
  const releaseOptions = (releasedData?.results || []).map((release) => ({
    label: `${release.version} / ${release.tag_name}`,
    value: release.id,
  }));

  const openTrigger = (record: PackageConfig) => {
    setTriggerConfig(record);
    setTriggerOpen(true);
    triggerForm.resetFields();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[15px] font-semibold text-slate-900">打包配置</div>
          <div className="mt-1 text-[12px] text-slate-500">配置发布成功后的自动打包流程</div>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => { setEditing(null); setOpen(true); }}
            className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
            新增配置
          </button>
        )}
      </div>

      <PermissionAlert error={error} className="rounded-xl" />

      <div className="tech-card overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center gap-2 border-b border-indigo-50 px-5 py-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" strokeWidth={1.5} />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索名称 / 仓库 / 镜像"
              className="w-[200px] rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div className="ml-auto text-[12px] text-slate-400">共 {rows.length} 条</div>
        </div>

        <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
          <div className="col-span-3">配置名称</div>
          <div className="col-span-2">仓库</div>
          <div className="col-span-1">模式</div>
          <div className="col-span-3">镜像</div>
          <div className="col-span-1 text-center">自动</div>
          <div className="col-span-1 text-center">状态</div>
          <div className="col-span-1 text-right">操作</div>
        </div>

        <div className="divide-y divide-indigo-50/50">
          {isLoading ? (
            <div className="px-5 py-12 text-center text-[13px] text-slate-400">加载中…</div>
          ) : rows.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <PackageIcon className="mx-auto h-10 w-10 text-slate-300" strokeWidth={1.5} />
              <p className="mt-3 text-[13px] text-slate-400">暂无打包配置</p>
            </div>
          ) : (
            rows.map((config) => (
              <div
                key={config.id}
                className="group grid grid-cols-12 gap-3 items-center px-5 py-3 transition-colors hover:bg-indigo-50/30"
              >
                <div className="col-span-12 flex items-center gap-2.5 md:col-span-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg icon-indigo shrink-0">
                    <Container className="h-4 w-4" strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-slate-900 truncate">{config.name}</div>
                    <div className="font-mono text-[10px] text-slate-400 truncate">
                      {config.build_path || '.'} → {config.output_path || 'dist'}
                    </div>
                  </div>
                </div>
                <div className="col-span-6 text-[12px] text-slate-600 truncate md:col-span-2">{config.repository_name || '-'}</div>
                <div className="col-span-3 md:col-span-1">
                  <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${config.custom_script ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-cyan-200 bg-cyan-50 text-cyan-700'}`}>
                    {config.custom_script ? '自定义脚本' : '内置脚本'}
                  </span>
                </div>
                <div className="col-span-12 text-[12px] text-slate-500 truncate font-mono md:col-span-3">
                  {config.image_ref || (config.custom_script ? '自定义脚本' : '-')}
                </div>
                <div className="col-span-3 flex items-center justify-center md:col-span-1">
                  {config.auto_package_on_release ? (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />开启
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />关闭
                    </span>
                  )}
                </div>
                <div className="col-span-3 flex items-center justify-center md:col-span-1">
                  {config.is_active ? (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />启用
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />停用
                    </span>
                  )}
                </div>
                <div className="col-span-6 flex items-center justify-end gap-1 md:col-span-1">
                  {canTriggerPackage && (
                    <button
                      type="button"
                      disabled={!config.is_active}
                      onClick={() => openTrigger(config)}
                      className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-indigo-100 hover:text-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed"
                      title="立即打包"
                    >
                      <Hammer className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  )}
                  {canManage && (
                    <>
                      <button
                        type="button"
                        onClick={() => { setEditing(config); setOpen(true); }}
                        className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-indigo-100 hover:text-indigo-600"
                        title="编辑"
                      >
                        <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </button>
                      <button
                        type="button"
                        onClick={() => modal.confirm({
                          title: '删除打包配置',
                          content: `确定删除「${config.name}」吗？`,
                          onOk: () => deleteMutation.mutate(config.id),
                        })}
                        className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-rose-100 hover:text-rose-600"
                        title="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <Modal
        title={editing ? '编辑打包配置' : '新增打包配置'}
        open={open}
        width={720}
        onCancel={() => setOpen(false)}
        destroyOnHidden
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>取消</Button>
            {svnPushEnabled && (
              <SvnTestButton
                projectId={projectId}
                svnUrl={svnUrl}
                svnCredentialId={svnCredentialId}
                svnPathTemplate={svnPathTemplate}
              />
            )}
            <Button type="primary" loading={saveMutation.isPending} onClick={() => form.submit()}>
              保存
            </Button>
          </div>
        }
      >
        <Form form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)}>
          <Form.Item name="name" label="配置名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="repository" label="关联仓库" rules={[{ required: true }]}>
            <Select options={repoOptions} />
          </Form.Item>
          <Form.Item name="image_ref" label="打包镜像" rules={[{ required: true, message: '请选择打包镜像' }]}>
            <ImagePickerField />
          </Form.Item>
          <Form.Item name="custom_script" label="自定义打包脚本" extra="留空则执行镜像内置脚本；填写后直接在 /workspace/source 目录执行">
            <Input.TextArea rows={6} placeholder="cd /workspace/source && ./scripts/custom-build.sh" />
          </Form.Item>
          <div className="grid grid-cols-2 gap-3">
            <Form.Item name="build_path" label="构建目录" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="output_path" label="产物目录" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Form.Item name="auto_package_on_release" label="发布后自动打包" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="is_active" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
          <div className="border-t border-slate-100 pt-3">
            <Form.Item name="svn_push_enabled" label="启用 SVN 产物推送" valuePropName="checked">
              <Switch />
            </Form.Item>
            {svnPushEnabled && (
              <>
                <Form.Item
                  name="svn_url"
                  label="SVN 仓库地址"
                  rules={[{ required: true, message: '请输入 SVN 仓库地址' }]}
                >
                  <Input placeholder="svn://192.168.1.100/releases" />
                </Form.Item>
                <Form.Item
                  name="svn_credential"
                  label="SVN 凭证"
                  rules={[{ required: true, message: '请选择 SVN 凭证' }]}
                >
                  <Select
                    options={svnCredentialOptions}
                    placeholder="选择 SVN 凭证"
                    showSearch
                    optionFilterProp="label"
                  />
                </Form.Item>
                <Form.Item name="svn_path_template" label="SVN 目录模板">
                  <Input placeholder="{version}" />
                </Form.Item>
                <Typography.Text type="secondary" className="text-xs">
                  可用占位符:{'{version}'}、{'{tag_name}'}、{'{project_code}'},默认按版本号创建目录
                </Typography.Text>
              </>
            )}
          </div>
        </Form>
      </Modal>

      <Modal
        title="立即打包"
        open={triggerOpen}
        onCancel={() => {
          setTriggerOpen(false);
          setTriggerConfig(null);
          triggerForm.resetFields();
        }}
        onOk={() => triggerForm.submit()}
        confirmLoading={triggerMutation.isPending}
        destroyOnHidden
      >
        <div className="mb-3 rounded-lg border border-indigo-100 bg-indigo-50/40 p-3 text-[12px] text-slate-600">
          <div>打包配置：{triggerConfig?.name || '-'}</div>
          <div>关联仓库：{triggerConfig?.repository_name || '-'}</div>
        </div>
        <Form
          form={triggerForm}
          layout="vertical"
          onFinish={(values) => {
            if (!triggerConfig) return;
            triggerMutation.mutate({ configId: triggerConfig.id, releaseId: values.release_id });
          }}
        >
          <Form.Item name="release_id" label="选择已发布 Tag" rules={[{ required: true, message: '请选择已发布 Tag' }]}>
            <Select
              showSearch
              loading={releasesLoading}
              options={releaseOptions}
              placeholder="选择已发布版本 / Tag"
              optionFilterProp="label"
              notFoundContent={releasesLoading ? '加载中...' : '暂无可打包的已发布 Tag'}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
