import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ExternalLink, Rocket, Search, Tag } from 'lucide-react';
import dayjs from 'dayjs';
import { releaseApi } from '@/api/release';
import { projectApi } from '@/api/project';
import {
  RepositoryTreeTable,
  type RepositoryTreeColumn,
  type RepositoryTreeGroup,
} from '@/components/RepositoryTreeTable';
import { StatusTag, type StatusType } from '@/components/StatusTag';
import { getAvatarColor } from '@/utils/avatar';
import type { ProductComponent, Release } from '@/types';

const typeDisplay: Record<string, { status: StatusType; text: string }> = {
  formal: { status: 'indigo', text: '正式' },
  rc: { status: 'info', text: 'RC' },
  beta: { status: 'warning', text: 'Beta' },
};

/** 移动端发布类型软底色徽标 */
const mobileTypeBadge: Record<string, string> = {
  formal: 'bg-indigo-50 text-indigo-600',
  rc: 'bg-cyan-50 text-cyan-700',
  beta: 'bg-amber-50 text-amber-600',
};

const emptyReleases: Release[] = [];
const emptyProductComponents: ProductComponent[] = [];

interface ReleaseGroupMeta {
  currentVersion: string;
  latestReleasedAt?: string;
}

interface ReleaseTabProps {
  /** 产品维度过滤（产品详情页使用） */
  projectId?: string;
  /** 仓库维度过滤（仓库详情页「发布版本」Tab 使用） */
  repositoryId?: string;
}

const getReleaseSearchText = (item: Release) =>
  `${item.version || ''} ${item.tag_name || ''} ${item.redmine_url || ''} ${item.publisher_name || ''} ${item.release_type_display || ''}`;

const releaseTreeColumns: RepositoryTreeColumn<Release, ReleaseGroupMeta>[] = [
  {
    key: 'tag',
    title: 'Tag',
    width: '1.8fr',
    renderItem: (item) => (
      <span className="block truncate font-mono text-[12px] text-slate-600" title={item.tag_name || '-'}>
        {item.tag_name || '-'}
      </span>
    ),
    renderGroup: (group) => (
      <span>
        当前版本{' '}
        <strong className="font-mono font-semibold text-indigo-600">
          {group.meta?.currentVersion || '尚未发布'}
        </strong>
      </span>
    ),
  },
  {
    key: 'type',
    title: '发布类型',
    width: '1.1fr',
    renderItem: (item) => {
      const config = typeDisplay[item.release_type] || {
        status: 'neutral' as StatusType,
        text: item.release_type || '-',
      };
      return <StatusTag status={config.status}>{config.text}</StatusTag>;
    },
    renderGroup: (group) => `${group.items.length} 个版本`,
  },
  {
    key: 'publisher',
    title: '发布人',
    width: '1.2fr',
    renderItem: (item) => item.publisher_name || item.publisher || '-',
    renderGroup: (group) => (group.items.length ? '已发布' : '暂无版本'),
  },
  {
    key: 'releasedAt',
    title: '发布时间',
    width: '1.35fr',
    renderItem: (item) => (
      <span className="text-slate-500">
        {item.released_at ? dayjs(item.released_at).format('YYYY-MM-DD HH:mm') : '-'}
      </span>
    ),
    renderGroup: (group) => (
      <span className="text-slate-500">
        {group.meta?.latestReleasedAt
          ? dayjs(group.meta.latestReleasedAt).format('YYYY-MM-DD HH:mm')
          : '-'}
      </span>
    ),
  },
  {
    key: 'action',
    title: '操作',
    width: '.45fr',
    align: 'right',
    renderItem: () => <ChevronRight className="ml-auto h-4 w-4 text-slate-300" strokeWidth={1.5} />,
    renderGroup: () => <ChevronRight className="ml-auto h-4 w-4 text-slate-300" strokeWidth={1.5} />,
  },
];

