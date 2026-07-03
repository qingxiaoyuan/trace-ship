import { memo, useCallback, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Drawer, Form, Input, Select, Switch } from 'antd';
import { Settings2 } from 'lucide-react';
import type { PackageBuildType, PackageConfig, PackageMode } from '@/types';
import { projectApi } from '@/api/project';
import { repositoryApi } from '@/api/repository';
import { packageApi } from '@/api/package';

const modeOptions = [
  { label: '简易打包', value: 'simple' },
  { label: '本地脚本', value: 'local' },
];

const buildTypeOptions = [
  { label: 'Web', value: 'web' },
  { label: 'Qt', value: 'qt' },
];

interface ConfigDrawerProps {
  open: boolean;
  editing: PackageConfig | null;
  onClose: () => void;
}

export const ConfigDrawer = memo(function ConfigDrawer({ open, editing, onClose }: ConfigDrawerProps) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<Partial<PackageConfig>>();
  const mode = (Form.useWatch('mode', form) || 'simple') as PackageMode;
  const buildType = (Form.useWatch('build_type', form) || 'web') as PackageBuildType;

  const { data: projectsData } = useQuery({
    queryKey: ['package-drawer-projects'],
    queryFn: () => projectApi.getProjects({ page: 1, page_size: 1000 }),
    enabled: open,
  });

  const projectId = Form.useWatch('project', form);

  const { data: reposData } = useQuery({
    queryKey: ['package-drawer-repos', projectId],
    queryFn: () => repositoryApi.getRepositories({ project: projectId, repo_type: 'git', page_size: 1000 }),
    enabled: open && !!projectId,
  });

  const { data: imagesData } = useQuery({
    queryKey: ['package-drawer-images', buildType],
    queryFn: () => packageApi.getImages({ build_type: buildType, is_active: true, page_size: 1000 }),
    enabled: open && mode === 'simple',
  });

  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.setFieldsValue({ ...editing, image: editing.image_id || editing.image || undefined });
    } else {
      form.setFieldsValue({
        mode: 'simple',
        build_type: 'web',
        build_path: '.',
        output_path: 'dist',
        env_vars: {},
        auto_package_on_release: true,
        is_active: true,
      });
    }
  }, [editing, form, open]);

  const saveMutation = useMutation({
    mutationFn: (values: Partial<PackageConfig>) => {
      if (editing) return packageApi.updateConfig(editing.id, values);
      return packageApi.createConfig(values);
    },
    onSuccess: () => {
      message.success('保存成功');
      onClose();
      queryClient.invalidateQueries({ queryKey: ['package-configs'] });
      queryClient.invalidateQueries({ queryKey: ['package-tasks'] });
    },
    onError: () => message.error('保存失败'),
  });

  const projectOptions = useMemo(
    () => (projectsData?.results || []).map((p) => ({ label: p.name, value: p.id })),
    [projectsData]
  );
  const repoOptions = useMemo(
    () => (reposData?.results || []).map((r) => ({ label: r.name, value: r.id })),
    [reposData]
  );
  const imageOptions = useMemo(
    () => (imagesData?.results || []).map((img) => ({ label: `${img.name} / ${img.image}`, value: img.id })),
    [imagesData]
  );

  const handleFinish = useCallback(
    (values: Partial<PackageConfig>) => {
      saveMutation.mutate(values);
    },
    [saveMutation]
  );

  return (
    <Drawer
      title={
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-indigo-500" strokeWidth={1.5} />
          <span className="text-[15px] font-semibold tracking-tight text-slate-900">
            {editing ? '编辑打包配置' : '新建打包配置'}
          </span>
        </div>
      }
      width={420}
      open={open}
      onClose={onClose}
      destroyOnClose
      extra={
        <div className="flex items-center gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saveMutation.isPending} onClick={() => form.submit()}>
            保存
          </Button>
        </div>
      }
    >
      <Form form={form} layout="vertical" onFinish={handleFinish}>
        <Form.Item name="name" label="配置名称" rules={[{ required: true, message: '请输入配置名称' }]}>
          <Input placeholder="输入配置名称" />
        </Form.Item>
        <Form.Item name="project" label="所属项目" rules={[{ required: true, message: '请选择项目' }]}>
          <Select options={projectOptions} placeholder="选择项目" showSearch optionFilterProp="label" />
        </Form.Item>
        <Form.Item name="repository" label="关联仓库" rules={[{ required: true, message: '请选择仓库' }]}>
          <Select
            options={repoOptions}
            placeholder={projectId ? '选择仓库' : '请先选择项目'}
            disabled={!projectId}
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>
        <div className="grid grid-cols-2 gap-3">
          <Form.Item name="mode" label="打包模式" rules={[{ required: true }]}>
            <Select options={modeOptions} />
          </Form.Item>
          <Form.Item name="build_type" label="打包类型" rules={[{ required: true }]}>
            <Select options={buildTypeOptions} />
          </Form.Item>
        </div>
        {mode === 'simple' ? (
          <Form.Item name="image" label="打包镜像" rules={[{ required: true, message: '请选择打包镜像' }]}>
            <Select options={imageOptions} placeholder="按打包类型选择镜像" showSearch optionFilterProp="label" />
          </Form.Item>
        ) : (
          <Form.Item name="local_script" label="本地打包脚本" rules={[{ required: true, message: '请填写打包脚本' }]}>
            <Input.TextArea rows={4} placeholder="npm ci && npm run build" />
          </Form.Item>
        )}
        <Form.Item name="build_path" label="构建目录" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="output_path" label="产物目录" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <div className="grid grid-cols-2 gap-3">
          <Form.Item name="auto_package_on_release" label="发布后自动打包" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="is_active" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </div>
      </Form>
    </Drawer>
  );
});
