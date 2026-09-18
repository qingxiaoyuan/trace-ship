import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Form, Modal, Select } from 'antd';
import { useNavigate } from 'react-router-dom';
import { packageApi } from '@/api/package';
import { releaseApi } from '@/api/release';
import { projectApi } from '@/api/project';
import { PermissionAlert } from '@/components/PermissionAlert';
import { PackageConfigModal } from '@/components/PackageConfigModal';
import { ConfigList } from '@/pages/Package/components/ConfigList';
import { fetchAllPages } from '@/pages/Package/components/boardData';
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
  const [triggerForm] = Form.useForm<{ release_id: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['package-configs', projectId],
    queryFn: () =>
      fetchAllPages((page, pageSize) => packageApi.getConfigs({ project: projectId, page, page_size: pageSize })),
    enabled: !!projectId,
  });

  // 「最近打包」列：分页拉全量后按配置归并出最新一条（服务端单页上限 100）
  const { data: tasksData } = useQuery({
    queryKey: ['package-tasks', 'project', projectId],
    queryFn: () =>
      fetchAllPages((page, pageSize) => packageApi.getTasks({ project: projectId, page, page_size: pageSize })),
    enabled: !!projectId,
  });

  // 项目内操作权限：配置增删改需 manager，触发打包需 tester/developer/manager
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

  const favoriteMutation = useMutation({
    mutationFn: (id: string) => packageApi.toggleFavorite(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['package-configs'] });
      queryClient.invalidateQueries({ queryKey: ['package-favorites'] });
    },
    onError: () => {
      message.error('收藏操作失败，请重试');
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

  const releaseOptions = (releasedData?.results || []).map((release) => ({
    label: `${release.version} / ${release.tag_name}`,
    value: release.id,
  }));

  const openTrigger = (record: PackageConfig) => {
    setTriggerConfig(record);
    setTriggerOpen(true);
    triggerForm.resetFields();
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
        <div className="mt-1 text-[12px] text-slate-500">按仓库分组管理发布成功后的打包流程</div>
      </div>

      <PermissionAlert error={error} className="rounded-xl" />

      {/* 与打包看板共用分组列表：搜索、收藏、触发、编辑、删除均走同一呈现口径 */}
      <ConfigList
        configs={data?.results || []}
        tasks={tasksData?.results || []}
        loading={isLoading}
        canCreate={canManage}
        canTrigger={canTriggerPackage}
        onNew={() => { setEditing(null); setOpen(true); }}
        onEdit={openEdit}
        onDelete={confirmDelete}
        onTrigger={openTrigger}
        onToggleFavorite={(config) => favoriteMutation.mutate(config.id)}
      />

      <PackageConfigModal
        open={open}
        editing={editing}
        fixedProjectId={projectId}
        readOnly={
          !!editing &&
          editing.my_role !== 'manager' &&
          editing.my_role !== 'software_admin'
        }
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
