import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { App, Button } from 'antd';
import { ChevronRight, History, List, Package as PackageIcon, Plus, RefreshCw, Settings2, SlidersHorizontal } from 'lucide-react';
import type { PackageConfig, PackageTask } from '@/types';
import { packageApi } from '@/api/package';
import { projectApi } from '@/api/project';
import { useAuthStore } from '@/stores/authStore';
import { ConfigList } from './components/ConfigList';
import { BoardSidebar } from './components/BoardSidebar';
import { BuildBoard } from './components/BuildBoard';
import { fetchAllPages, mergePackageTasks } from './components/boardData';
import { DetailView } from './components/DetailView';
import { BuildView } from './components/BuildView';
import { PackageConfigModal } from '@/components/PackageConfigModal';
import { PackageTriggerModal, type PackageTriggerTarget } from '@/components/PackageTriggerModal';
import { PermissionAlert } from '@/components/PermissionAlert';

/** 看板任务单页大小；历史任务可继续加载后续页 */
const BOARD_TASK_PAGE_SIZE = 50;
/** 侧栏「正在打包」跨产品实时任务条数 */
const SIDEBAR_TASK_PAGE_SIZE = 20;
/** 后端统一分页器允许的最大单页条数 */
const API_PAGE_SIZE = 100;
/** 大日志首屏只加载末尾字节数 */
const LOG_TAIL_BYTES = 256 * 1024;
/** 打包看板「产品过滤」本地缓存 key（选择过产品后下次进入自动复用） */
const PACKAGE_BOARD_PROJECT_KEY = 'trace-ship.package-board.project';

type TabKey = 'builds' | 'configs';
type TaskLogState = { offset: number; text: string; partial: boolean };
type TaskDetailLoadResult = { task: PackageTask; logText: string; logPartial: boolean };

