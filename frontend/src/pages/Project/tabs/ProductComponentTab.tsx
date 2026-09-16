import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { Database, ExternalLink, GitBranch, Link2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { projectApi } from '@/api/project';
import { repositoryApi } from '@/api/repository';
import { PermissionAlert } from '@/components/PermissionAlert';
import { StatusTag } from '@/components/StatusTag';
import { useProjectRole } from '@/hooks/useProjectRole';
import { ProductComponentModal } from '@/pages/Project/modals/ProductComponentModal';
import { RepositoryModal } from '@/pages/Repository/modals/RepositoryModal';
import type { ProductComponent, Repository } from '@/types';

interface ProductComponentTabProps {
  projectId: string;
}

/** 产品仓库页：维护产品与软件仓库的关联及当前产品下的发布设置。 */
export function ProductComponentTab({ projectId }: ProductComponentTabProps) {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState('');
  const [componentModalOpen, setComponentModalOpen] = useState(false);
  const [repositoryModalOpen, setRepositoryModalOpen] = useState(false);
  const [editingComponent, setEditingComponent] = useState<ProductComponent | null>(null);

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectApi.getProject(projectId),
    enabled: !!projectId,
  });
  const { canManage } = useProjectRole(project);

  const { data: components = [], isLoading, error } = useQuery({
    queryKey: ['product-components', projectId],
    queryFn: () => projectApi.getComponents(projectId),
    enabled: !!projectId,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['product-components', projectId] });
    queryClient.invalidateQueries({ queryKey: ['available-product-repositories', projectId] });
    queryClient.invalidateQueries({ queryKey: ['repositories'] });
    queryClient.invalidateQueries({ queryKey: ['project', projectId] });
  };

  const componentMutation = useMutation({
    mutationFn: (values: Partial<ProductComponent>) => editingComponent
      ? projectApi.updateComponent(projectId, editingComponent.id, values)
      : projectApi.createComponent(projectId, values),
    onSuccess: () => {
      message.success(editingComponent ? '仓库设置已更新' : '仓库已关联到产品');
      setComponentModalOpen(false);
      setEditingComponent(null);
      refresh();
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => projectApi.deleteComponent(projectId, id),
    onSuccess: () => {
      message.success('已从产品移除，仓库本身仍保留');
      refresh();
    },
  });

  const createRepositoryMutation = useMutation({
    mutationFn: (values: Partial<Repository>) => repositoryApi.createRepository(values),
    onSuccess: () => {
      message.success('仓库已登记，并自动加入当前产品');
      setRepositoryModalOpen(false);
      refresh();
    },
  });

  const filteredComponents = useMemo(() => {
    const value = keyword.trim().toLowerCase();
    if (!value) return components;
    return components.filter(({ repository_detail: repository }) => (
      repository.name.toLowerCase().includes(value)
      || repository.external_identity.toLowerCase().includes(value)
      || repository.url.toLowerCase().includes(value)
    ));
  }, [components, keyword]);

  const handleRemove = (component: ProductComponent) => {
    const repositoryName = component.repository_detail.name;
    modal.confirm({
      title: '从产品移除仓库',
      content: `将解除「${repositoryName}」与当前产品的关联。仓库本身及其他产品中的设置不会被删除。`,
      okText: '确认移除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => removeMutation.mutateAsync(component.id),
    });
  };

  return (
    <div className="space-y-5 page-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">软件仓库</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            维护当前产品使用的代码仓库。版本属于仓库，多个产品可以发布同一仓库；关联仓库前请先把仓库所有者加入产品成员。
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setRepositoryModalOpen(true)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[13px] font-medium text-indigo-600 hover:bg-indigo-50"
            >
              <Plus className="h-3.5 w-3.5" />
              登记新仓库
            </button>
            <button
              type="button"
              onClick={() => { setEditingComponent(null); setComponentModalOpen(true); }}
              className="btn-glow inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white"
            >
              <Link2 className="h-3.5 w-3.5" />
              关联已有仓库
            </button>
          </div>
        )}
      </div>

      <PermissionAlert error={error} className="rounded-xl" />

      <div className="tech-card overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center gap-2 border-b border-indigo-50 px-5 py-3">
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索仓库名称 / 地址"
              className="w-full rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:w-[240px]"
            />
          </div>
          <div className="ml-auto text-[12px] text-slate-400">共 {filteredComponents.length} 个仓库</div>
        </div>

        <div className="hidden grid-cols-[1.7fr_.9fr_1fr_1.3fr_1.3fr_.8fr_100px] gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
          <div>仓库名称</div>
          <div>默认分支</div>
          <div>当前版本</div>
          <div>打包配置</div>
          <div>凭证状态</div>
          <div>复用情况</div>
          <div className="text-right">操作</div>
        </div>

        <div className="divide-y divide-indigo-50/50 max-md:space-y-3 max-md:p-3">
          {isLoading ? (
            <div className="px-5 py-12 text-center text-[13px] text-slate-400">加载中…</div>
          ) : filteredComponents.length === 0 ? (
            <div className="flex flex-col items-center px-5 py-12 text-[13px] text-slate-400">
              <Database className="mb-2 h-8 w-8 text-slate-300" />
              暂无关联仓库
            </div>
          ) : filteredComponents.map((component) => {
            const repository = component.repository_detail;
            return (
              <div key={component.id} className="hover:bg-indigo-50/30 max-md:rounded-xl max-md:border max-md:border-indigo-100 max-md:bg-white max-md:p-4">
                <div className="hidden grid-cols-[1.7fr_.9fr_1fr_1.3fr_1.3fr_.8fr_100px] items-center gap-3 px-5 py-3 md:grid">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-slate-900">{repository.name}</div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-slate-400">{repository.external_identity || repository.url}</div>
                  </div>
                  <div className="flex items-center gap-1 font-mono text-[12px] text-slate-600">
                    <GitBranch className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{component.default_branch}</span>
                  </div>
                  <div>
                    <div className="font-mono text-[12px] text-slate-700">{component.current_version || '尚未发布'}</div>
                    <div className="truncate font-mono text-[10px] text-slate-400">{component.current_tag || '-'}</div>
                  </div>
                  <div className="truncate text-[12px] text-slate-500" title={(component.package_configs || []).map((item) => item.name).join('、')}>
                    {component.package_configs?.length ? `${component.package_configs.length} 项 · ${component.package_configs[0].name}` : '未配置'}
                  </div>
                  <div>
                    <StatusTag status={component.credential_status === 'available' ? 'success' : component.credential_status === 'expiring' ? 'warning' : 'danger'}>
                      {component.credential_status === 'available' ? '可用' : component.credential_status === 'expiring' ? '即将过期' : '不可用'}
                    </StatusTag>
                    {component.owner_name && (
                      <div className="mt-1 truncate text-[10px] text-slate-400">
                        所有者 {component.owner_name}{component.owner_in_product === false ? ' · 不在成员中' : ''}
                      </div>
                    )}
                  </div>
                  <div className="text-[12px] text-slate-500">{component.product_count} 个产品</div>
                  <div className="flex justify-end gap-1">
                    <button type="button" title="查看仓库" onClick={() => navigate(`/repositories/${repository.id}`)} className="rounded-md p-2 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                    {canManage && (
                      <>
                        <button type="button" title="编辑仓库设置" onClick={() => { setEditingComponent(component); setComponentModalOpen(true); }} className="rounded-md p-2 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" title="从产品移除" onClick={() => handleRemove(component)} className="rounded-md p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="md:hidden">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-semibold text-slate-900">{repository.name}</div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-indigo-500">{repository.external_identity || repository.url}</div>
                    </div>
                    <StatusTag status={component.is_active ? 'success' : 'neutral'}>
                      {component.is_active ? '启用' : '停用'}
                    </StatusTag>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-400">
                    <span className="font-mono">{component.default_branch}</span>
                    <span>{component.product_count} 个产品使用</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                    <span>版本 {component.current_version || '尚未发布'}</span>
                    <span>打包配置 {component.package_configs?.length || 0} 项</span>
                    <span className={component.credential_status === 'available' ? 'text-emerald-600' : 'text-amber-600'}>
                      凭证{component.credential_status === 'available' ? '可用' : component.credential_status === 'expiring' ? '即将过期' : '不可用'}
                    </span>
                  </div>
                  <div className="mt-3 flex justify-end gap-1 border-t border-indigo-50 pt-2">
                    <button type="button" onClick={() => navigate(`/repositories/${repository.id}`)} className="min-h-9 rounded-md px-3 text-[12px] text-indigo-600">查看仓库</button>
                    {canManage && (
                      <>
                        <button type="button" onClick={() => { setEditingComponent(component); setComponentModalOpen(true); }} className="min-h-9 rounded-md px-3 text-[12px] text-slate-600">编辑</button>
                        <button type="button" onClick={() => handleRemove(component)} className="min-h-9 rounded-md px-3 text-[12px] text-rose-600">移除</button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <ProductComponentModal
        open={componentModalOpen}
        projectId={projectId}
        component={editingComponent}
        submitting={componentMutation.isPending}
        onCancel={() => { setComponentModalOpen(false); setEditingComponent(null); }}
        onOk={(values) => componentMutation.mutate(values)}
      />
      <RepositoryModal
        open={repositoryModalOpen}
        repo={null}
        projectId={projectId}
        onCancel={() => setRepositoryModalOpen(false)}
        onOk={(values) => createRepositoryMutation.mutate(values)}
      />
    </div>
  );
}