function renderReleasePrimary(item: Release) {
  return (
    <>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500">
        <Rocket className="h-3.5 w-3.5" strokeWidth={1.5} />
      </span>
      <span className="truncate font-mono text-[13px] text-slate-900">{item.version || '-'}</span>
      {item.redmine_url ? (
        <span
          title="已关联 Redmine 任务"
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600"
        >
          <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
          Redmine
        </span>
      ) : null}
    </>
  );
}

function renderMobileRelease(item: Release) {
  const config = typeDisplay[item.release_type] || {
    status: 'neutral' as StatusType,
    text: item.release_type || '-',
  };
  const publisherLabel = item.publisher_name || item.publisher || '-';
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-mono text-[15px] font-semibold tracking-tight text-slate-900">
            {item.version || '-'}
          </span>
          {item.redmine_url ? (
            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-indigo-500" strokeWidth={1.5} />
          ) : null}
        </span>
        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${mobileTypeBadge[item.release_type] || 'bg-slate-100 text-slate-500'}`}>
          {config.text}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
        <Tag className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        <span className="truncate font-mono">{item.tag_name || '-'}</span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-indigo-50 pt-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold text-white"
            style={{ background: getAvatarColor(publisherLabel) }}
          >
            {publisherLabel.charAt(0)}
          </span>
          <span className="truncate text-[11px] text-slate-500">
            {publisherLabel} · {item.released_at ? dayjs(item.released_at).format('MM-DD HH:mm') : '-'}
          </span>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" strokeWidth={1.5} />
      </div>
    </>
  );
}

function buildReleaseGroups(
  releases: Release[],
  components: ProductComponent[],
): RepositoryTreeGroup<Release, ReleaseGroupMeta>[] {
  const releasesByRepository = new Map<string, Release[]>();
  releases.forEach((release) => {
    const repositoryKey = release.repository || `legacy:${release.repository_name || 'unknown'}`;
    const current = releasesByRepository.get(repositoryKey);
    if (current) current.push(release);
    else releasesByRepository.set(repositoryKey, [release]);
  });

  const linkedRepositoryIds = new Set<string>();
  const uniqueComponents = components.filter((component) => {
    const repositoryId = component.repository_detail.id;
    if (linkedRepositoryIds.has(repositoryId)) return false;
    linkedRepositoryIds.add(repositoryId);
    return true;
  });
  const groups: RepositoryTreeGroup<Release, ReleaseGroupMeta>[] = uniqueComponents.map((component) => {
    const repository = component.repository_detail;
    const items = releasesByRepository.get(repository.id) || [];
    return {
      id: repository.id,
      name: repository.name,
      description: repository.external_identity || repository.url,
      searchText: `${component.default_branch} ${component.current_tag || ''}`,
      items,
      meta: {
        currentVersion: items[0]?.version || component.current_version || '尚未发布',
        latestReleasedAt: items[0]?.released_at,
      },
    };
  });

  releasesByRepository.forEach((items, repositoryKey) => {
    if (linkedRepositoryIds.has(repositoryKey)) return;
    groups.push({
      id: repositoryKey,
      name: items[0]?.repository_name || '未知仓库',
      description: '历史发布记录',
      items,
      meta: {
        currentVersion: items[0]?.version || '尚未发布',
        latestReleasedAt: items[0]?.released_at,
      },
    });
  });

  return groups;
}

/** 仓库详情保留单仓库扁平版本列表，避免重复展示一层仓库节点。 */
function RepositoryReleaseList({ releases, loading }: { releases: Release[]; loading: boolean }) {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const filteredList = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) return releases;
    return releases.filter((item) => getReleaseSearchText(item).toLowerCase().includes(normalizedKeyword));
  }, [keyword, releases]);

  return (
    <div className="tech-card overflow-hidden rounded-xl">
      <div className="flex flex-wrap items-center gap-2 border-b border-indigo-50 px-5 py-3">
        <div className="relative w-full sm:w-auto">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" strokeWidth={1.5} />
          <input
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索版本号 / Tag / Redmine"
            className="w-full rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:w-[220px]"
          />
        </div>
        <div className="ml-auto text-[12px] text-slate-400">共 {filteredList.length} 个版本</div>
      </div>

      <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
        <div className="col-span-3">版本号</div><div className="col-span-2">Tag</div><div className="col-span-2">发布类型</div><div className="col-span-2">发布人</div><div className="col-span-2">发布时间</div><div className="col-span-1 text-right">操作</div>
      </div>

      <div className="divide-y divide-indigo-50/50 max-h-[calc(100vh-300px)] overflow-y-auto max-md:space-y-3 max-md:divide-y-0 max-md:p-3 max-md:max-h-none">
        {loading ? (
          <div className="px-5 py-12 text-center text-[13px] text-slate-400">加载中…</div>
        ) : filteredList.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-5 py-16"><Rocket className="h-8 w-8 text-slate-300" strokeWidth={1.5} /><span className="text-[13px] text-slate-400">暂无已发布版本</span></div>
        ) : filteredList.map((item) => {
          const config = typeDisplay[item.release_type] || { status: 'neutral' as StatusType, text: item.release_type || '-' };
          const publisherLabel = item.publisher_name || item.publisher || '-';
          return (
            <button key={item.id} type="button" onClick={() => navigate(`/releases/${item.id}`)} className="block w-full text-left transition-colors hover:bg-indigo-50/30 max-md:rounded-xl max-md:border max-md:border-indigo-100/70 max-md:bg-white max-md:p-4">
              <div className="hidden grid-cols-12 items-center gap-3 px-5 py-3 md:grid">
                <div className="col-span-3 flex items-center gap-2">{renderReleasePrimary(item)}</div>
                <div className="col-span-2 truncate font-mono text-[12px] text-slate-600">{item.tag_name || '-'}</div>
                <div className="col-span-2"><StatusTag status={config.status}>{config.text}</StatusTag></div>
                <div className="col-span-2 text-[13px] text-slate-700">{publisherLabel}</div>
                <div className="col-span-2 text-[13px] text-slate-500">{item.released_at ? dayjs(item.released_at).format('YYYY-MM-DD HH:mm') : '-'}</div>
                <div className="col-span-1 flex justify-end"><ChevronRight className="h-4 w-4 text-slate-300" strokeWidth={1.5} /></div>
              </div>
              <div className="md:hidden">{renderMobileRelease(item)}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ReleaseTab({ projectId, repositoryId }: ReleaseTabProps) {
  const navigate = useNavigate();
  const { data, isLoading: releasesLoading } = useQuery({
    queryKey: ['release-tab', projectId || '', repositoryId || ''],
    queryFn: () => releaseApi.getReleases({
      project: projectId || undefined,
      repository: repositoryId || undefined,
      status: 'released',
      page_size: 1000,
    }),
    enabled: !!(projectId || repositoryId),
  });
  const { data: componentData, isLoading: componentsLoading } = useQuery({
    queryKey: ['product-components', projectId],
    queryFn: () => projectApi.getComponents(projectId || ''),
    enabled: !!projectId,
  });

  const releases = data?.results || emptyReleases;
  const components = componentData || emptyProductComponents;
  const groups = useMemo(
    () => buildReleaseGroups(releases, components),
    [components, releases],
  );

  if (repositoryId) {
    return <RepositoryReleaseList releases={releases} loading={releasesLoading} />;
  }

  return (
    <RepositoryTreeTable<Release, ReleaseGroupMeta>
      groups={groups}
      columns={releaseTreeColumns}
      getItemId={(item) => item.id}
      getItemSearchText={getReleaseSearchText}
      renderItemPrimary={renderReleasePrimary}
      renderMobileItem={renderMobileRelease}
      renderMobileGroupSummary={(group) => (
        <>
          <strong className="block font-mono font-semibold text-indigo-600">
            {group.meta?.currentVersion || '尚未发布'}
          </strong>
          <span className="mt-0.5 block text-[10px] text-slate-400">{group.items.length} 个版本</span>
        </>
      )}
      onItemClick={(item) => navigate(`/releases/${item.id}`)}
      loading={releasesLoading || componentsLoading}
      searchPlaceholder="搜索仓库、版本号、Tag 或 Redmine"
      emptyText="暂无关联仓库或已发布版本"
      itemLabel="个版本"
    />
  );
}
