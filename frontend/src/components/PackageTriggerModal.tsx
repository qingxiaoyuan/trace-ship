import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Form, Modal, Select } from 'antd';
import { packageApi } from '@/api/package';
import { releaseApi } from '@/api/release';
import { repositoryApi } from '@/api/repository';

/**
 * 触发打包的目标配置（PackageConfig / 收藏配置均可，只需基础字段）。
 * project / repository 用于加载可选发布与分支，缺失时对应选项为空。
 */
export interface PackageTriggerTarget {
  id: string;
  name: string;
  repository_name?: string;
  project?: string;
  repository?: string;
}

interface PackageTriggerModalProps {
  open: boolean;
  config: PackageTriggerTarget | null;
  onClose: () => void;
}

/**
 * 「新建打包」共享弹窗：按已发布 Tag / 按分支最新代码两种触发方式。
 * 供打包看板、常用配置面板、工作台打包速览复用。
 */
export function PackageTriggerModal({ open, config, onClose }: PackageTriggerModalProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<{ release_id?: string; branch?: string }>();
  const [mode, setMode] = useState<'release' | 'branch'>('release');

  const { data: releasedData, isLoading: releasesLoading } = useQuery({
    queryKey: ['package-trigger-releases', config?.project, config?.repository],
    queryFn: () =>
      releaseApi.getReleases({
        project: config?.project,
        repository: config?.repository,
        status: 'released',
        page_size: 1000,
      }),
    enabled: open && !!config?.project && !!config?.repository,
  });

  const releaseOptions = useMemo(
    () => (releasedData?.results || []).map((release) => ({
      label: `${release.version} / ${release.tag_name}`,
      value: release.id,
    })),
    [releasedData]
  );

  // 分支直打包：按配置关联仓库加载分支列表（含最新提交哈希）
  const { data: branchesData, isLoading: branchesLoading } = useQuery({
    queryKey: ['package-trigger-branches', config?.repository],
    queryFn: () => repositoryApi.getBranches(config!.repository!),
    enabled: open && mode === 'branch' && !!config?.repository,
  });

  const branchOptions = useMemo(
    () => (branchesData || []).map((branch) => ({
      label: branch.name,
      value: branch.name,
    })),
    [branchesData]
  );

  const triggerMutation = useMutation({
    mutationFn: ({ releaseId, branch }: { releaseId?: string; branch?: string }) => {
      if (!config) throw new Error('未选择打包配置');
      if (mode === 'branch') {
        if (!branch) throw new Error('请选择要打包的分支');
        return packageApi.triggerConfigBranch(config.id, branch);
      }
      if (!releaseId) throw new Error('请选择已发布 Tag');
      return packageApi.triggerConfig(config.id, releaseId);
    },
    onSuccess: (task) => {
      if (task.status === 'failure') {
        message.warning(task.error_message || '打包任务创建成功，但任务投递失败');
      } else {
        message.success('已创建打包任务');
        navigate(`/packages/${task.id}`);
      }
      handleClose();
      queryClient.invalidateQueries({ queryKey: ['package-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['package-favorites'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-package-tasks'] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : '创建打包任务失败');
    },
  });

  const handleClose = useCallback(() => {
    setMode('release');
    form.resetFields();
    onClose();
  }, [form, onClose]);

  const handleFinish = useCallback(
    (values: { release_id?: string; branch?: string }) => {
      if (mode === 'branch') {
        if (!values.branch) {
          message.warning('请选择要打包的分支');
          return;
        }
        triggerMutation.mutate({ branch: values.branch });
      } else {
        if (!values.release_id) {
          message.warning('请选择已发布 Tag');
          return;
        }
        triggerMutation.mutate({ releaseId: values.release_id });
      }
    },
    [mode, message, triggerMutation]
  );

  return (
    <Modal
      title="新建打包"
      open={open}
      onCancel={handleClose}
      onOk={() => form.submit()}
      confirmLoading={triggerMutation.isPending}
      destroyOnHidden
    >
      <div className="mb-3 rounded-lg border border-indigo-100 bg-indigo-50/40 p-3 text-[12px] text-slate-600">
        <div>打包配置：{config?.name || '-'}</div>
        <div>关联仓库：{config?.repository_name || '-'}</div>
      </div>
      <Form form={form} layout="vertical" onFinish={handleFinish}>
        <div className="mb-3">
          <div className="mb-1.5 text-[13px] font-medium text-slate-700">打包方式</div>
          <div className="seg inline-flex items-center gap-0.5 rounded-lg p-0.5">
            <button
              type="button"
              className={`seg-btn inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium ${mode === 'release' ? 'on' : ''}`}
              onClick={() => {
                setMode('release');
                form.setFieldsValue({ release_id: undefined, branch: undefined });
              }}
            >
              按已发布 Tag
            </button>
            <button
              type="button"
              className={`seg-btn inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium ${mode === 'branch' ? 'on' : ''}`}
              onClick={() => {
                setMode('branch');
                form.setFieldsValue({ release_id: undefined, branch: undefined });
              }}
            >
              按分支最新代码
            </button>
          </div>
        </div>

        {mode === 'release' ? (
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
        ) : (
          <>
            <Form.Item name="branch" label="选择分支" rules={[{ required: true, message: '请选择分支' }]}>
              <Select
                showSearch
                loading={branchesLoading}
                options={branchOptions}
                placeholder="选择要打包的分支（取该分支最新代码）"
                optionFilterProp="label"
                notFoundContent={branchesLoading ? '加载中...' : '暂无可选分支'}
              />
            </Form.Item>
            <div className="-mt-1 mb-1 rounded-lg border border-emerald-100 bg-emerald-50/40 p-2.5 text-[12px] leading-relaxed text-emerald-700">
              将对所选分支的最新代码直接打包（无需发布流程），打包任务标题与自动编码均按分支名命名。
            </div>
          </>
        )}
      </Form>
    </Modal>
  );
}
