import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ChevronDown, ChevronRight, Database, GitBranch, Search } from 'lucide-react';

export interface RepositoryTreeGroup<T, TMeta = unknown> {
  id: string;
  name: string;
  description?: string;
  searchText?: string;
  items: T[];
  meta?: TMeta;
}

export interface RepositoryTreeColumn<T, TMeta = unknown> {
  key: string;
  title: string;
  width: string;
  align?: 'left' | 'right';
  renderItem: (item: T) => ReactNode;
  renderGroup?: (group: RepositoryTreeGroup<T, TMeta>) => ReactNode;
}

interface RepositoryTreeTableProps<T, TMeta> {
  groups: RepositoryTreeGroup<T, TMeta>[];
  columns: RepositoryTreeColumn<T, TMeta>[];
  getItemId: (item: T) => string;
  getItemSearchText: (item: T) => string;
  renderItemPrimary: (item: T) => ReactNode;
  renderMobileItem: (item: T) => ReactNode;
  renderMobileGroupSummary?: (group: RepositoryTreeGroup<T, TMeta>) => ReactNode;
  onItemClick?: (item: T) => void;
  loading?: boolean;
  primaryTitle?: string;
  primaryWidth?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  itemLabel?: string;
  minTableWidth?: number;
  initialExpandedGroupIds?: string[];
}

interface FilteredRepositoryTreeGroup<T, TMeta> {
  group: RepositoryTreeGroup<T, TMeta>;
  items: T[];
}

/**
 * 可复用的软件仓库二级树表。
 *
 * 一级固定展示仓库，二级内容和列由业务页面传入，因此发布版本、打包任务等场景
 * 可以共享搜索、展开状态和响应式结构，而不需要复制树形交互。
 */
