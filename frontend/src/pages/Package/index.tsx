import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { App, Button, Pagination, Select } from 'antd';
import {
  ChevronRight,
  Hammer,
  History,
  Package as PackageIcon,
  Plus,
  RefreshCw,
  Search,
  Settings2,
} from 'lucide-react';
import type { PackageConfig, PackageTask } from '@/types';
import { packageApi } from '@/api/package';
import { projectApi } from '@/api/project';
import { useAuthStore } from '@/stores/authStore';
import { ConfigList } from './components/ConfigList';
import { RunningTab } from './components/RunningTab';
import { DetailView } from './components/DetailView';
import { BuildView } from './components/BuildView';
import { PackageConfigModal } from '@/components/PackageConfigModal';
import { PackageTriggerModal, type PackageTriggerTarget } from '@/components/PackageTriggerModal';
import { PermissionAlert } from '@/components/PermissionAlert';

const pageSize = 100;
const page = 1;
/** 构建列表每页条数 */
const TASK_PAGE_SIZE = 15;
/** 大日志首屏只加载末尾字节数 */
const LOG_TAIL_BYTES = 256 * 1024;
/** 打包看板「项目过滤」本地缓存 key（选择过项目后下次进入自动复用） */
const PACKAGE_BOARD_PROJECT_KEY = 'trace-ship.package-board.project';

