import type { PackageConfig, PackageTask, PaginatedData } from '@/types';
import { isRunning } from './utils';

export interface ConfigSoftwareGroup {
  id: string;
  name: string;
  repositoryName?: string;
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

/** 配置按软件分组，旧组件配置统一列在「未分组」。 */
export function groupConfigsBySoftware(configs: PackageConfig[]): ConfigSoftwareGroup[] {
  const map = new Map<
    string,
    ConfigSoftwareGroup & { firstIndex: number; hasFavorite: boolean }
  >();

  configs.forEach((config, index) => {
    const id = config.software || 'unassigned';
    const existing = map.get(id);
    if (existing) {
      existing.configs.push(config);
      existing.hasFavorite ||= Boolean(config.is_favorite);
      return;
    }
    map.set(id, {
      id,
      name: config.software_name || '未分组',
      repositoryName: config.software ? config.repository_name : undefined,
      configs: [config],
      firstIndex: index,
      hasFavorite: Boolean(config.is_favorite),
    });
  });

  return [...map.values()]
    .sort((a, b) => Number(b.hasFavorite) - Number(a.hasFavorite) || a.firstIndex - b.firstIndex)
    .map((group) => ({
      id: group.id,
      name: group.name,
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
    const repositoryId = config.repository_id;
    if (!repositoryId) return;
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
