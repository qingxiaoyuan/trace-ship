import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Empty, Button } from 'antd';
import { ChevronRight, GitBranch, GitCommitHorizontal, GitMerge, Rocket, Tag } from 'lucide-react';
import dayjs from 'dayjs';
import { TsCard } from '@/components/TsCard';
import { PermissionAlert } from '@/components/PermissionAlert';
import { releaseApi } from '@/api/release';
import { releaseTypeText, releaseTypeBadge, statusBadge, releaseStatusText } from './constants';
import { ReleaseTimeline } from './components/ReleaseTimeline';
import { ReleaseCommits } from './components/ReleaseCommits';
import { ReleaseNotes } from './components/ReleaseNotes';
import { ReleasePackages } from './components/ReleasePackages';
import type { ReleaseStatus, ReleaseType } from '@/types';

/** 详情头 Tab */
const tabs = [
  { key: 'commits', label: '关联提交' },
  { key: 'notes', label: '发布说明' },
  { key: 'packages', label: '打包任务' },
] as const;

export default function ReleaseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]['key']>('commits');

  const { data: release, isLoading, error } = useQuery({
    queryKey: ['release', id],
    queryFn: () => releaseApi.getRelease(id || ''),
    enabled: !!id,
  });

  if (isLoading) {
    return <div className="p-6 text-center text-[13px] text-slate-400">加载中…</div>;
  }

  if (error) {
    return (
      <div className="space-y-5 ts-fade-in-up">
        <PermissionAlert error={error} className="rounded-xl" />
      </div>
    );
  }

  if (!release) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Empty description="发布不存在" />
        <Button type="primary" className="mt-4" onClick={() => navigate('/releases')}>
          返回发布看板
        </Button>
      </div>
    );
  }

  const type = release.release_type as ReleaseType;
  const status = release.status as ReleaseStatus;

  return (
    <div className="space-y-5 ts-fade-in-up">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-[13px]">
        <button
          type="button"
          onClick={() => navigate('/releases')}
          className="text-slate-400 transition-colors hover:text-indigo-600"
        >
          发布看板
        </button>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" strokeWidth={1.5} />
        <span className="font-medium text-slate-800">
          {release.version} · {release.project_name || '-'}
        </span>
      </div>

      {/* 详情头 */}
      <div className="tech-card rounded-xl p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl icon-emerald">
              <Rocket className="h-6 w-6" strokeWidth={1.5} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-mono text-[22px] font-semibold tracking-tight text-slate-900">
                  {release.version}
                </h1>
                {type ? (
                  <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${releaseTypeBadge[type]}`}>
                    {releaseTypeText[type]}
                  </span>
                ) : null}
                <span className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${statusBadge[status]}`}>
                  {status === 'pending' ? <span className="h-1.5 w-1.5 rounded-full bg-amber-500 pulse-dot" /> : null}
                  {releaseStatusText[status]}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
                <span>{release.project_name || '-'}</span>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span>发布人 {release.publisher_name || release.publisher || '-'}</span>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span>{release.created_at ? dayjs(release.created_at).format('YYYY-MM-DD HH:mm') : '-'}</span>
              </div>
            </div>
          </div>
        </div>
        {/* 小信息栏 */}
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-indigo-50 pt-4 md:grid-cols-4">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-indigo-400" strokeWidth={1.5} />
            <span className="text-[12px] text-slate-500">分支</span>
            <span className="truncate font-mono text-[13px] font-semibold text-slate-900">
              {release.branch || '-'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <GitCommitHorizontal className="h-4 w-4 text-violet-500" strokeWidth={1.5} />
            <span className="text-[12px] text-slate-500">Tag</span>
            <span className="truncate font-mono text-[13px] font-semibold text-slate-900">
              {release.tag_name || '-'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-emerald-500" strokeWidth={1.5} />
            <span className="text-[12px] text-slate-500">类型</span>
            <span className="text-[13px] font-semibold text-slate-900">
              {type ? releaseTypeText[type] : '-'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <GitMerge className="h-4 w-4 text-cyan-500" strokeWidth={1.5} />
            <span className="text-[12px] text-slate-500">Git Hash</span>
            <span className="truncate font-mono text-[13px] font-semibold text-slate-900">
              {release.git_hash ? release.git_hash.slice(0, 12) : '-'}
            </span>
          </div>
        </div>
        {release.rejected_reason ? (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50/50 p-3 text-[12px] text-rose-600">
            驳回原因：{release.rejected_reason}
          </div>
        ) : null}
      </div>

      {/* 主体：左 Tab 区 + 右发布流程时间线 */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
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
              {activeTab === 'commits' && <ReleaseCommits releaseId={release.id} />}
              {activeTab === 'notes' && <ReleaseNotes release={release} />}
              {activeTab === 'packages' && <ReleasePackages release={release} />}
            </div>
          </TsCard>
        </div>

        {/* 右侧发布流程时间线 */}
        <ReleaseTimeline release={release} />
      </div>
    </div>
  );
}