export function RepositoryTreeTable<T, TMeta = unknown>({
  groups,
  columns,
  getItemId,
  getItemSearchText,
  renderItemPrimary,
  renderMobileItem,
  renderMobileGroupSummary,
  onItemClick,
  loading = false,
  primaryTitle = '软件仓库 / 版本号',
  primaryWidth = '2.4fr',
  searchPlaceholder = '搜索仓库或版本',
  emptyText = '暂无数据',
  itemLabel = '条记录',
  minTableWidth = 1040,
  initialExpandedGroupIds,
}: RepositoryTreeTableProps<T, TMeta>) {
  const [keyword, setKeyword] = useState('');
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(
    () => new Set(initialExpandedGroupIds || []),
  );
  const initializedGroupSignatureRef = useRef('');
  const groupSignature = groups.map((group) => group.id).join('|');

  useEffect(() => {
    if (!groups.length || initializedGroupSignatureRef.current === groupSignature) return;
    const validInitialIds = (initialExpandedGroupIds || []).filter((id) =>
      groups.some((group) => group.id === id),
    );
    setExpandedGroupIds(new Set(validInitialIds.length ? validInitialIds : [groups[0].id]));
    initializedGroupSignatureRef.current = groupSignature;
  }, [groupSignature, groups, initialExpandedGroupIds]);

  const normalizedKeyword = keyword.trim().toLowerCase();
  const filteredGroups = useMemo<FilteredRepositoryTreeGroup<T, TMeta>[]>(() => {
    if (!normalizedKeyword) {
      return groups.map((group) => ({ group, items: group.items }));
    }

    return groups.flatMap((group) => {
      const groupMatches = `${group.name} ${group.description || ''} ${group.searchText || ''}`
        .toLowerCase()
        .includes(normalizedKeyword);
      const matchingItems = group.items.filter((item) =>
        getItemSearchText(item).toLowerCase().includes(normalizedKeyword),
      );
      if (!groupMatches && matchingItems.length === 0) return [];
      return [{ group, items: groupMatches ? group.items : matchingItems }];
    });
  }, [getItemSearchText, groups, normalizedKeyword]);

  const visibleItemCount = filteredGroups.reduce((total, current) => total + current.items.length, 0);
  const allExpanded = filteredGroups.length > 0
    && filteredGroups.every(({ group }) => expandedGroupIds.has(group.id));
  const gridTemplateColumns = [primaryWidth, ...columns.map((column) => column.width)].join(' ');

  const isGroupExpanded = (groupId: string) =>
    Boolean(normalizedKeyword) || expandedGroupIds.has(groupId);

  const toggleGroup = (groupId: string) => {
    if (normalizedKeyword) return;
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const toggleAll = () => {
    if (normalizedKeyword) return;
    setExpandedGroupIds((current) => {
      const shouldExpand = filteredGroups.some(({ group }) => !current.has(group.id));
      return shouldExpand
        ? new Set(filteredGroups.map(({ group }) => group.id))
        : new Set();
    });
  };

  return (
    <div className="tech-card overflow-hidden rounded-xl">
      <div className="flex flex-wrap items-center gap-2 border-b border-indigo-50 px-5 py-3">
        <div className="relative w-full sm:w-auto">
          <Search
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
            strokeWidth={1.5}
          />
          <input
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:w-[260px]"
          />
        </div>
        <button
          type="button"
          onClick={toggleAll}
          disabled={Boolean(normalizedKeyword) || filteredGroups.length === 0}
          className="min-h-8 rounded-lg border border-indigo-100 bg-white px-3 text-[12px] text-slate-600 transition-colors hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {normalizedKeyword ? '搜索结果已展开' : allExpanded ? '全部折叠' : '全部展开'}
        </button>
        <div className="ml-auto text-[12px] text-slate-400">
          共 {filteredGroups.length} 个仓库 · {visibleItemCount} {itemLabel}
        </div>
      </div>

      {loading ? (
        <div className="px-5 py-12 text-center text-[13px] text-slate-400">加载中…</div>
      ) : filteredGroups.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 px-5 py-16">
          <Database className="h-8 w-8 text-slate-300" strokeWidth={1.5} />
          <span className="text-[13px] text-slate-400">{emptyText}</span>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <div style={{ minWidth: minTableWidth }}>
              <div
                className="grid gap-3 border-b border-indigo-50 bg-slate-50/50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400"
                style={{ gridTemplateColumns }}
              >
                <div>{primaryTitle}</div>
                {columns.map((column) => (
                  <div key={column.key} className={column.align === 'right' ? 'text-right' : ''}>
                    {column.title}
                  </div>
                ))}
              </div>

              {filteredGroups.map(({ group, items }) => {
                const expanded = isGroupExpanded(group.id);
                return (
                  <section key={group.id} className="border-b border-indigo-100 last:border-b-0">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => toggleGroup(group.id)}
                      className="grid w-full items-center gap-3 bg-indigo-50/45 px-5 py-3 text-left transition-colors hover:bg-indigo-50/80"
                      style={{ gridTemplateColumns }}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        {expanded ? (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-indigo-400" strokeWidth={1.5} />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-indigo-400" strokeWidth={1.5} />
                        )}
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-indigo-200 bg-white text-indigo-500">
                          <GitBranch className="h-4 w-4" strokeWidth={1.5} />
                        </span>
                        <span className="min-w-0">
                          <strong className="block truncate text-[13px] font-semibold text-slate-900">
                            {group.name}
                          </strong>
                          <small className="mt-0.5 block truncate font-mono text-[10px] text-slate-400">
                            {group.description || '-'}
                          </small>
                        </span>
                      </span>
                      {columns.map((column) => (
                        <span
                          key={column.key}
                          className={`min-w-0 text-[12px] text-slate-500 ${column.align === 'right' ? 'text-right' : ''}`}
                        >
                          {column.renderGroup?.(group) || '-'}
                        </span>
                      ))}
                    </button>

                    {expanded && items.length > 0 ? (
                      <div className="relative before:pointer-events-none before:absolute before:bottom-5 before:left-8 before:top-0 before:z-10 before:border-l before:border-indigo-200">
                        {items.map((item) => (
                          <button
                            type="button"
                            key={getItemId(item)}
                            onClick={() => onItemClick?.(item)}
                            className="grid w-full items-center gap-3 border-t border-indigo-50/70 bg-white px-5 py-2.5 text-left transition-colors hover:bg-indigo-50/30"
                            style={{ gridTemplateColumns, contentVisibility: 'auto', containIntrinsicSize: '48px' }}
                          >
                            <span className="relative flex min-w-0 items-center gap-2 pl-10 before:absolute before:left-3 before:top-1/2 before:w-4 before:border-t before:border-indigo-200">
                              {renderItemPrimary(item)}
                            </span>
                            {columns.map((column) => (
                              <span
                                key={column.key}
                                className={`min-w-0 text-[12px] text-slate-600 ${column.align === 'right' ? 'text-right' : ''}`}
                              >
                                {column.renderItem(item)}
                              </span>
                            ))}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          </div>

          <div className="space-y-3 bg-slate-50/60 p-3 md:hidden">
            {filteredGroups.map(({ group, items }) => {
              const expanded = isGroupExpanded(group.id);
              return (
                <section key={group.id} className="overflow-hidden rounded-xl border border-indigo-100 bg-white">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => toggleGroup(group.id)}
                    className="flex min-h-14 w-full items-center gap-2.5 bg-indigo-50/45 px-3 py-2.5 text-left"
                  >
                    {expanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-indigo-400" strokeWidth={1.5} />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-indigo-400" strokeWidth={1.5} />
                    )}
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-indigo-200 bg-white text-indigo-500">
                      <GitBranch className="h-4 w-4" strokeWidth={1.5} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-[13px] font-semibold text-slate-900">{group.name}</strong>
                      <small className="mt-0.5 block truncate font-mono text-[10px] text-slate-400">{group.description || '-'}</small>
                    </span>
                    <span className="shrink-0 text-right text-[11px] text-slate-500">
                      {renderMobileGroupSummary?.(group) || `${group.items.length} ${itemLabel}`}
                    </span>
                  </button>
                  {expanded ? (
                    <div className="divide-y divide-indigo-50/70">
                      {items.map((item) => (
                        <button
                          type="button"
                          key={getItemId(item)}
                          onClick={() => onItemClick?.(item)}
                          className="block w-full px-4 py-3 text-left transition-colors hover:bg-indigo-50/30"
                        >
                          {renderMobileItem(item)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
