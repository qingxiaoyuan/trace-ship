import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Empty, Form, Modal, Popconfirm, Select, Spin, Tag } from 'antd';
import { softwareApi, type ProjectSoftware } from '@/api/software';
import { PermissionAlert } from '@/components/PermissionAlert';
import { useProjectRole } from '@/hooks/useProjectRole';
import { useAuthStore } from '@/stores/authStore';
import type { Project } from '@/types';

function selectionStatus(row: ProjectSoftware) {
  if (!row.is_active) return '已停止选用';
  if (!row.software.is_active) return '软件已停用';
  return row.is_usable ? '使用中' : '当前不可用';
}

export function ProjectSoftwareTab({ project }: { project: Project }) {
  const userId = useAuthStore((state) => state.user?.id);
  const { canManage } = useProjectRole(project);
  const active = project.status === 1 || project.status === 'active';
  const [selecting, setSelecting] = useState(false);
  const projectId = project.id;
  const baseKey = ['project-software', userId, projectId];
  const queryClient = useQueryClient();
  const selected = useQuery({
    queryKey: baseKey,
    queryFn: () => softwareApi.listProject(projectId),
  });
  const candidates = useQuery({
    queryKey: [...baseKey, 'available'],
    queryFn: () => softwareApi.available(projectId),
    enabled: selecting && canManage,
  });
  const mutation = useMutation({
    mutationFn: (selection: { newSoftware: string } | { row: ProjectSoftware }) => (
      'row' in selection
        ? softwareApi.setSelection(projectId, selection.row.id, !selection.row.is_active)
        : softwareApi.choose(projectId, selection.newSoftware)
    ),
    onSuccess: async () => {
      setSelecting(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: baseKey }),
        queryClient.invalidateQueries({ queryKey: ['software-directory'] }),
        queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['release-tab', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['release-software-filter'] }),
      ]);
    },
  });

  return (
    <div className="min-w-0 space-y-4">
      {canManage && active && (
        <Button type="primary" className="min-h-9" onClick={() => { mutation.reset(); setSelecting(true); }}>选用已有软件</Button>
      )}
      <PermissionAlert error={selected.error} />
      <Spin spinning={selected.isPending}>
        {selected.isSuccess && selected.data.length === 0 && <Empty description="当前项目尚未选用软件" />}
        {Boolean(selected.data?.length) && (
          <ul className="divide-y divide-slate-100">
            {selected.data?.map((row) => (
              <li key={row.id} className="flex flex-col gap-3 py-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="m-0 break-all text-sm font-semibold text-slate-900">{row.software.name}</h2>
                    <Tag color={row.is_usable ? 'green' : 'default'}>
                      {selectionStatus(row)}
                    </Tag>
                  </div>
                  <div className="break-all text-xs text-slate-600">
                    <code>{row.software.slug}</code> ·{' '}
                    {row.can_view_repository ? (
                      <Link className="text-indigo-600" to={`/repositories/${row.software.repository}/software`}>
                        {row.software.repository_name}
                      </Link>
                    ) : row.software.repository_name}
                  </div>
                </div>
                {canManage && (
                  <Popconfirm
                    title={row.is_active ? '停止选用此软件' : '恢复选用此软件'}
                    description={row.is_active ? '停止后，历史选用仍可查阅。' : undefined}
                    okText={row.is_active ? '确认停止' : '确认恢复'}
                    cancelText="取消"
                    onConfirm={() => { mutation.mutate({ row }); }}
                  >
                    <Button
                      className="min-h-9 w-fit"
                      disabled={mutation.isPending || (!row.is_active && (!active || !row.software.is_active))}
                    >
                      {row.is_active ? '停止选用' : '恢复选用'}
                    </Button>
                  </Popconfirm>
                )}
              </li>
            ))}
          </ul>
        )}
      </Spin>
      {!selecting && <PermissionAlert error={mutation.error} errorTitle="更新选用状态失败" />}
      {selecting && canManage && (
        <Modal title="选用软件" open footer={null} onCancel={() => setSelecting(false)}>
          <PermissionAlert error={candidates.error} />
          <Form<{ software: string }> layout="vertical" onFinish={({ software }) => mutation.mutate({ newSoftware: software })}>
            <Form.Item label="候选软件" name="software" rules={[{ required: true, message: '请选择软件' }]}>
              <Select
                aria-label="候选软件"
                showSearch={{ optionFilterProp: 'label' }}
                loading={candidates.isPending}
                options={candidates.data?.map((item) => ({
                  value: item.id,
                  label: `${item.name} · ${item.slug} · ${item.repository_name}`,
                }))}
                notFoundContent="没有可选软件，请先关联主仓库并确认软件已启用。"
              />
            </Form.Item>
            <PermissionAlert error={mutation.error} errorTitle="选用失败" className="mb-3" />
            <div className="flex justify-end gap-2">
              <Button className="min-h-9" onClick={() => setSelecting(false)}>取消</Button>
              <Button type="primary" htmlType="submit" className="min-h-9" loading={mutation.isPending}>选用</Button>
            </div>
          </Form>
        </Modal>
      )}
    </div>
  );
}
