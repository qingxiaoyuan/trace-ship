import { useEffect, useMemo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Empty, Button } from 'antd';
import { workflowApi } from '@/api/workflow';
import { StatCards } from './components/StatCards';
import { ApprovalListView } from './components/ApprovalListView';
import { ApprovalDetailView } from './components/ApprovalDetailView';
import type { DetailSource } from './types';
import type { WorkflowTask } from '@/types';

/** 将待办任务构造为详情数据来源（深链直达时补齐审批能力） */
function taskToDetail(task: WorkflowTask): DetailSource {
  return {
    instanceId: task.instance || '',
    taskId: task.id,
    title: task.title,
    version: task.version,
    releaseType: task.release_type,
    branch: task.branch,
    packageStatus: task.package_status,
    applicant: task.applicant,
    projectName: task.project_name,
    softwareName: task.repository_name || '',
    submitTime: task.submit_time,
    currentNode: task.current_node,
    mode: task.mode,
    readOnly: false,
  };
}

/** 深链占位来源：仅携带实例 ID，其余字段待实例详情返回后由详情视图合并 */
function emptyDetail(instanceId: string): DetailSource {
  return {
    instanceId,
    title: '',
    applicant: '',
    projectName: '',
    softwareName: '',
    submitTime: '',
    currentNode: '',
    readOnly: true,
  };
}

export default function Workflow() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  // 列表行点击经路由 state 带入完整来源，刷新 / 通知直达时为空
  const stateDetail = (location.state as { detail?: DetailSource } | null)?.detail;

  // 详情模式：解析 URL ID 为流程实例 ID（优先按实例，兼容通知里 workflow_task 的任务 ID）
  const resolveQuery = useQuery({
    queryKey: ['workflow-detail-resolve', id],
    queryFn: async (): Promise<string> => {
      try {
        const instance = await workflowApi.getInstance(id!);
        return instance.id;
      } catch {
        const task = await workflowApi.getTask(id!);
        if (!task.instance) throw new Error('审批任务未关联流程实例');
        return task.instance;
      }
    },
    enabled: !!id && !stateDetail,
    retry: false,
  });

  const instanceId = stateDetail?.instanceId || resolveQuery.data || '';

  // 深链进入时按实例过滤当前用户待办，命中则放开审批操作
  const todoQuery = useQuery({
    queryKey: ['workflow-todo', 'for-detail', instanceId],
    queryFn: () => workflowApi.getTodoTasks({ instance: instanceId, page: 1, page_size: 10 }),
    enabled: !!instanceId && !stateDetail,
    retry: false,
  });

  const detail = useMemo<DetailSource | null>(() => {
    if (!id) return null;
    if (stateDetail) return stateDetail;
    if (!instanceId) return null;
    if (todoQuery.isLoading) return null;
    const matchedTask = (todoQuery.data?.results || []).find(
      (task) => task.instance === instanceId && task.status === 'pending',
    );
    return matchedTask ? taskToDetail(matchedTask) : emptyDetail(instanceId);
  }, [id, stateDetail, instanceId, todoQuery.data, todoQuery.isLoading]);

  // 进入详情时回到顶部
  useEffect(() => {
    if (id) window.scrollTo({ top: 0 });
  }, [id]);

  const openDetail = (src: DetailSource) => {
    navigate(`/workflows/${src.instanceId}`, { state: { detail: src } });
  };

  const backToList = () => {
    navigate('/workflows');
  };

  if (!id) {
    return (
      <div className="space-y-5 ts-fade-in-up">
        <StatCards />
        <ApprovalListView onOpenDetail={openDetail} />
      </div>
    );
  }

  if (resolveQuery.isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 ts-fade-in-up">
        <Empty description="审批单不存在或无权查看" />
        <Button type="primary" className="mt-4" onClick={backToList}>
          返回审批中心
        </Button>
      </div>
    );
  }

  if (!detail) {
    return <div className="p-6 text-center text-[13px] text-slate-400 ts-fade-in-up">加载中…</div>;
  }

  return (
    <div className="space-y-5 ts-fade-in-up">
      <ApprovalDetailView source={detail} onBack={backToList} />
    </div>
  );
}
