import { Form, Input, Select } from 'antd';
import { TsModal } from '@/components/TsModal';
import type { Repository } from '@/types';

interface RepositoryModalProps {
  open: boolean;
  repo: Repository | null;
  onCancel: () => void;
  onOk: () => void;
}

export function RepositoryModal({ open, repo, onCancel, onOk }: RepositoryModalProps) {
  const [form] = Form.useForm();

  return (
    <TsModal
      title={repo ? '编辑仓库' : '新增仓库'}
      open={open}
      onCancel={() => {
        form.resetFields();
        onCancel();
      }}
      onOk={() => {
        form.validateFields().then(() => {
          onOk();
          form.resetFields();
        });
      }}
    >
      <Form form={form} layout="vertical" initialValues={repo || { repo_type: 'git', vendor: 'gitlab' }}>
        <Form.Item name="project_id" label="关联项目" rules={[{ required: true }]}>
          <Select placeholder="选择项目" options={[{ label: '核心交易平台', value: '1' }]} />
        </Form.Item>
        <Form.Item name="repo_type" label="仓库类型" rules={[{ required: true }]}>
          <Select options={[{ label: 'Git', value: 'git' }, { label: 'SVN', value: 'svn' }]} />
        </Form.Item>
        <Form.Item name="vendor" label="仓库平台" rules={[{ required: true }]}>
          <Select options={[{ label: 'GitLab', value: 'gitlab' }, { label: 'Gitea', value: 'gitea' }, { label: 'SVN', value: 'svn' }]} />
        </Form.Item>
        <Form.Item name="name" label="仓库名称" rules={[{ required: true }]}>
          <Input placeholder="请输入仓库名称" />
        </Form.Item>
        <Form.Item name="url" label="仓库地址" rules={[{ required: true }]}>
          <Input placeholder="https://..." />
        </Form.Item>
        <Form.Item name="default_branch" label="默认分支" rules={[{ required: true }]}>
          <Input placeholder="develop" />
        </Form.Item>
        <Form.Item name="credential_id" label="凭证" rules={[{ required: true }]}>
          <Select placeholder="选择凭证" options={[{ label: 'GitLab 管理员', value: '1' }]} />
        </Form.Item>
      </Form>
    </TsModal>
  );
}
