import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { App, Button, Form, Modal, Pagination, Select } from 'antd';
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
import { releaseApi } from '@/api/release';
import { projectApi } from '@/api/project';
import { ConfigList } from './components/ConfigList';
import { RunningTab } from './components/RunningTab';
import { DetailView } from './components/DetailView';
import { BuildView } from './components/BuildView';
import { PackageConfigModal } from '@/components/PackageConfigModal';
import { PermissionAlert } from '@/components/PermissionAlert';

const pageSize = 100;
const page = 1;
/** 构建列表每页条数 */
const TASK_PAGE_SIZE = 15;

type TabKey = 'running' | 'configs';

export default function PackageTaskPage() {
  const navigate = useNavigate();
  const { id: routeTaskId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();

  const [userView, setUserView] = useState<'list' | 'detail' | 'build'>('list');
  const view: 'list' | 'detail' | 'build' = routeTaskId ? 'build' : userView;
  const [activeTab, setActiveTab] = useState<TabKey>('running');
  const [selectedTask, setSelectedTask] = useState<PackageTask | null>(null);
  const [selectedConfig, setSelectedConfig] = useState<PackageConfig | null>(null);
  const [logText, setLogText] = useState('');
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<PackageConfig | null>(null);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [triggerConfig, setTriggerConfig] = useState<PackageConfig | null>(null);
  const [triggerForm] = Form.useForm<{ release_id: string }>();

  // 构建列表：分页 / 搜索 / 项目过滤
  const [taskPage, setTaskPage] = useState(1);
  const [taskKeyword, setTaskKeyword] = useState('');
  const [taskSearch, setTaskSearch] = useState('');
  const [taskProject, setTaskProject] = useState<string>('');

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
    queryKey: ['package-configs', page],
    queryFn: () => packageApi.getConfigs({ page, page_size: pageSize }),
  });

  const { data: tasksData, isLoading: tasksLoading, error: tasksError } = useQuery({
    queryKey: ['package-tasks', taskPage, taskSearch, taskProject],
    queryFn: () =>
      packageApi.getTasks({
        page: taskPage,
        page_size: TASK_PAGE_SIZE,
        search: taskSearch || undefined,
        project: taskProject || undefined,
      }),
  });

  const configs = useMemo(() => configsData?.results || [], [configsData]);
  const tasks = useMemo(() => tasksData?.results || [], [tasksData]);
  const tasksTotal = tasksData?.total || 0;

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

  const { data: releasedData, isLoading: releasesLoading } = useQuery({
    queryKey: ['package-trigger-releases', triggerConfig?.project, triggerConfig?.repository],
    queryFn: () =>
      releaseApi.getReleases({
        project: triggerConfig?.project,
        repository: triggerConfig?.repository,
        status: 'released',
        page_size: 1000,
      }),
    enabled: triggerOpen && !!triggerConfig?.project && !!triggerConfig?.repository,
  });

  const releaseOptions = useMemo(
    () => (releasedData?.results || []).map((release) => ({
      label: `${release.version} / ${release.tag_name}`,
      value: release.id,
    })),
    [releasedData]
  );

  const selectedTaskId = selectedTask?.id;
  const shouldPoll = !!selectedTask && isRunning(selectedTask.status);

  const loadTaskDetail = useCallback(
    async (taskId: string) => {
      const [task, blob] = await Promise.all([
        packageApi.getTask(taskId),
        packageApi.getTaskLog(taskId).catch(() => new Blob([''])),
      ]);
      const text = await blob.text();
      setSelectedTask(task);
      setLogText(text);
      if (!isRunning(task.status)) {
        queryClient.invalidateQueries({ queryKey: ['package-tasks'] });
      }
      return { task, logText: text };
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

  const triggerMutation = useMutation({
    mutationFn: ({ configId, releaseId }: { configId: string; releaseId: string }) =>
      packageApi.triggerConfig(configId, releaseId),
    onSuccess: (task) => {
      if (task.status === 'failure') {
        message.warning(task.error_message || '打包任务创建成功，但任务投递失败');
      } else {
        message.success('已创建打包任务');
        navigate(`/packages/${task.id}`);
      }
      setTriggerOpen(false);
      setTriggerConfig(null);
      triggerForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['package-tasks'] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (taskId: string) => packageApi.cancelTask(taskId),
    onSuccess: () => {
      message.success('已发送取消请求');
      queryClient.invalidateQueries({ queryKey: ['package-tasks'] });
      if (selectedTaskId) loadTaskDetail(selectedTaskId);
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
    (config?: PackageConfig) => {
      const target =
        config ||
        (selectedTask?.config ? configs.find((c) => c.id === selectedTask.config) : undefined);
      if (!target) {
        message.warning('未找到打包配置');
        return;
      }
      setTriggerConfig(target);
      setTriggerOpen(true);
      triggerForm.resetFields();
    },
    [configs, message, selectedTask, triggerForm]
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

  const closeTrigger = useCallback(() => {
    setTriggerOpen(false);
    setTriggerConfig(null);
    triggerForm.resetFields();
  }, [triggerForm]);

  const handleTriggerFinish = useCallback(
    (values: { release_id: string }) => {
      if (!triggerConfig) return;
      triggerMutation.mutate({ configId: triggerConfig.id, releaseId: values.release_id });
    },
    [triggerConfig, triggerMutation]
  );

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

          <div className="flex items-center gap-2">
            <div className="seg inline-flex items-center gap-0.5 rounded-lg p-0.5">
              <button
                className={`seg-btn inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium ${activeTab === 'running' ? 'on' : ''}`}
                onClick={() => setActiveTab('running')}
              >
                <Hammer className="h-3.5 w-3.5" strokeWidth={1.5} />
                构建列表
                {tasksTotal > 0 && (
                  <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] font-medium text-slate-500">{tasksTotal}</span>
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
          </div>

          <PermissionAlert error={configsError || tasksError} className="rounded-xl" />

          {activeTab === 'configs' && (
            <ConfigList
              configs={configs}
              tasks={tasks}
              loading={configsLoading || tasksLoading}
              onEdit={openEditConfig}
              onDelete={handleDeleteConfig}
              onTrigger={openTriggerBuild}
              onOpenHistory={openConfigHistory}
            />
          )}
          {activeTab === 'running' && (
            <div className="space-y-3">
              {/* 构建列表工具栏：搜索 + 项目过滤 */}
              <div className="tech-card flex flex-wrap items-center gap-2 rounded-xl px-4 py-2.5">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" strokeWidth={1.5} />
                  <input
                    type="text"
                    value={taskKeyword}
                    onChange={(e) => setTaskKeyword(e.target.value)}
                    placeholder="搜索任务 / 版本 / Tag / 仓库"
                    className="w-[240px] rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  />
                </div>
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="按项目过滤"
                  options={projectOptions}
                  value={taskProject || undefined}
                  onChange={(v) => {
                    setTaskProject(v || '');
                    setTaskPage(1);
                  }}
                  className="w-[200px]"
                />
                <div className="ml-auto text-[12px] text-slate-400">共 {tasksTotal} 条</div>
              </div>
              <RunningTab tasks={tasks} onOpen={openBuild} />
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
      )}

      {view === 'detail' && selectedConfig && (
        <div className="space-y-5 page-fade-in">
          <div className="flex items-center gap-2 text-[13px]">
            <button onClick={backToList} className="text-slate-400 hover:text-indigo-600 cursor-pointer">打包看板</button>
            <ChevronRight className="h-3.5 w-3.5 text-slate-300" strokeWidth={1.5} />
            <span className="font-medium text-slate-800">{selectedConfig.name}</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg icon-indigo">
                <PackageIcon className="h-[18px] w-[18px]" strokeWidth={1.5} />
              </div>
              <div>
                <div className="text-[15px] font-semibold tracking-tight text-slate-900">{selectedConfig.name}</div>
                <div className="font-mono text-[10px] text-slate-400">{selectedConfig.repository_name || '-'} · {selectedConfig.project_name || '-'}</div>
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
          ) : (
            <div className="tech-card rounded-xl p-12 text-center">
              <History className="mx-auto h-10 w-10 text-slate-300" strokeWidth={1.5} />
              <p className="mt-3 text-[13px] text-slate-400">该配置暂无打包记录</p>
            </div>
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
        <BuildView task={selectedTask} logText={logText} onBack={backToList} onCancel={handleCancel} />
      )}

      <Modal
        title="新建打包"
        open={triggerOpen}
        onCancel={closeTrigger}
        onOk={() => triggerForm.submit()}
        confirmLoading={triggerMutation.isPending}
        destroyOnHidden
      >
        <div className="mb-3 rounded-lg border border-indigo-100 bg-indigo-50/40 p-3 text-[12px] text-slate-600">
          <div>打包配置：{triggerConfig?.name || '-'}</div>
          <div>关联仓库：{triggerConfig?.repository_name || '-'}</div>
        </div>
        <Form form={triggerForm} layout="vertical" onFinish={handleTriggerFinish}>
          <Form.Item name="release_id" label="选择已发布 Tag" rules={[{ required: true, message: '请选择已发布 Tag' }]}>
            <Select
              showSearch
              loading={releasesLoading}
              options={releaseOptions}
              placeholder="选择已发布版本 / Tag"
              optionFilterProp="label"
              notFoundContent={releasesLoading ? '加载中...' : '暂无可打包的已发布 Tag'}
            />
          </Form.Item>
        </Form>
      </Modal>

      <PackageConfigModal open={configDrawerOpen} editing={editingConfig} onClose={closeConfigDrawer} />
    </div>
  );
}

function isRunning(status: string): boolean {
  return status === 'running' || status === 'queued';
}
