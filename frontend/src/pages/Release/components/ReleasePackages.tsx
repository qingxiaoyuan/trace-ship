import { useState } from 'react';
import { Alert, Button, Grid, Select } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { PackageCheck, PackageX, Loader, Clock } from 'lucide-react';
import dayjs from 'dayjs';
import { packageApi } from '@/api/package';
import { projectApi } from '@/api/project';
import type { NormalizedError } from '@/api/request';
import { PermissionAlert } from '@/components/PermissionAlert';
import { useAuthStore } from '@/stores/authStore';
import type { PackageConfig, PackageTaskStatus, Release } from '@/types';

const statusMap: Record<PackageTaskStatus, { text: string; cls: string; icon: typeof Clock }> = {
  queued: { text: '排队中', cls: 'text-slate-500', icon: Clock },
  running: { text: '打包中', cls: 'text-cyan-600', icon: Loader },
  success: { text: '成功', cls: 'text-emerald-600', icon: PackageCheck },
  failure: { text: '失败', cls: 'text-rose-600', icon: PackageX },
  canceled: { text: '已取消', cls: 'text-amber-600', icon: PackageX },
};

/** 只补打当前已发布版本；配置与源码身份均由服务端再次校验。 */
function ReleaseRepackage({ release, desktop }: { release: Release; desktop: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [configId, setConfigId] = useState<string>();
  const project = useQuery({
    queryKey: ['project', release.project],
    queryFn: () => projectApi.getProject(release.project),
    enabled: desktop && !!release.project,
  });
  // 维保职责按目标项目判断，不能用用户其他项目的角色推断本次权限。
  const canRepackage = user?.is_superuser || ['maintainer', 'developer', 'tester', 'manager', 'software_admin']
    .includes(project.data?.my_role || '');
  const configs = useQuery({
    queryKey: ['release-package-configs', release.project, release.repository],
    queryFn: async () => {
      const result: PackageConfig[] = [];
      let page = 1;
      while (true) {
        const data = await packageApi.getConfigs({
          project: release.project, repository: release.repository, is_active: true, page, page_size: 100,
        });
        result.push(...data.results);
        if (!data.results.length || result.length >= data.total) break;
        page += 1;
      }
      return result.filter((config) => config.is_active && config.project_id === release.project
        && config.repository_id === release.repository);
    },
    enabled: desktop && !!canRepackage && !!release.project && !!release.repository,
    retry: false,
  });
  const trigger = useMutation({
    mutationFn: () => packageApi.triggerConfig(configId!, release.id),
    onSettled: (task, error) => {
      const failedTask = (error as NormalizedError | null)?.data as { task_id?: string } | undefined;
      if (!task && !failedTask?.task_id) return;
      // 返回工作台后仍显示本次补打的最新任务和统计，不沿用旧摘要。
      for (const queryKey of [['release', release.id], ['maintainer-releases'], ['maintainer-summary'],
        ['package-tasks'], ['package-favorites'], ['dashboard-package-tasks'], ['package-task-stats']]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
  const failedTaskId = ((trigger.error as NormalizedError | null)?.data as { task_id?: string } | undefined)?.task_id;

  // 切换断点只隐藏入口，保留配置与任务结果，避免恢复桌面后丢失新任务链接。
  if (!desktop) return null;
  if (project.isPending) return <div className="text-[13px] text-slate-400">正在核验补打权限…</div>;
  if (project.error) return <div className="space-y-2">
    <PermissionAlert error={project.error} errorTitle="补打权限加载失败" />
    <Button onClick={() => void project.refetch()}>重试权限核验</Button>
  </div>;
  if (!canRepackage) return null;

  return <section aria-label="补打已发布版本" className="space-y-3 rounded-lg border border-indigo-100 bg-indigo-50/25 p-4">
    <div>
      <h3 className="text-[13px] font-medium text-slate-900">补打已发布版本</h3>
      <p className="mt-1 text-[12px] text-slate-600">当前版本：{release.version} / {release.tag_name}</p>
      <p className="mt-1 text-[12px] text-slate-500">使用已有配置和当前版本源码补打，手动补打不推送 SVN。</p>
    </div>
    {configs.error ? <div className="space-y-2">
      <PermissionAlert error={configs.error} errorTitle="打包配置加载失败" />
      <Button onClick={() => void configs.refetch()}>重试加载配置</Button>
    </div> : <>
      <label htmlFor="release-repackage-config" className="block text-[12px] text-slate-600">打包配置</label>
      <div className="flex items-center gap-2">
        <Select id="release-repackage-config" className="min-w-0 flex-1" virtual={false}
          value={configId} onChange={(value) => { setConfigId(value); trigger.reset(); }}
          loading={configs.isFetching} disabled={trigger.isPending || configs.isPending}
          placeholder="选择已有打包配置" options={(configs.data || []).map((config) => ({ value: config.id, label: config.name }))}
          notFoundContent={configs.isPending ? '加载中…' : '暂无启用的打包配置'} />
        <Button type="primary" loading={trigger.isPending}
          disabled={!configId || !configs.data?.some((config) => config.id === configId)} onClick={() => trigger.mutate()}>
          补打当前版本
        </Button>
      </div>
      {!configs.isPending && !configs.data?.length && <p className="text-[12px] text-slate-500">当前项目的软件暂无启用的打包配置，请联系项目管理员。</p>}
    </>}
    {trigger.error && <PermissionAlert error={trigger.error} errorTitle="补打失败" />}
    {failedTaskId && <Button onClick={() => navigate(`/packages/${failedTaskId}`)}>查看失败任务</Button>}
    {trigger.data && <Alert showIcon type={trigger.data.status === 'failure' ? 'error' : 'success'}
      title={trigger.data.status === 'failure' ? (trigger.data.error_message || '任务已创建，但投递失败') : '已创建补打任务'}
      action={<Button onClick={() => navigate(`/packages/${trigger.data.id}`)}>查看新任务</Button>} />}
  </section>;
}

export function ReleasePackages({ release }: { release: Release }) {
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const tasks = release.package_tasks || [];

  return (
    <div className="space-y-3">
      {release.status === 'released' && <ReleaseRepackage key={release.id} release={release} desktop={!!screens.md} />}
      {!tasks.length && <div className="py-8 text-center text-[13px] text-slate-400">该发布暂无打包任务</div>}
      {tasks.map((task) => {
        const info = statusMap[task.status];
        const Icon = info.icon;
        return (
          <div key={task.id} className="rounded-lg border border-indigo-50 bg-white px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${info.cls}`} strokeWidth={1.5} />
                  <span className="font-medium text-slate-900">{task.name}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[12px] text-slate-500">
                  <span>{task.status_display || info.text}</span>
                  <span>产物 {task.artifact_count} 个</span>
                  <span>{task.created_at ? dayjs(task.created_at).format('YYYY-MM-DD HH:mm') : '-'}</span>
                </div>
              </div>
              <Button size="small" onClick={() => navigate(`/packages/${task.id}`)}>
                查看任务
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