type TabKey = 'running' | 'configs';
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
  const [activeTab, setActiveTab] = useState<TabKey>('running');
  // 构建列表子 Tab：默认只显示进行中任务，历史任务切 Tab 才加载
  const [taskTab, setTaskTab] = useState<'active' | 'history'>('active');
  const [selectedTask, setSelectedTask] = useState<PackageTask | null>(null);
  const [selectedConfig, setSelectedConfig] = useState<PackageConfig | null>(null);
  const [logText, setLogText] = useState('');
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<PackageConfig | null>(null);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [triggerConfig, setTriggerConfig] = useState<PackageTriggerTarget | null>(null);

  // 构建列表 / 打包配置列表：分页 / 搜索 / 项目过滤（项目选择写入本地缓存，下次复用）
  const [taskPage, setTaskPage] = useState(1);
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
      setTaskPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [taskKeyword]);

  const { data: projectsData } = useQuery({
    queryKey: ['package-board-projects'],
    queryFn: () => projectApi.getProjects({ page: 1, page_size: 1000 }),
  });

  const { data: configsData, isLoading: configsLoading, error: configsError } = useQuery({
    queryKey: ['package-configs', page, filterProject],
    queryFn: () =>
      packageApi.getConfigs({
        page,
        page_size: pageSize,
        project: filterProject || undefined,
      }),
  });

  // 进行中任务：默认进入即加载，5 秒轮询自动刷新
  const { data: activeTasksData, error: activeTasksError } = useQuery({
    queryKey: ['package-tasks', 'active', taskPage, taskSearch, filterProject],
    queryFn: () =>
      packageApi.getTasks({
        page: taskPage,
        page_size: TASK_PAGE_SIZE,
        search: taskSearch || undefined,
        project: filterProject || undefined,
        status: 'queued,running',
      }),
    enabled: view === 'list' && activeTab === 'running' && taskTab === 'active',
    refetchInterval: 5000,
  });

  // 打包历史：切换到「打包历史」Tab 才加载
  const { data: historyTasksData, error: historyTasksError } = useQuery({
    queryKey: ['package-tasks', 'history', taskPage, taskSearch, filterProject],
    queryFn: () =>
      packageApi.getTasks({
        page: taskPage,
        page_size: TASK_PAGE_SIZE,
        search: taskSearch || undefined,
        project: filterProject || undefined,
        status: 'success,failure,canceled',
      }),
    enabled: view === 'list' && activeTab === 'running' && taskTab === 'history',
  });

  // 打包配置卡片需要各配置的最新任务（不分状态），仅配置 Tab 下加载
  const { data: configLatestTasksData } = useQuery({
    queryKey: ['package-tasks', 'latest-by-config', filterProject],
    queryFn: () =>
      packageApi.getTasks({
        page: 1,
        page_size: TASK_PAGE_SIZE,
        project: filterProject || undefined,
      }),
    enabled: view === 'list' && activeTab === 'configs',
  });

  const configs = useMemo(() => configsData?.results || [], [configsData]);
  const tasksData = taskTab === 'active' ? activeTasksData : historyTasksData;
  const tasksError = taskTab === 'active' ? activeTasksError : historyTasksError;
  const tasks = useMemo(() => tasksData?.results || [], [tasksData]);
  const tasksTotal = tasksData?.total || 0;
  const activeTasksTotal = activeTasksData?.total || 0;
  const configLatestTasks = useMemo(() => configLatestTasksData?.results || [], [configLatestTasksData]);

  const projectOptions = useMemo(
    () => (projectsData?.results || []).map((p) => ({ label: p.name, value: p.id })),
    [projectsData],
  );

  // 配置历史视图：按配置单独拉取完整任务列表（构建列表分页后不能复用当前页数据）
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

  // 项目过滤：同时作用于构建列表与打包配置列表，选择结果写入本地缓存下次复用
  const handleProjectChange = useCallback((value?: string) => {
    const projectId = value || '';
    setFilterProject(projectId);
    setTaskPage(1);
    try {
      if (projectId) {
        localStorage.setItem(PACKAGE_BOARD_PROJECT_KEY, projectId);
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
      const latest = tasks
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
    [tasks, loadTaskDetail]
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
    return tasks
      .filter((t) => (configId && t.config === configId) || (!configId && t.name === name))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [tasks, configTasksData, selectedConfig, selectedTask]);

  // 配置历史视图：构建列表当前页可能不含该配置的任务（尤其已结束的），
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
        <div className="space-y-5 page-fade-in">
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

          {/* 构建列表 / 打包配置（收藏的配置由后端默认排序优先展示） */}
          <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="seg inline-flex items-center gap-0.5 rounded-lg p-0.5">
              <button
                className={`seg-btn inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium ${activeTab === 'running' ? 'on' : ''}`}
                onClick={() => setActiveTab('running')}
              >
                <Hammer className="h-3.5 w-3.5" strokeWidth={1.5} />
                构建列表
                {activeTasksTotal > 0 && (
                  <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] font-medium text-slate-500">{activeTasksTotal}</span>
                )}
              </button>
              <button
                className={`seg-btn inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium ${activeTab === 'configs' ? 'on' : ''}`}
                onClick={() => setActiveTab('configs')}
              >
                <Settings2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                打包配置
              </button>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="全部项目"
                options={projectOptions}
                value={filterProject || undefined}
                onChange={handleProjectChange}
                className="w-[200px]"
              />
            </div>
          </div>

          <PermissionAlert error={configsError || tasksError} className="rounded-xl" />

          {activeTab === 'configs' && (
            <ConfigList
              configs={configs}
              tasks={configLatestTasks}
              loading={configsLoading}
              onEdit={openEditConfig}
              onDelete={handleDeleteConfig}
              onTrigger={openTriggerBuild}
              onOpenHistory={openConfigHistory}
              onToggleFavorite={handleToggleFavorite}
            />
          )}
          {activeTab === 'running' && (
            <div className="space-y-3">
              {/* 构建列表工具栏：进行中/历史切换 + 搜索 */}
              <div className="tech-card flex flex-wrap items-center gap-2 rounded-xl px-4 py-2.5">
                <div className="seg inline-flex items-center gap-0.5 rounded-lg p-0.5">
                  <button
                    className={`seg-btn inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium ${taskTab === 'active' ? 'on' : ''}`}
                    onClick={() => { setTaskTab('active'); setTaskPage(1); }}
                  >
                    进行中
                    {activeTasksTotal > 0 && (
                      <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] font-medium text-slate-500">{activeTasksTotal}</span>
                    )}
                  </button>
                  <button
                    className={`seg-btn inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium ${taskTab === 'history' ? 'on' : ''}`}
                    onClick={() => { setTaskTab('history'); setTaskPage(1); }}
                  >
                    打包历史
                  </button>
                </div>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" strokeWidth={1.5} />
                  <input
                    type="text"
                    value={taskKeyword}
                    onChange={(e) => setTaskKeyword(e.target.value)}
                    placeholder="搜索任务名 / 版本 / 仓库 / 配置 / 触发人"
                    className="w-[240px] rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  />
                </div>
                <div className="ml-auto text-[12px] text-slate-400">共 {tasksTotal} 条</div>
              </div>
              <RunningTab
                tasks={tasks}
                onOpen={openBuild}
                canDelete={!!user?.is_superuser || user?.permissions.includes('package.task.delete')}
                onDelete={handleDeleteTask}
              />
              {tasksTotal > TASK_PAGE_SIZE && (
                <div className="flex justify-end">
                  <Pagination
                    current={taskPage}
                    pageSize={TASK_PAGE_SIZE}
                    total={tasksTotal}
                    onChange={setTaskPage}
                    showSizeChanger={false}
                    size="small"
                  />
                </div>
              )}
            </div>
          )}
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
