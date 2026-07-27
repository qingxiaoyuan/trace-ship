import { useMemo, useState } from 'react';
import { FolderGit2, FolderOpen, Package as PackageIcon } from 'lucide-react';
import { SvnBrowserDrawer } from '@/components/SvnBrowserDrawer';
import type { PackageConfig } from '@/types';

interface SvnArtifactsPanelProps {
  /** 已过滤出启用 SVN 推送的打包配置 */
  configs: PackageConfig[];
  isLoading: boolean;
  /** 是否按仓库分组展示（项目详情页使用） */
  groupByRepo?: boolean;
}

/**
 * SVN 制品配置面板
 *
 * 列出启用了 SVN 推送的打包配置及其制品目录（svn_url），点击「浏览」打开 SvnBrowserDrawer 实时查看目录内容。
 */
export function SvnArtifactsPanel({ configs, isLoading, groupByRepo = false }: SvnArtifactsPanelProps) {
  const [browsing, setBrowsing] = useState<PackageConfig | null>(null);

  // 按仓库名分组（保持配置原有顺序）
  const groups = useMemo(() => {
    if (!groupByRepo) return [{ repoName: '', items: configs }];
    const map = new Map<string, PackageConfig[]>();
    for (const config of configs) {
      const key = config.repository_name || '未关联仓库';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(config);
    }
    return Array.from(map.entries()).map(([repoName, items]) => ({ repoName, items }));
  }, [configs, groupByRepo]);

  if (isLoading) {
    return <div className="px-5 py-12 text-center text-[13px] text-slate-400">加载中…</div>;
  }

  if (configs.length === 0) {
    return (
      <div className="px-5 py-12 text-center">
        <PackageIcon className="mx-auto h-10 w-10 text-slate-300" strokeWidth={1.5} />
        <p className="mt-3 text-[13px] text-slate-400">暂无启用 SVN 推送的打包配置</p>
        <p className="mt-1 text-[12px] text-slate-300">在打包配置中开启「SVN 产物推送」后即可在此浏览制品目录</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.repoName || 'default'}>
          {groupByRepo && (
            <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-slate-500">
              <FolderGit2 className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />
              {group.repoName}
              <span className="text-slate-300">（{group.items.length}）</span>
            </div>
          )}
          <div className="divide-y divide-indigo-50/50 rounded-lg border border-indigo-100">
            {group.items.map((config) => (
              <div
                key={config.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-indigo-50/30"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg icon-amber">
                  <FolderOpen className="h-4 w-4" strokeWidth={1.5} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-slate-900">{config.name}</span>
                    {!config.is_active && (
                      <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
                        已停用
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-slate-400">
                    <span className="truncate font-mono">{config.svn_url}</span>
                    {config.svn_path_template && (
                      <>
                        <span className="h-1 w-1 rounded-full bg-slate-300" />
                        <span className="font-mono">目录模板 {config.svn_path_template}</span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setBrowsing(config)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
                >
                  <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.5} />
                  浏览
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      <SvnBrowserDrawer
        open={!!browsing}
        config={browsing}
        onClose={() => setBrowsing(null)}
      />
    </div>
  );
}
