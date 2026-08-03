import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  RefreshCw,
  PlayCircle,
  Tag,
  GitFork,
} from 'lucide-react';
import dayjs from 'dayjs';
import { repositoryApi } from '@/api/repository';
import { projectApi } from '@/api/project';
import { StatusTag } from '@/components/StatusTag';
import { PermissionAlert } from '@/components/PermissionAlert';
import { RepositoryModal } from '@/pages/Repository/modals/RepositoryModal';
import { CreateTagModal } from '@/pages/Project/modals/CreateTagModal';
import { useProjectRole } from '@/hooks/useProjectRole';
import type { Repository } from '@/types';

const vendorMap: Record<string, { label: string; status: 'primary' | 'info' | 'neutral' }> = {
  gitlab: { label: 'GitLab', status: 'info' },
};

interface RepoTabProps {
  projectId: string;
}

export function RepoTab({ projectId }: RepoTabProps) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRepo, setEditingRepo] = useState<Repository | null>(null);
  const [tagRepo, setTagRepo] = useState<Repository | null>(null);
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [keyword, setKeyword] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['repositories', projectId],
    queryFn: () =>
      repositoryApi.getRepositories({ project: projectId, page_size: 1000 }),
    enabled: !!projectId,
  });

  // 项目内操作权限：按当前用户的项目成员角色控制按钮可见性
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectApi.getProject(projectId),
    enabled: !!projectId,
  });
  const { canManage, canDevelop } = useProjectRole(project);

  const testMutation = useMutation({
    mutationFn: (id: string) => repositoryApi.testRepository(id),
    onSuccess: (result) => {
      message.success(result.connected ? `连接成功：${result.detail || ''}` : `连接失败：${result.detail || ''}`);
    },
  });

  const syncMutation = useMutation({
    mutationFn: (id: string) => repositoryApi.syncCommits(id),
    onSuccess: () => {
      message.success('同步提交成功');
      queryClient.invalidateQueries({ queryKey: ['repositories', projectId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => repositoryApi.deleteRepository(id),
    onSuccess: () => {
      message.success('删除成功');
      queryClient.invalidateQueries({ queryKey: ['repositories', projectId] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: (values: Partial<Repository> & { id?: string }) => {
      if (values.id) {
        return repositoryApi.updateRepository(values.id, values);
      }
      return repositoryApi.createRepository(values);
    },
    onSuccess: () => {
      message.success('保存成功');
      setModalOpen(false);
      setEditingRepo(null);
      queryClient.invalidateQueries({ queryKey: ['repositories', projectId] });
    },
  });

  const handleDelete = (record: Repository) => {
    modal.confirm({
      title: '确认删除仓库',
      content: `确定要删除仓库「${record.name}」吗？删除后不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => deleteMutation.mutate(record.id),
    });
  };

  const handleEdit = (record: Repository) => {
    setEditingRepo(record);
    setModalOpen(true);
  };

  const handleAdd = () => {
    setEditingRepo(null);
    setModalOpen(true);
  };

  const handleCreateTag = (record: Repository) => {
    setTagRepo(record);
    setTagModalOpen(true);
  };

  const handleTagSuccess = () => {
    setTagModalOpen(false);
    setTagRepo(null);
    queryClient.invalidateQueries({ queryKey: ['repositories', projectId] });
  };

  const handleSave = (values: Partial<Repository>) => {
    if (editingRepo?.id) {
      saveMutation.mutate({ ...values, id: editingRepo.id });
    } else {
      saveMutation.mutate(values);
    }
  };

  const repositories = data?.results || [];
  const filteredRepositories = repositories.filter((r) => {
    const lowerKeyword = keyword.trim().toLowerCase();
    if (!lowerKeyword) return true;
    return (
      r.name?.toLowerCase().includes(lowerKeyword) ||
      r.vendor?.toLowerCase().includes(lowerKeyword)
    );
  });

  return (
    <div className="space-y-5 page-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">仓库管理</h1>
          <p className="mt-1 text-[13px] text-slate-500">管理项目下的代码仓库、同步状态与访问凭证</p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={handleAdd}
            className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
            添加仓库
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
              placeholder="搜索仓库名称 / 类型"
              className="w-[220px] rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div className="ml-auto text-[12px] text-slate-400">共 {filteredRepositories.length} 个仓库</div>
        </div>

        <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
          <div className="col-span-3">仓库名称</div>
          <div className="col-span-1">类型</div>
          <div className="col-span-3">仓库地址</div>
          <div className="col-span-1">默认分支</div>
          <div className="col-span-1">凭证</div>
          <div className="col-span-1">健康状态</div>
          <div className="col-span-1">最后同步</div>
          <div className="col-span-1 text-right">操作</div>
        </div>

        <div className="divide-y divide-indigo-50/50">
          {isLoading ? (
            <div className="px-5 py-12 text-center text-[13px] text-slate-400">加载中…</div>
          ) : filteredRepositories.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-5 py-12 text-[13px] text-slate-400">
              <GitFork className="mb-2 h-8 w-8 text-slate-300" strokeWidth={1.5} />
              暂无仓库
            </div>
          ) : (
            filteredRepositories.map((record) => {
              const vendorConfig = vendorMap[record.vendor] || {
                label: record.vendor?.toUpperCase() || record.repo_type,
                status: 'neutral' as const,
              };
              const isHealthy = record.health_status === 'healthy';

              return (
                <div
                  key={record.id}
                  className="grid grid-cols-12 gap-3 items-center px-5 py-3 transition-colors hover:bg-indigo-50/30"
                >
                  <div className="col-span-3 flex items-center gap-2">
                    <GitFork className="h-4 w-4 text-indigo-500" strokeWidth={1.5} />
                    <span className="truncate text-[13px] font-semibold text-slate-900">{record.name}</span>
                  </div>
                  <div className="col-span-1">
                    <StatusTag status={vendorConfig.status}>{vendorConfig.label}</StatusTag>
                  </div>
                  <div className="col-span-3 truncate text-[13px]">
                    {record.url ? (
                      <a
                        href={record.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline"
                        title={record.url}
                      >
                        {record.url}
                      </a>
                    ) : (
                      '-'
                    )}
                  </div>
                  <div className="col-span-1 font-mono text-[12px] text-slate-600">
                    {record.default_branch || '-'}
                  </div>
                  <div className="col-span-1 text-[12px] text-slate-600">
                    {record.credential_mode || '-'}
                  </div>
                  <div className="col-span-1">
                    <StatusTag status={isHealthy ? 'success' : record.health_status === 'unhealthy' ? 'danger' : 'neutral'}>
                      {isHealthy ? '正常' : record.health_status === 'unhealthy' ? '异常' : record.health_status || '-'}
                    </StatusTag>
                  </div>
                  <div className="col-span-1 text-[12px] text-slate-500">
                    {record.last_sync_at ? dayjs(record.last_sync_at).format('YYYY-MM-DD HH:mm') : '-'}
                  </div>
                  <div className="col-span-1 flex items-center justify-end gap-1">
                    {canDevelop && (
                      <>
                        <button
                          type="button"
                          onClick={() => testMutation.mutate(record.id)}
                          disabled={testMutation.isPending && testMutation.variables === record.id}
                          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-40"
                          title="测试"
                        >
                          <PlayCircle className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </button>
                        <button
                          type="button"
                          onClick={() => syncMutation.mutate(record.id)}
                          disabled={syncMutation.isPending && syncMutation.variables === record.id}
                          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-40"
                          title="同步提交"
                        >
                          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCreateTag(record)}
                          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                          title="新建 Tag"
                        >
                          <Tag className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </button>
                      </>
                    )}
                    {canManage && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleEdit(record)}
                          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                          title="编辑"
                        >
                          <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(record)}
                          disabled={deleteMutation.isPending && deleteMutation.variables === record.id}
                          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                          title="删除"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <RepositoryModal
        open={modalOpen}
        repo={editingRepo}
        projectId={projectId}
        onCancel={() => { setModalOpen(false); setEditingRepo(null); }}
        onOk={handleSave}
      />
      {tagRepo && (
        <CreateTagModal
          open={tagModalOpen}
          projectId={projectId}
          repository={tagRepo}
          onCancel={() => { setTagModalOpen(false); setTagRepo(null); }}
          onSuccess={handleTagSuccess}
        />
      )}
    </div>
  );
}
