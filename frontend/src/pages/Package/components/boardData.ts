import type { PackageConfig, PackageTask, PaginatedData } from '@/types';
import { isRunning } from './utils';

export interface ConfigRepositoryGroup {
  repositoryId: string;
  repositoryName: string;
  configs: PackageConfig[];
}

export interface TaskRepositoryGroup {
  repositoryId: string;
  repositoryName: string;
  tasks: PackageTask[];
  configCount: number;
  runningCount: number;
  latestActivity: string | null;
}

/** 拉取分页接口的全部数据；分页大小以服务端实际返回值为准。 */
export async function fetchAllPages<T>(
  fetchPage: (page: number, pageSize: number) => Promise<PaginatedData<T>>,
  pageSize = 100,
): Promise<PaginatedData<T>> {
  const first = await fetchPage(1, pageSize);
  const effectivePageSize = first.page_size > 0 ? first.page_size : pageSize;
  const pageCount = Math.ceil(first.total / effectivePageSize);

  if (pageCount <= 1) return first;

  const rest = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) => fetchPage(index + 2, pageSize)),
  );

  return {
    ...first,
    results: [first, ...rest].flatMap((page) => page.results),
  };
}

/** 合并轮询中的活动任务和历史任务；同一任务以历史接口的较新状态为准。 */
export function mergePackageTasks(activeTasks: PackageTask[], historyTasks: PackageTask[]): PackageTask[] {
  const byId = new Map<string, PackageTask>();
  activeTasks.forEach((task) => byId.set(task.id, task));
  historyTasks.forEach((task) => byId.set(task.id, task));
  return [...byId.values()].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

/** 配置按物理仓库 ID 分组；含收藏的仓库优先，组内收藏配置优先。 */
export function groupConfigsByRepository(configs: PackageConfig[]): ConfigRepositoryGroup[] {
  const map = new Map<
    string,
    ConfigRepositoryGroup & { firstIndex: number; hasFavorite: boolean }
  >();

  configs.forEach((config, index) => {
    const repositoryId = config.repository_id || config.repository;
    const existing = map.get(repositoryId);
    if (existing) {
      existing.configs.push(config);
      existing.hasFavorite ||= Boolean(config.is_favorite);
      return;
    }
    map.set(repositoryId, {
      repositoryId,
      repositoryName: config.repository_name || '-',
      configs: [config],
      firstIndex: index,
      hasFavorite: Boolean(config.is_favorite),
    });
  });

  return [...map.values()]
    .sort((a, b) => Number(b.hasFavorite) - Number(a.hasFavorite) || a.firstIndex - b.firstIndex)
    .map((group) => ({
      repositoryId: group.repositoryId,
      repositoryName: group.repositoryName,
      configs: group.configs
        .map((config, index) => ({ config, index }))
        .sort(
          (a, b) =>
            Number(Boolean(b.config.is_favorite)) - Number(Boolean(a.config.is_favorite)) ||
            a.index - b.index,
        )
        .map(({ config }) => config),
    }));
}

/** 任务按物理仓库 ID 分组，避免同名仓库被错误合并。 */
export function groupTasksByRepository(
  tasks: PackageTask[],
  configs: PackageConfig[],
): TaskRepositoryGroup[] {
  const configCountByRepository = new Map<string, number>();
  configs.forEach((config) => {
    const repositoryId = config.repository_id || config.repository;
    configCountByRepository.set(repositoryId, (configCountByRepository.get(repositoryId) || 0) + 1);
  });

  const map = new Map<string, PackageTask[]>();
  tasks.forEach((task) => {
    const repositoryId = task.repository;
    const repositoryTasks = map.get(repositoryId);
    if (repositoryTasks) repositoryTasks.push(task);
    else map.set(repositoryId, [task]);
  });

  return [...map.entries()].map(([repositoryId, repositoryTasks]) => ({
    repositoryId,
    repositoryName: repositoryTasks[0]?.repository_name || '-',
    tasks: repositoryTasks,
    configCount: configCountByRepository.get(repositoryId) || 0,
    runningCount: repositoryTasks.filter((task) => isRunning(task.status)).length,
    latestActivity: repositoryTasks[0]?.created_at || null,
  }));
}
