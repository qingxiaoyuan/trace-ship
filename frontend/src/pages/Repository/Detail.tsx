import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Empty, Button, App } from 'antd';
import { ChevronRight, GitBranch, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { TsCard } from '@/components/TsCard';
import { RepositoryModal } from './modals/RepositoryModal';
import { repositoryApi } from '@/api/repository';
import { useAppMessage } from '@/hooks/useAppMessage';
import { repoTypeBadge, healthDisplay } from './constants';
import { CommitsTab } from './tabs/CommitsTab';
import { BranchesTab } from './tabs/BranchesTab';
import { TagsTab } from './tabs/TagsTab';
import { CredentialTab } from './tabs/CredentialTab';
import type { Repository } from '@/types';

/** 详情 Tab */
const tabs = [
  { key: 'commits', label: '最近提交' },
  { key: 'branches', label: '分支' },
  { key: 'tags', label: '标签' },
  { key: 'credential', label: '凭证配置' },
] as const;

export default function RepositoryDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = useAppMessage();
  const { modal } = App.useApp();
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]['key']>('commits');
  const [modalOpen, setModalOpen] = useState(false);

  const { data: repo, isLoading } = useQuery({
    queryKey: ['repository', id],
    queryFn: () => repositoryApi.getRepository(id || ''),
    enabled: !!id,
  });

  const syncMutation = useMutation({
    mutationFn: () => repositoryApi.syncCommits(id || ''),
    onSuccess: () => {
      message.success('同步成功');
      queryClient.invalidateQueries({ queryKey: ['repository', id] });
      queryClient.invalidateQueries({ queryKey: ['repository-commits', id] });
    },
    onError: () => message.error('同步失败'),
  });

  const handleDelete = () => {
    modal.confirm({
      title: '确认删除仓库',
      content: `确定要删除「${repo?.name}」吗？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      async onOk() {
        try {
          await repositoryApi.deleteRepository(id || '');
          message.success('删除成功');
          navigate('/repositories');
        } catch {
          message.error('删除失败');
        }
      },
    });
  };

  const handleSave = async (values: Partial<Repository>) => {
    try {
      await repositoryApi.updateRepository(id || '', values);
      message.success('保存成功');
      setModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['repository', id] });
    } catch {
      message.error('保存失败');
    }
  };

  if (isLoading) {
    return <div className="p-6 text-center text-[13px] text-slate-400">加载中…</div>;
  }

  if (!repo) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Empty description="仓库不存在" />
        <Button type="primary" className="mt-4" onClick={() => navigate('/repositories')}>
          返回仓库列表
        </Button>
      </div>
    );
  }

  const badge = repoTypeBadge(repo);
  const health = healthDisplay(repo.health_status);

  return (
    <div className="space-y-5 ts-fade-in-up">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-[13px]">
        <button
          type="button"
          onClick={() => navigate('/repositories')}
          className="text-slate-400 transition-colors hover:text-indigo-600"
        >
          仓库
        </button>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" strokeWidth={1.5} />
        <span className="font-medium text-slate-800">{repo.name}</span>
      </div>

      {/* 详情头 */}
      <div className="tech-card rounded-xl p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl icon-indigo">
              <GitBranch className="h-6 w-6" strokeWidth={1.5} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">{repo.name}</h1>
                <span className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${health.cls}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${health.dot}`} />
                  {health.text}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
                <span className={`rounded border px-1 py-0.5 font-mono ${badge.cls}`}>{badge.text}</span>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span>{repo.project_name || '-'}</span>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <a
                  href={repo.clone_url || repo.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-indigo-500 hover:text-indigo-600"
                >
                  {repo.clone_url || repo.url}
                </a>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[13px] font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} strokeWidth={1.5} />
              立即同步
            </button>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[13px] font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
              编辑
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-2 text-[13px] font-medium text-rose-600 transition-colors hover:bg-rose-50"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              删除
            </button>
          </div>
        </div>
      </div>

      {/* Tab 区 */}
      <TsCard bodyStyle={{ padding: 0 }}>
        <div className="scrollbar-thin flex items-center gap-1 overflow-x-auto border-b border-indigo-50 px-4">
          {tabs.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={
                  active
                    ? 'whitespace-nowrap rounded-t-lg border-b-2 border-indigo-600 px-3 py-2.5 text-[13px] font-medium text-indigo-600'
                    : 'whitespace-nowrap rounded-t-lg border-b-2 border-transparent px-3 py-2.5 text-[13px] font-medium text-slate-500 transition-colors hover:text-indigo-600'
                }
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <div className="p-5">
          {activeTab === 'commits' && <CommitsTab repoId={repo.id} />}
          {activeTab === 'branches' && <BranchesTab repoId={repo.id} />}
          {activeTab === 'tags' && <TagsTab repoId={repo.id} repoType={repo.repo_type} />}
          {activeTab === 'credential' && <CredentialTab repo={repo} />}
        </div>
      </TsCard>

      <RepositoryModal
        open={modalOpen}
        repo={repo}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
      />
    </div>
  );
}
