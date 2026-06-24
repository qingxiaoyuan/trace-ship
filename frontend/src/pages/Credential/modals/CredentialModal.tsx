import { Form, Input, Select, DatePicker, Radio } from 'antd';
import dayjs from 'dayjs';
import { TsModal } from '@/components/TsModal';
import type { Credential } from '@/types';

interface CredentialModalProps {
  open: boolean;
  credential: Credential | null;
  onCancel: () => void;
  onOk: (values: Partial<Credential>) => void;
}

export function CredentialModal({ open, credential, onCancel, onOk }: CredentialModalProps) {
  const [form] = Form.useForm();

  const initialValues = credential
    ? {
        ...credential,
        expires_at: credential.expires_at ? dayjs(credential.expires_at) : undefined,
      }
    : { is_active: true, scope: 'project' };

  return (
    <TsModal
      title={credential ? '编辑凭证' : '新增凭证'}
      open={open}
      onCancel={() => {
        form.resetFields();
        onCancel();
      }}
      onOk={() => {
        form.validateFields().then((values) => {
          onOk({
            ...credential,
            ...values,
            expires_at: values.expires_at ? values.expires_at.format() : undefined,
          });
          form.resetFields();
        });
      }}
    >
      <Form form={form} layout="vertical" initialValues={initialValues}>
        <Form.Item name="name" label="凭证名称" rules={[{ required: true }]}>
          <Input placeholder="请输入凭证名称" />
        </Form.Item>
        <Form.Item name="cred_type" label="凭证类型" rules={[{ required: true }]}>
          <Select
            options={[
              { label: 'GitLab Token', value: 'gitlab_token' },
              { label: 'Gitea Token', value: 'gitea_token' },
              { label: 'SVN 密码', value: 'svn_password' },
              { label: 'Jenkins Token', value: 'jenkins_token' },
              { label: 'LDAP 密码', value: 'ldap_password' },
            ]}
          />
        </Form.Item>
        <Form.Item name="auth_mode" label="认证模式" rules={[{ required: true }]}>
          <Select options={[{ label: 'Token', value: 'token' }, { label: '用户名密码', value: 'password' }]} />
        </Form.Item>
        <Form.Item name="token" label="凭证内容" rules={[{ required: !credential }]}>
          <Input.Password placeholder="请输入凭证内容" />
        </Form.Item>
        <Form.Item name="username" label="用户名">
          <Input placeholder="可选，认证模式为密码时必填" />
        </Form.Item>
        <Form.Item name="scope" label="作用范围" rules={[{ required: true }]}>
          <Radio.Group>
            <Radio value="personal">个人</Radio>
            <Radio value="project">项目</Radio>
            <Radio value="global">全局</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item name="expires_at" label="过期时间">
          <DatePicker showTime className="w-full" />
        </Form.Item>
        <Form.Item name="remark" label="备注">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </TsModal>
  );
}
