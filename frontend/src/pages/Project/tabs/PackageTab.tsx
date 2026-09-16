import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Form, Modal, Select } from 'antd';
import {
  Plus,
  Search,
  Pencil,
  Hammer,
  Trash2,
  Container,
  FolderGit2,
  GitFork,
  Package as PackageIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { packageApi } from '@/api/package';
import { releaseApi } from '@/api/release';
import { projectApi } from '@/api/project';
import { PermissionAlert } from '@/components/PermissionAlert';
import { PackageConfigModal } from '@/components/PackageConfigModal';
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
  const [triggerForm] = Form.useForm<{ release_id: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['package-configs', projectId],
    queryFn: () => packageApi.getConfigs({ project: projectId, page_size: 1000 }),
    enabled: !!projectId,
  });

  // 产品内操作权限：配置增删改需 manager，触发打包需 tester/developer/manager
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectApi.getProject(projectId),
    enabled: !!projectId,
  });
  const { canManage, canTriggerPackage } = useProjectRole(project);

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
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" strokeWidth={1.5} />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索名称 / 仓库 / 镜像"
              className="w-full sm:w-[200px] rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
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

        <div className="divide-y divide-indigo-50/50 max-md:divide-y-0 max-md:space-y-3 max-md:p-3">
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
                className="group transition-colors hover:bg-indigo-50/30 max-md:rounded-xl max-md:border max-md:border-indigo-100/70 max-md:bg-white max-md:p-4"
              >
                {/* 桌面端网格行 */}
                <div className="hidden grid-cols-12 items-center gap-3 px-5 py-3 md:grid">
                  <div className="col-span-3 flex items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg icon-indigo">
                      <Container className="h-4 w-4" strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-slate-900">{config.name}</div>
                      <div className="truncate font-mono text-[10px] text-slate-400">
                        {config.build_path || '.'} → {config.output_path || 'dist'}
                      </div>
                    </div>
                  </div>
                  <div className="col-span-2 truncate text-[12px] text-slate-600">{config.repository_name || '-'}</div>
                  <div className="col-span-1">
                    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${config.custom_script ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-cyan-200 bg-cyan-50 text-cyan-700'}`}>
                      {config.custom_script ? '自定义脚本' : '内置脚本'}
                    </span>
                  </div>
                  <div className="col-span-3 truncate font-mono text-[12px] text-slate-500">
                    {config.executor_type === 'remote_node'
                      ? `远程: ${config.node_name || config.node_host || '-'}`
                      : config.image_ref || (config.custom_script ? '自定义脚本' : '-')}
                  </div>
                  <div className="col-span-1 flex items-center justify-center">
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
                  <div className="col-span-1 flex items-center justify-center">
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
                  <div className="col-span-1 flex items-center justify-end gap-1">
                    {canTriggerPackage && (
                      <button
                        type="button"
                        disabled={!config.is_active}
                        onClick={() => openTrigger(config)}
                        className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-indigo-100 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
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

                {/* 移动端卡片（参考 docs/ui/mobile/mobile-release.html） */}
                <div className="md:hidden">
                  <div className="flex items-center justify-between">
                    {config.is_active ? (
                      <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-600">
                        启用
                      </span>
                    ) : (
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
                        停用
                      </span>
                    )}
                    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${config.custom_script ? 'bg-amber-50 text-amber-600' : 'bg-cyan-50 text-cyan-700'}`}>
                      {config.custom_script ? '自定义脚本' : '内置脚本'}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg icon-indigo">
                      <Container className="h-4 w-4" strokeWidth={1.5} />
                    </div>
                    <span className="truncate text-[15px] font-semibold tracking-tight text-slate-900">{config.name}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                    <FolderGit2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                    <span className="truncate font-mono">
                      {config.build_path || '.'} → {config.output_path || 'dist'}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
                    <Container className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                    <span className="truncate font-mono">
                      {config.executor_type === 'remote_node'
                        ? `远程: ${config.node_name || config.node_host || '-'}`
                        : config.image_ref || (config.custom_script ? '自定义脚本' : '-')}
                    </span>
                    {config.auto_package_on_release ? (
                      <span className="shrink-0 rounded bg-emerald-50 px-1 py-px text-[10px] font-medium text-emerald-600">
                        自动
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-indigo-50 pt-3">
                    <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-slate-400">
                      <GitFork className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                      <span className="truncate">{config.repository_name || '-'}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {canTriggerPackage && (
                        <button
                          type="button"
                          disabled={!config.is_active}
                          onClick={() => openTrigger(config)}
                          className="rounded-md p-3 text-slate-400 transition-colors hover:bg-indigo-100 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
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
                            className="rounded-md p-3 text-slate-400 transition-colors hover:bg-indigo-100 hover:text-indigo-600"
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
                            className="rounded-md p-3 text-slate-400 transition-colors hover:bg-rose-100 hover:text-rose-600"
                            title="删除"
                          >
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <PackageConfigModal
        open={open}
        editing={editing}
        fixedProjectId={projectId}
        onClose={() => {
          setOpen(false);
          setEditing(null);
        }}
      />

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
