import { useEffect } from 'react';
import { Form, Input, Select } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { TsModal } from '@/components/TsModal';
import { projectApi } from '@/api/project';
import { credentialApi } from '@/api/credential';
import { accountApi } from '@/api/account';
import type { Repository } from '@/types';

interface RepositoryModalProps {
  open: boolean;
  repo: Repository | null;
  onCancel: () => void;
  onOk: (values: Partial<Repository>) => void | Promise<void>;
}

const credentialModeOptions = [
  { label: '项目固定凭证', value: 'fixed' },
  { label: '当前用户', value: 'current_user' },
  { label: '指定用户', value: 'specified_user' },
  { label: '系统全局凭证', value: 'global' },
];

export function RepositoryModal({ open, repo, onCancel, onOk }: RepositoryModalProps) {
  const [form] = Form.useForm();

  const { data: projectData, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects-all'],
    queryFn: () => projectApi.getProjects({ page_size: 1000 }),
    enabled: open,
  });

  const { data: credentialData, isLoading: credentialsLoading } = useQuery({
    queryKey: ['credentials-all'],
    queryFn: () => credentialApi.getCredentials({ page_size: 1000 }),
    enabled: open,
  });

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['account-users-all'],
    queryFn: () => accountApi.getUsers({ page_size: 1000 }),
    enabled: open,
  });

  const projectOptions =
    projectData?.results.map((p) => ({ label: p.name, value: p.id })) || [];
  const credentialOptions =
    credentialData?.results.map((c) => ({ label: c.name, value: c.id })) || [];
  const userOptions =
    usersData?.results.map((u) => ({
      label: `${u.nickname || u.username} (${u.username})`,
      value: u.id,
    })) || [];

  useEffect(() => {
    if (open) {
      if (repo) {
        form.setFieldsValue({
          project_id: repo.project_id,
          repo_type: repo.repo_type,
          vendor: repo.vendor,
          name: repo.name,
          url: repo.url,
          external_identity: repo.external_identity,
          default_branch: repo.default_branch,
          credential_mode: repo.credential_mode || 'fixed',
          credential_id: repo.credential_id,
        });
      } else {
        form.resetFields();
        form.setFieldsValue({
          repo_type: 'git',
          vendor: 'gitlab',
          default_branch: 'main',
          credential_mode: 'fixed',
        });
      }
    }
  }, [open, repo, form]);

  const credentialMode = Form.useWatch('credential_mode', form);

  const handleOk = () => {
    form.validateFields().then((values) => {
      const payload: Partial<Repository> & {
        project?: string;
        credential?: string;
        specified_user?: string;
      } = {
        ...values,
        project: values.project_id,
        credential: values.credential_mode === 'fixed' ? values.credential_id : undefined,
        specified_user:
          values.credential_mode === 'specified_user' ? values.specified_user_id : undefined,
      };
      // 删除前端字段，避免污染后端
      delete (payload as Record<string, unknown>).project_id;
      delete (payload as Record<string, unknown>).credential_id;
      delete (payload as Record<string, unknown>).specified_user_id;
      onOk(payload);
      form.resetFields();
    });
  };

  const isFixed = credentialMode === 'fixed';
  const isSpecifiedUser = credentialMode === 'specified_user';

  return (
    <TsModal
      title={repo ? '编辑仓库' : '新增仓库'}
      open={open}
      onCancel={() => {
        form.resetFields();
        onCancel();
      }}
      onOk={handleOk}
      confirmLoading={projectsLoading || credentialsLoading || usersLoading}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="project_id" label="关联项目" rules={[{ required: true, message: '请选择项目' }]}>
          <Select
            showSearch
            placeholder="选择项目"
            loading={projectsLoading}
            options={projectOptions}
            optionFilterProp="label"
          />
        </Form.Item>
        <Form.Item name="repo_type" label="仓库类型" rules={[{ required: true, message: '请选择仓库类型' }]}>
          <Select options={[{ label: 'Git', value: 'git' }, { label: 'SVN', value: 'svn' }]} />
        </Form.Item>
        <Form.Item name="vendor" label="仓库平台" rules={[{ required: true, message: '请选择仓库平台' }]}>
          <Select
            options={[
              { label: 'GitLab', value: 'gitlab' },
              { label: 'Gitea', value: 'gitea' },
              { label: 'GitHub', value: 'github' },
              { label: 'Gitee', value: 'gitee' },
              { label: 'SVN', value: 'svn' },
            ]}
          />
        </Form.Item>
        <Form.Item name="name" label="仓库名称" rules={[{ required: true, message: '请输入仓库名称' }]}>
          <Input placeholder="请输入仓库名称" />
        </Form.Item>
        <Form.Item name="url" label="仓库地址" rules={[{ required: true, message: '请输入仓库地址' }]}>
          <Input placeholder="https://..." />
        </Form.Item>
        <Form.Item name="external_identity" label="外部唯一标识">
          <Input placeholder="可选，如仓库 ID 或路径" />
        </Form.Item>
        <Form.Item
          name="default_branch"
          label="默认分支"
          rules={[{ required: true, message: '请输入默认分支' }]}
        >
          <Input placeholder="main" />
        </Form.Item>
        <Form.Item
          name="credential_mode"
          label="凭证模式"
          rules={[{ required: true, message: '请选择凭证模式' }]}
        >
          <Select options={credentialModeOptions} />
        </Form.Item>
        {isFixed && (
          <Form.Item
            name="credential_id"
            label="凭证"
            rules={[{ required: true, message: '请选择凭证' }]}
          >
            <Select
              showSearch
              placeholder="选择凭证"
              loading={credentialsLoading}
              options={credentialOptions}
              optionFilterProp="label"
            />
          </Form.Item>
        )}
        {isSpecifiedUser && (
          <Form.Item
            name="specified_user_id"
            label="指定用户"
            rules={[{ required: true, message: '请选择指定用户' }]}
          >
            <Select
              showSearch
              placeholder="选择用户"
              loading={usersLoading}
              options={userOptions}
              optionFilterProp="label"
            />
          </Form.Item>
        )}
      </Form>
    </TsModal>
  );
}