export default function PackageTaskPage() {
  const navigate = useNavigate();
  const { id: routeTaskId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();
  const user = useAuthStore((state) => state.user);

  const [userView, setUserView] = useState<'list' | 'detail' | 'build'>('list');
  const view: 'list' | 'detail' | 'build' = routeTaskId ? 'build' : userView;
  const [activeTab, setActiveTab] = useState<TabKey>('builds');
  const [selectedTask, setSelectedTask] = useState<PackageTask | null>(null);
  const [selectedConfig, setSelectedConfig] = useState<PackageConfig | null>(null);
  const [logText, setLogText] = useState('');
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<PackageConfig | null>(null);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [triggerConfig, setTriggerConfig] = useState<PackageTriggerTarget | null>(null);

  // 构建列表搜索 / 产品过滤（产品选择写入本地缓存，下次复用）
  const [taskKeyword, setTaskKeyword] = useState('');
  const [taskSearch, setTaskSearch] = useState('');
  const [filterProject, setFilterProject] = useState<string>(() => {
    try {
      return localStorage.getItem(PACKAGE_BOARD_PROJECT_KEY) || '';
    } catch {
      return '';
    }
  });

  // 搜索关键字防抖，避免每次击键都请求
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTaskSearch(taskKeyword.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [taskKeyword]);

  const { data: projectsData } = useQuery({
    queryKey: ['package-board-projects'],
    queryFn: () => fetchAllPages((page, pageSize) => projectApi.getProjects({ page, page_size: pageSize }), API_PAGE_SIZE),
  });

  // 打包配置全量加载：同时服务侧栏产品统计与配置面板（按产品在客户端过滤）
  const { data: configsData, isLoading: configsLoading, error: configsError } = useQuery({
    queryKey: ['package-configs', 'board', 'all'],
    queryFn: () => fetchAllPages((page, pageSize) => packageApi.getConfigs({ page, page_size: pageSize }), API_PAGE_SIZE),
  });

  // 侧栏「正在打包」：跨产品实时任务，5 秒轮询
  const { data: sidebarTasksData } = useQuery({
    queryKey: ['package-tasks', 'sidebar-running'],
    queryFn: () =>
      packageApi.getTasks({
        page: 1,
        page_size: SIDEBAR_TASK_PAGE_SIZE,
        status: 'queued,running',
      }),
    enabled: view === 'list',
    refetchInterval: 5000,
  });

  // 构建列表 · 进行中任务：5 秒轮询自动刷新
  const { data: activeTasksData, error: activeTasksError, isPending: activeTasksPending } = useQuery({
    queryKey: ['package-tasks', 'board-active', taskSearch, filterProject],
    queryFn: () =>
      fetchAllPages(
        (page, pageSize) =>
          packageApi.getTasks({
            page,
            page_size: pageSize,
            search: taskSearch || undefined,
            project: filterProject || undefined,
            status: 'queued,running',
          }),
        API_PAGE_SIZE,
      ),
    enabled: view === 'list' && activeTab === 'builds',
    refetchInterval: 5000,
  });

  // 构建列表 · 已完成任务：与进行中任务合并后按仓库分组统一收纳
  const {
    data: historyTasksData,
    error: historyTasksError,
    isPending: historyTasksPending,
    hasNextPage: hasMoreHistory,
    isFetchingNextPage: loadingMoreHistory,
    fetchNextPage: fetchNextHistoryPage,
  } = useInfiniteQuery({
    queryKey: ['package-tasks', 'board-history', taskSearch, filterProject],
    queryFn: ({ pageParam }) =>
      packageApi.getTasks({
        page: pageParam,
        page_size: BOARD_TASK_PAGE_SIZE,
        search: taskSearch || undefined,
        project: filterProject || undefined,
        status: 'success,failure,canceled',
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.page_size < lastPage.total ? lastPage.page + 1 : undefined,
    enabled: view === 'list' && activeTab === 'builds',
  });

  // 打包配置卡片需要各配置的最新任务（不分状态），仅配置 Tab 下加载
  const { data: configLatestTasksData } = useQuery({
    queryKey: ['package-tasks', 'latest-by-config', filterProject],
    queryFn: () =>
      packageApi.getTasks({
        page: 1,
        page_size: BOARD_TASK_PAGE_SIZE,
        project: filterProject || undefined,
      }),
    enabled: view === 'list' && activeTab === 'configs',
  });

  const projects = useMemo(() => projectsData?.results || [], [projectsData]);
  const configs = useMemo(() => configsData?.results || [], [configsData]);
  const sidebarTasks = useMemo(() => sidebarTasksData?.results || [], [sidebarTasksData]);

  // 看板当前产品范围下的配置（侧栏选择产品后客户端过滤）
  const boardConfigs = useMemo(() => {
    if (!filterProject) return configs;
    return configs.filter((c) => (c.project_id || c.project) === filterProject);
  }, [configs, filterProject]);

  const historyTasks = useMemo(
    () => historyTasksData?.pages.flatMap((page) => page.results) || [],
    [historyTasksData],
  );

  // 运行中 + 已完成合并，按任务 ID 去重并按创建时间倒序
  const boardTasks = useMemo(() => {
    return mergePackageTasks(activeTasksData?.results || [], historyTasks);
  }, [activeTasksData, historyTasks]);

  const tasksError = activeTasksError || historyTasksError;
  const historyTotal = historyTasksData?.pages[0]?.total || 0;
  const historyLoaded = historyTasks.length;
  const configLatestTasks = useMemo(() => configLatestTasksData?.results || [], [configLatestTasksData]);

  // 配置历史视图：按配置单独拉取完整任务列表（看板分页窗口不能复用当前页数据）
  const { data: configTasksData } = useQuery({
    queryKey: ['package-tasks-by-config', selectedConfig?.id],
    queryFn: () => packageApi.getTasks({ config: selectedConfig!.id, page_size: 50 }),
    enabled: view === 'detail' && !!selectedConfig,
  });

  const selectedTaskId = selectedTask?.id;
  const shouldPoll = !!selectedTask && isRunning(selectedTask.status);

  // 大日志优化：首屏只取末尾 256KB，轮询按字节偏移追加增量
  const logStateRef = useRef<Map<string, TaskLogState>>(new Map());
  const taskDetailLoadsRef = useRef<Map<string, Promise<TaskDetailLoadResult>>>(new Map());
  const [logPartial, setLogPartial] = useState(false);

  const loadTaskDetail = useCallback(
    (taskId: string): Promise<TaskDetailLoadResult> => {
      const inFlight = taskDetailLoadsRef.current.get(taskId);
      if (inFlight) return inFlight;

      const load = (async (): Promise<TaskDetailLoadResult> => {
        const state = logStateRef.current.get(taskId);
        const [task, chunk] = await Promise.all([
          packageApi.getTask(taskId),
          (state
            ? packageApi.getTaskLogChunk(taskId, { offset: state.offset })
            : packageApi.getTaskLogChunk(taskId, { tail: LOG_TAIL_BYTES })
          ).catch(() => null),
        ]);
        let nextState = state;

        const mergeChunk = (nextChunk: NonNullable<typeof chunk>) => {
          if (!nextState || nextChunk.truncated) {
            nextState = {
              offset: nextChunk.size,
              text: nextChunk.content,
              partial: nextChunk.offset > 0,
            };
            return;
          }
          nextState = {
            offset: nextChunk.size,
            text: nextState.text + nextChunk.content,
            partial: nextState.partial,
          };
        };

        if (chunk) mergeChunk(chunk);

        // 任务状态和日志请求并行，终态时补拉一次避免漏掉最后一段失败或 SVN 警告日志。
        if (!isRunning(task.status) && nextState) {
          const finalChunk = await packageApi.getTaskLogChunk(taskId, { offset: nextState.offset }).catch(() => null);
          if (finalChunk) mergeChunk(finalChunk);
        }

        const resolvedState = nextState ?? { offset: 0, text: '', partial: false };
        logStateRef.current.set(taskId, resolvedState);
        setSelectedTask(task);
        setLogText(resolvedState.text);
        setLogPartial(resolvedState.partial);
        if (!isRunning(task.status)) {
          queryClient.invalidateQueries({ queryKey: ['package-tasks'] });
        }
        return { task, logText: resolvedState.text, logPartial: resolvedState.partial };
      })();

      taskDetailLoadsRef.current.set(taskId, load);
      void load.finally(() => {
        if (taskDetailLoadsRef.current.get(taskId) === load) {
          taskDetailLoadsRef.current.delete(taskId);
        }
      }).catch(() => {});
      return load;
    },
    [queryClient]
  );

  useEffect(() => {
    if (!routeTaskId) return;
    const timer = window.setTimeout(() => {
      // 加载失败由全局拦截器统一提示，这里仅避免未处理的 Promise 拒绝
      loadTaskDetail(routeTaskId).catch(() => {});
    }, 0);
    return () => window.clearTimeout(timer);
  }, [routeTaskId, loadTaskDetail]);

  useEffect(() => {
    if (!selectedTaskId || !shouldPoll) return;
    let ignore = false;
    const timer = window.setInterval(async () => {
      try {
        await loadTaskDetail(selectedTaskId);
      } catch {
        if (!ignore) { /* keep polling */ }
      }
    }, 3000);
    return () => {
      ignore = true;
      window.clearInterval(timer);
    };
  }, [selectedTaskId, shouldPoll, loadTaskDetail]);

  const toggleFavoriteMutation = useMutation({
    mutationFn: (configId: string) => packageApi.toggleFavorite(configId),
    // 乐观更新配置列表中的星标状态；失败时按快照回滚并提示
    onMutate: async (configId) => {
      await queryClient.cancelQueries({ queryKey: ['package-configs'] });
      const snapshots = queryClient.getQueriesData<{ results: PackageConfig[]; total: number }>({
        queryKey: ['package-configs'],
      });
      queryClient.setQueriesData<{ results: PackageConfig[]; total: number }>(
        { queryKey: ['package-configs'] },
        (old) =>
          old
            ? {
                ...old,
                results: old.results.map((c) =>
                  c.id === configId ? { ...c, is_favorite: !c.is_favorite } : c,
                ),
              }
            : old,
      );
      return { snapshots };
    },
    onError: (_err, _configId, context) => {
      context?.snapshots?.forEach(([key, data]) => queryClient.setQueryData(key, data));
      message.error('收藏操作失败，请重试');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['package-configs'] });
      queryClient.invalidateQueries({ queryKey: ['package-favorites'] });
    },
  });

  const handleToggleFavorite = useCallback(
    (config: PackageConfig) => toggleFavoriteMutation.mutate(config.id),
    [toggleFavoriteMutation]
  );

  const cancelMutation = useMutation({
    mutationFn: (taskId: string) => packageApi.cancelTask(taskId),
    onSuccess: () => {
      message.success('已发送取消请求');
      queryClient.invalidateQueries({ queryKey: ['package-tasks'] });
      if (selectedTaskId) loadTaskDetail(selectedTaskId);
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (taskId: string) => packageApi.deleteTask(taskId),
    onSuccess: () => {
      message.success('已删除任务');
      queryClient.invalidateQueries({ queryKey: ['package-tasks'] });
    },
  });

  const deleteConfigMutation = useMutation({
    mutationFn: (configId: string) => packageApi.deleteConfig(configId),
    onSuccess: () => {
      message.success('已删除打包配置');
      queryClient.invalidateQueries({ queryKey: ['package-configs'] });
    },
  });

  const refreshAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['package-configs'] });
    queryClient.invalidateQueries({ queryKey: ['package-tasks'] });
  }, [queryClient]);

  // 产品过滤：同时作用于构建列表与打包配置列表，选择结果写入本地缓存下次复用
  const handleProjectChange = useCallback((value: string) => {
    setFilterProject(value);
    try {
      if (value) {
        localStorage.setItem(PACKAGE_BOARD_PROJECT_KEY, value);
      } else {
        localStorage.removeItem(PACKAGE_BOARD_PROJECT_KEY);
      }
    } catch {
      // 本地存储不可用时静默降级，仅本次会话生效
    }
  }, []);

  const backToList = useCallback(() => {
    setUserView('list');
    setSelectedTask(null);
    setSelectedConfig(null);
    setLogText('');
    if (routeTaskId) navigate('/packages');
  }, [navigate, routeTaskId]);

  const openNewConfig = useCallback(() => {
    setEditingConfig(null);
    setConfigDrawerOpen(true);
  }, []);

  const closeConfigDrawer = useCallback(() => {
    setConfigDrawerOpen(false);
    setEditingConfig(null);
  }, []);

  const openEditConfig = useCallback(
    (config?: PackageConfig) => {
      const target = config || (selectedTask?.config ? configs.find((c) => c.id === selectedTask.config) : undefined);
      if (!target) {
        message.warning('未找到打包配置');
        return;
      }
      setEditingConfig(target);
      setConfigDrawerOpen(true);
    },
    [configs, message, selectedTask]
  );

  const handleDeleteConfig = useCallback(
    (config: PackageConfig) => {
      modal.confirm({
        title: '删除打包配置',
        content: `确定要删除「${config.name}」吗？关联的历史任务记录不会被删除。`,
        onOk: () => deleteConfigMutation.mutate(config.id),
      });
    },
    [deleteConfigMutation, modal]
  );

  const handleCancel = useCallback(
    (task: PackageTask) => {
      modal.confirm({
        title: '停止构建',
        content: `确定要停止「${task.name}」吗？`,
        onOk: () => cancelMutation.mutate(task.id),
      });
    },
    [cancelMutation, modal]
  );

  const handleDeleteTask = useCallback(
    (task: PackageTask) => {
      modal.confirm({
        title: '删除打包任务',
        content: `确定要删除任务「${task.name}」吗？工作区文件将一并清理，此操作不可撤销。`,
        okButtonProps: { danger: true },
        onOk: () => deleteTaskMutation.mutate(task.id),
      });
    },
    [deleteTaskMutation, modal]
  );

  const openBuild = useCallback(
    (task: PackageTask) => {
      setSelectedTask(task);
      setSelectedConfig(null);
      setUserView('build');
      navigate(`/packages/${task.id}`);
      loadTaskDetail(task.id);
    },
    [navigate, loadTaskDetail]
  );

  const openTriggerBuild = useCallback(
    (target?: PackageTriggerTarget) => {
      const resolved =
        target ||
        (selectedTask?.config ? configs.find((c) => c.id === selectedTask.config) : undefined);
      if (!resolved) {
        message.warning('未找到打包配置');
        return;
      }
      setTriggerConfig(resolved);
      setTriggerOpen(true);
    },
    [configs, message, selectedTask]
  );

  const openConfigHistory = useCallback(
    (config: PackageConfig) => {
      setSelectedConfig(config);
      setUserView('detail');
      const latest = boardTasks
        .filter((t) => t.config === config.id)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
      if (latest) {
        setSelectedTask(latest);
        loadTaskDetail(latest.id);
      } else {
        setSelectedTask(null);
        setLogText('');
      }
    },
    [boardTasks, loadTaskDetail]
  );

  const builds = useMemo(() => {
    // 配置历史视图使用按配置拉取的完整列表
    if (selectedConfig) {
      return [...(configTasksData?.results || [])].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    }
    const configId = selectedTask?.config;
    const name = selectedTask?.name;
    if (!configId && !name) return [];
    return boardTasks
      .filter((t) => (configId && t.config === configId) || (!configId && t.name === name))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [boardTasks, configTasksData, selectedConfig, selectedTask]);

  // 配置历史视图：看板当前窗口可能不含该配置的任务（尤其已结束的），
  // 等按配置拉取的完整列表返回后自动选中最新一条，避免误显示「暂无打包记录」。
  // setTimeout 回调内更新状态，与 routeTaskId 加载保持一致（避免 effect 内同步 setState）
  useEffect(() => {
    if (view !== 'detail' || !selectedConfig || !configTasksData) return;
    if (selectedTask?.config === selectedConfig.id) return;
    const latest = [...configTasksData.results].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )[0];
    const timer = window.setTimeout(() => {
      if (latest) {
        loadTaskDetail(latest.id).catch(() => {});
      } else {
        setSelectedTask(null);
        setLogText('');
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [view, selectedConfig, configTasksData, selectedTask, loadTaskDetail]);

  const closeTrigger = useCallback(() => {
    setTriggerOpen(false);
    setTriggerConfig(null);
  }, []);

  return (
    <div className="space-y-5">
      {view === 'list' && (
        <div className="page-fade-in space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">打包看板</h1>
              <p className="mt-1 text-[13px] text-slate-500">管理打包配置，触发打包任务，监控进度与产物</p>
            </div>
            <div className="flex items-center gap-2">
              <Button icon={<RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />} onClick={refreshAll}>
                刷新
              </Button>
              <button
                className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white"
                onClick={openNewConfig}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                新建打包配置
              </button>
            </div>
          </div>

          {/* 左侧产品栏 + 右侧看板 */}
          <div className="grid min-h-0 gap-5 lg:grid-cols-[288px_minmax(0,1fr)]">
            <BoardSidebar
              projects={projects}
              configs={configs}
              runningTasks={sidebarTasks}
              selectedProject={filterProject}
              onSelectProject={handleProjectChange}
              onOpenTask={openBuild}
            />

            <section className="flex min-w-0 flex-col">
              <div className="flex shrink-0 items-center border-b border-indigo-100 pb-3">
                <div className="seg inline-flex items-center gap-0.5 rounded-lg p-0.5">
                  <button
                    className={`seg-btn inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium ${activeTab === 'builds' ? 'on' : ''}`}
                    onClick={() => setActiveTab('builds')}
                  >
                    <List className="h-3.5 w-3.5" strokeWidth={1.5} />
                    构建列表
                  </button>
                  <button
                    className={`seg-btn inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium ${activeTab === 'configs' ? 'on' : ''}`}
                    onClick={() => setActiveTab('configs')}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />
                    打包配置
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 py-4">
                <PermissionAlert error={configsError || tasksError} className="rounded-xl" />

                {activeTab === 'builds' && (
                  <BuildBoard
                    tasks={boardTasks}
                    configs={boardConfigs}
                    loading={activeTasksPending || historyTasksPending}
                    keyword={taskKeyword}
                    onKeywordChange={setTaskKeyword}
                    historyTotal={historyTotal}
                    loadedHistoryCount={historyLoaded}
                    hasMoreHistory={Boolean(hasMoreHistory)}
                    loadingMoreHistory={loadingMoreHistory}
                    onLoadMoreHistory={() => void fetchNextHistoryPage()}
                    onOpen={openBuild}
                    canDelete={!!user?.is_superuser || user?.permissions.includes('package.task.delete')}
                    onDelete={handleDeleteTask}
                  />
                )}
                {activeTab === 'configs' && (
                  <ConfigList
                    configs={boardConfigs}
                    tasks={configLatestTasks}
                    loading={configsLoading}
                    onEdit={openEditConfig}
                    onDelete={handleDeleteConfig}
                    onTrigger={openTriggerBuild}
                    onOpenHistory={openConfigHistory}
                    onNew={openNewConfig}
                    onToggleFavorite={handleToggleFavorite}
                  />
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      {view === 'detail' && selectedConfig && (
        <div className="space-y-5 page-fade-in">
          <div className="flex items-center gap-2 text-[13px]">
            <button onClick={backToList} className="text-slate-400 hover:text-indigo-600 cursor-pointer">打包看板</button>
            <ChevronRight className="h-3.5 w-3.5 text-slate-300" strokeWidth={1.5} />
            <span className="font-medium text-slate-800">{selectedConfig.name}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg icon-indigo">
                <PackageIcon className="h-[18px] w-[18px]" strokeWidth={1.5} />
              </div>
              <div>
                <div className="text-[15px] font-semibold tracking-tight text-slate-900">{selectedConfig.name}</div>
                <div className="font-mono text-[10px] text-slate-400 max-md:text-xs">{selectedConfig.repository_name || '-'} · {selectedConfig.project_name || '-'}</div>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium text-white"
                onClick={() => openTriggerBuild(selectedConfig)}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                新建打包
              </button>
              <Button icon={<Settings2 className="h-3.5 w-3.5" strokeWidth={1.5} />} onClick={() => openEditConfig(selectedConfig)}>打包配置</Button>
            </div>
          </div>

          {selectedTask ? (
            <DetailView
              config={selectedConfig}
              task={selectedTask}
              builds={builds}
              logText={logText}
              onBack={backToList}
              onLoadTaskLog={loadTaskDetail}
              onCancel={handleCancel}
              onEditConfig={() => openEditConfig(selectedConfig)}
              onTriggerBuild={() => openTriggerBuild(selectedConfig)}
              hideHeader
            />
          ) : configTasksData ? (
            <div className="tech-card rounded-xl p-12 text-center">
              <History className="mx-auto h-10 w-10 text-slate-300" strokeWidth={1.5} />
              <p className="mt-3 text-[13px] text-slate-400">该配置暂无打包记录</p>
            </div>
          ) : (
            <div className="tech-card rounded-xl p-12 text-center text-[13px] text-slate-400">加载中…</div>
          )}
        </div>
      )}

      {view === 'detail' && selectedTask && !selectedConfig && (
        <DetailView
          task={selectedTask}
          builds={builds}
          logText={logText}
          onBack={backToList}
          onLoadTaskLog={loadTaskDetail}
          onCancel={handleCancel}
          onEditConfig={() => openEditConfig()}
          onTriggerBuild={() => openTriggerBuild()}
        />
      )}

      {view === 'build' && selectedTask && (
        <BuildView task={selectedTask} logText={logText} logPartial={logPartial} onBack={backToList} onCancel={handleCancel} />
      )}

      <PackageTriggerModal open={triggerOpen} config={triggerConfig} onClose={closeTrigger} />

      <PackageConfigModal
        open={configDrawerOpen}
        editing={editingConfig}
        readOnly={
          !!editingConfig &&
          editingConfig.my_role !== 'manager' &&
          editingConfig.my_role !== 'software_admin'
        }
        onClose={closeConfigDrawer}
      />
    </div>
  );
}

function isRunning(status: string): boolean {
  return status === 'running' || status === 'queued';
}
