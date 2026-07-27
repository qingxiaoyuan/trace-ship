import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Empty, Button } from 'antd';
import {
  ChevronRight,
  FolderKanban,
  GitFork,
  Hammer,
  Rocket,
  Users,
} from 'lucide-react';
import dayjs from 'dayjs';
import { TsCard } from '@/components/TsCard';
import { OverviewTab } from './tabs/OverviewTab';
import { RepoTab } from './tabs/RepoTab';
import { MemberTab } from './tabs/MemberTab';
import { RuleTab } from './tabs/RuleTab';
import { WorkflowTab } from './tabs/WorkflowTab';
import { ReleaseTab } from './tabs/ReleaseTab';
import { PackageTab } from './tabs/PackageTab';
import { SvnArtifactsTab } from './tabs/SvnArtifactsTab';
import { projectApi } from '@/api/project';
import type { ProjectStatus } from '@/types';

/** Tab 配置：基本信息 / 仓库 / 成员 / 审批流 / 规则配置 / 发布版本 */
const tabItems = [
  { key: 'overview', label: '基本信息' },
  { key: 'repos', label: '仓库' },
  { key: 'members', label: '成员' },
  { key: 'workflows', label: '审批流' },
  { key: 'packages', label: '打包配置' },
  { key: 'svn', label: 'SVN 制品' },
  { key: 'rules', label: '规则配置' },
  { key: 'releases', label: '发布版本' },
] as const;

/** 详情头统计项 */
const headerStats = [
  { key: 'repo_count', label: '仓库', icon: GitFork, color: 'text-indigo-400' },
  { key: 'package_count', label: '打包配置', icon: Hammer, color: 'text-cyan-500' },
  { key: 'member_count', label: '成员', icon: Users, color: 'text-violet-500' },
  { key: 'release_count', label: '累计发布', icon: Rocket, color: 'text-emerald-500' },
] as const;

/** 项目状态徽标 */
function StatusBadge({ status }: { status: ProjectStatus }) {
  const active = status === 1 || status === 'active';
  return (
    <span
      className={
        active
          ? 'inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700'
          : 'inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-500'
      }
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
      {active ? '启用' : '停用'}
    </span>
  );
}

export default function ProjectDetail() {
  const { id, tab = 'overview' } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(tab);

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectApi.getProject(id || ''),
    enabled: !!id,
  });

  const handleTabChange = (key: string) => {
    setActiveTab(key);
    navigate(`/projects/${id}/${key}`, { replace: true });
  };

  if (isLoading) {
    return <div className="p-6 text-center text-[13px] text-slate-400">加载中…</div>;
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Empty description="项目不存在" />
        <Button type="primary" className="mt-4" onClick={() => navigate('/projects')}>
          返回项目列表
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5 ts-fade-in-up">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-[13px]">
        <button
          type="button"
          onClick={() => navigate('/projects')}
          className="text-slate-400 transition-colors hover:text-indigo-600"
        >
          项目
        </button>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" strokeWidth={1.5} />
        <span className="font-medium text-slate-800">{project.name}</span>
      </div>

      {/* 详情头 */}
      <div className="tech-card rounded-xl p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl icon-indigo">
              <FolderKanban className="h-6 w-6" strokeWidth={1.5} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">{project.name}</h1>
                <StatusBadge status={project.status} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
                <span className="font-mono">{project.code || '-'}</span>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span>负责人 {project.leader_name || '-'}</span>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span>创建于 {project.created_at ? dayjs(project.created_at).format('YYYY-MM-DD') : '-'}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/releases/create')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[13px] font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
            >
              <Rocket className="h-3.5 w-3.5" strokeWidth={1.5} />
              新建发布
            </button>
          </div>
        </div>
        {/* 统计 */}
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-indigo-50 pt-4 md:grid-cols-4">
          {headerStats.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.key} className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${item.color}`} strokeWidth={1.5} />
                <span className="text-[12px] text-slate-500">{item.label}</span>
                <span className="font-mono text-[13px] font-semibold text-slate-900">
                  {Number(project[item.key as keyof typeof project] ?? 0)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tab 区 */}
      <TsCard bodyStyle={{ padding: 0 }}>
        <div className="scrollbar-thin flex items-center gap-1 overflow-x-auto border-b border-indigo-50 px-4">
          {tabItems.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleTabChange(tab.key)}
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
          {activeTab === 'overview' && <OverviewTab project={project} />}
          {activeTab === 'repos' && <RepoTab projectId={id || ''} />}
          {activeTab === 'members' && <MemberTab projectId={id || ''} />}
          {activeTab === 'workflows' && <WorkflowTab project={project} />}
          {activeTab === 'packages' && <PackageTab projectId={id || ''} />}
          {activeTab === 'svn' && <SvnArtifactsTab projectId={id || ''} />}
          {activeTab === 'rules' && <RuleTab project={project} />}
          {activeTab === 'releases' && <ReleaseTab projectId={id || ''} />}
        </div>
      </TsCard>
    </div>
  );
}
