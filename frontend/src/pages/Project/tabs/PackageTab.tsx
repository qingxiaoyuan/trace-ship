import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { packageApi } from '@/api/package';
import { projectApi } from '@/api/project';
import { PermissionAlert } from '@/components/PermissionAlert';
import { PackageConfigModal } from '@/components/PackageConfigModal';
import { PackageTriggerModal } from '@/components/PackageTriggerModal';
import { ConfigList } from '@/pages/Package/components/ConfigList';
import { fetchAllPages } from '@/pages/Package/components/boardData';
import { useMaintainedSoftware } from '@/hooks/useMaintainedSoftware';
import { useProjectRole } from '@/hooks/useProjectRole';
import type { PackageConfig } from '@/types';

interface PackageTabProps {
  projectId: string;
  active?: boolean;
}


export function PackageTab({ projectId, active = true }: PackageTabProps) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [editing, setEditing] = useState<PackageConfig | null>(null);
  const [triggerConfig, setTriggerConfig] = useState<PackageConfig | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['package-configs', projectId],
    queryFn: () =>
      fetchAllPages((page, pageSize) => packageApi.getConfigs({ project: projectId, page, page_size: pageSize })),
    enabled: active && !!projectId,
  });

  // 「最近打包」列：分页拉全量后按配置归并出最新一条（服务端单页上限 100）
  const { data: tasksData } = useQuery({
    queryKey: ['package-tasks', 'project', projectId],
    queryFn: () =>
      fetchAllPages((page, pageSize) => packageApi.getTasks({ project: projectId, page, page_size: pageSize })),
    enabled: active && !!projectId,
  });

  // 项目角色控制打包触发，共享配置的维护权来自软件。
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectApi.getProject(projectId),
    enabled: active && !!projectId,
  });
  const { canTriggerPackage } = useProjectRole(project);
  const canCreate = useMaintainedSoftware(active, projectId).length > 0;

  const deleteMutation = useMutation({
    mutationFn: (id: string) => packageApi.deleteConfig(id),
    onSuccess: () => {
      message.success('删除成功');
      queryClient.invalidateQueries({ queryKey: ['package-configs', projectId] });
    },
  });

  const favoriteMutation = useMutation({
    mutationFn: (config: PackageConfig) => packageApi.toggleFavorite(config.id, config.software ? projectId : undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['package-configs'] });
      queryClient.invalidateQueries({ queryKey: ['package-favorites'] });
    },
    onError: () => {
      message.error('收藏操作失败，请重试');
    },
  });

  const openTrigger = (record: PackageConfig) => {
    setTriggerConfig(record.software ? { ...record, project: projectId } : record);
    setTriggerOpen(true);
  };

  const closeTrigger = () => {
    setTriggerOpen(false);
    setTriggerConfig(null);
  };

  const openEdit = (record: PackageConfig) => {
    setEditing(record);
    setOpen(true);
  };

  const confirmDelete = (record: PackageConfig) => {
    modal.confirm({
      title: '删除打包配置',
      content: `确定删除「${record.name}」吗？`,
      onOk: () => deleteMutation.mutate(record.id),
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[15px] font-semibold text-slate-900">打包配置</div>
        <div className="mt-1 text-[12px] text-slate-500">查看当前项目的打包配置</div>
      </div>

      <PermissionAlert error={error} className="rounded-xl" />

      {/* 与打包看板共用分组列表：搜索、收藏、触发、编辑、删除均走同一呈现口径 */}
      <ConfigList
        configs={data?.results || []}
        tasks={tasksData?.results || []}
        loading={isLoading}
        canCreate={canCreate}
        canUseShared
        canTrigger={canTriggerPackage}
        onNew={() => { setEditing(null); setOpen(true); }}
        onEdit={openEdit}
        onDelete={confirmDelete}
        onTrigger={openTrigger}
        onToggleFavorite={(config) => favoriteMutation.mutate(config)}
      />

      <PackageConfigModal
        open={open}
        editing={editing}
        fixedProjectId={projectId}
        readOnly={
          !!editing &&
          !(editing.can_maintain ?? ['manager', 'software_admin'].includes(editing.my_role || ''))
        }
        onClose={() => {
          setOpen(false);
          setEditing(null);
        }}
      />

      <PackageTriggerModal open={triggerOpen} config={triggerConfig} onClose={closeTrigger} />
    </div>
  );
}
