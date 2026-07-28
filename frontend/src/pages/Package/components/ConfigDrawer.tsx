import { memo, useCallback, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Drawer, Form, Input, Select, Switch, Typography } from 'antd';
import { Settings2 } from 'lucide-react';
import type { PackageConfig } from '@/types';
import { projectApi } from '@/api/project';
import { SvnTestButton } from '@/components/SvnTestButton';
import { ImagePickerField } from '@/components/ImagePickerField';
import { toImageInfo, useAvailableImages } from '@/components/useAvailableImages';
import { repositoryApi } from '@/api/repository';
import { packageApi } from '@/api/package';
import { credentialApi } from '@/api/credential';

interface ConfigDrawerProps {
  open: boolean;
  editing: PackageConfig | null;
  onClose: () => void;
}

export const ConfigDrawer = memo(function ConfigDrawer({ open, editing, onClose }: ConfigDrawerProps) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<Partial<PackageConfig>>();

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

  const { items: imageItems } = useAvailableImages();

  const svnPushEnabled = Form.useWatch('svn_push_enabled', form) ?? false;

  const svnUrl = Form.useWatch('svn_url', form);
  const svnCredentialId = Form.useWatch('svn_credential', form);
  const svnPathTemplate = Form.useWatch('svn_path_template', form);

  const { data: svnCredsData } = useQuery({
    queryKey: ['package-drawer-svn-creds', projectId],
    queryFn: () =>
      credentialApi.getCredentials({
        cred_type: 'svn_password',
        project: projectId,
        is_active: true,
        page_size: 1000,
      }),
    enabled: open && !!projectId && svnPushEnabled,
  });

  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.setFieldsValue({ ...editing, image_ref: editing.image_ref || undefined });
    } else {
      form.setFieldsValue({
        build_path: '.',
        output_path: 'dist',
        env_vars: {},
        auto_package_on_release: true,
        is_active: true,
        svn_push_enabled: false,
        svn_path_template: '{version}',
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
  const svnCredentialOptions = useMemo(
    () => (svnCredsData?.results || []).map((c) => ({ label: c.name, value: c.id })),
    [svnCredsData]
  );

  const handleFinish = useCallback(
    (values: Partial<PackageConfig>) => {
      const payload: Partial<PackageConfig> = { ...values };
      const ref = values.image_ref;
      const item = ref ? imageItems.find((i) => i.image === ref) : undefined;
      if (item) {
        payload.image_info = toImageInfo(item);
      }
      saveMutation.mutate(payload);
    },
    [saveMutation, imageItems]
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
          {svnPushEnabled && (
            <SvnTestButton
              projectId={projectId}
              svnUrl={svnUrl}
              svnCredentialId={svnCredentialId}
              svnPathTemplate={svnPathTemplate}
            />
          )}
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
        <Form.Item name="image_ref" label="打包镜像" rules={[{ required: true, message: '请选择打包镜像' }]}>
          <ImagePickerField />
        </Form.Item>
        <Form.Item name="custom_script" label="自定义打包脚本" extra="留空则执行镜像内置脚本；填写后直接在 /workspace/source 目录执行">
          <Input.TextArea rows={4} placeholder="cd /workspace/source && ./scripts/custom-build.sh" />
        </Form.Item>
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
        <div className="border-t border-slate-100 pt-3">
          <Form.Item name="svn_push_enabled" label="启用 SVN 产物推送" valuePropName="checked">
            <Switch />
          </Form.Item>
          {svnPushEnabled && (
            <>
              <Form.Item
                name="svn_url"
                label="SVN 仓库地址"
                rules={[{ required: true, message: '请输入 SVN 仓库地址' }]}
              >
                <Input placeholder="svn://192.168.1.100/releases" />
              </Form.Item>
              <Form.Item
                name="svn_credential"
                label="SVN 凭证"
                rules={[{ required: true, message: '请选择 SVN 凭证' }]}
              >
                <Select
                  options={svnCredentialOptions}
                  placeholder={projectId ? '选择 SVN 凭证' : '请先选择项目'}
                  disabled={!projectId}
                  showSearch
                  optionFilterProp="label"
                />
              </Form.Item>
              <Form.Item name="svn_path_template" label="SVN 目录模板">
                <Input placeholder="{version}" />
              </Form.Item>
              <Typography.Text type="secondary" className="text-xs">
                可用占位符:{'{version}'}、{'{tag_name}'}、{'{project_code}'},默认按版本号创建目录
              </Typography.Text>
            </>
          )}
        </div>
      </Form>
    </Drawer>
  );
});
