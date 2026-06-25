import { useEffect } from 'react';
import { Form, Input, Select, DatePicker, Radio, Row, Col, Button } from 'antd';
import dayjs from 'dayjs';
import { useQuery } from '@tanstack/react-query';
import { TsModal } from '@/components/TsModal';
import { FormSection } from '@/components/FormSection';
import { projectApi } from '@/api/project';
import type { Credential } from '@/types';

interface CredentialModalProps {
  open: boolean;
  credential: Credential | null;
  onCancel: () => void;
  onOk: (values: Partial<Credential>) => void;
}

export function CredentialModal({ open, credential, onCancel, onOk }: CredentialModalProps) {
  const [form] = Form.useForm();

  const { data: projectData, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects-all'],
    queryFn: () => projectApi.getProjects({ page_size: 1000 }),
    enabled: open,
  });

  const scope = Form.useWatch('scope', form);
  const authMode = Form.useWatch('auth_mode', form);
  const credType = Form.useWatch('cred_type', form);

  // GitLab/Gitea 等 Token 类凭证固定使用 token 认证模式
  const tokenOnlyTypes = ['gitlab_token', 'gitea_token', 'github_token', 'gitee_token'];
  const isTokenOnly = tokenOnlyTypes.includes(credType);

  const projectOptions =
    projectData?.results.map((p) => ({ label: p.name, value: p.id })) || [];

  useEffect(() => {
    if (open) {
      if (credential) {
        form.setFieldsValue({
          ...credential,
          project: credential.project_id,
          expires_at: credential.expires_at ? dayjs(credential.expires_at) : undefined,
        });
      } else {
        form.resetFields();
        form.setFieldsValue({ is_active: true, scope: 'project' });
      }
    }
  }, [open, credential, form]);

  // Token 类凭证自动锁定认证模式为 token
  useEffect(() => {
    if (isTokenOnly) {
      form.setFieldsValue({ auth_mode: 'token' });
    }
  }, [isTokenOnly, form]);

  const handleOk = () => {
    form.validateFields().then((values) => {
      const payload: Partial<Credential> & { data?: Record<string, string>; token?: string } = {
        ...credential,
        ...values,
        project: values.scope === 'project' ? values.project : undefined,
        expires_at: values.expires_at ? values.expires_at.format() : undefined,
      };

      // Token 类凭证强制使用 token 模式
      const effectiveAuthMode = isTokenOnly ? 'token' : values.auth_mode;
      payload.auth_mode = effectiveAuthMode;

      // 凭证内容映射为后端加密需要的 data 字段
      if (values.token) {
        if (effectiveAuthMode === 'password') {
          payload.data = {
            username: values.username || '',
            password: values.token,
          };
        } else {
          payload.data = { token: values.token };
        }
      }

      delete payload.token;

      onOk(payload);
      form.resetFields();
    });
  };

  return (
    <TsModal
      title={credential ? '编辑凭证' : '新增凭证'}
      open={open}
      onCancel={() => {
        form.resetFields();
        onCancel();
      }}
      width={720}
      footer={
        <div className="flex justify-end gap-3">
          <Button type="text" className="text-slate-500" onClick={() => {
            form.resetFields();
            onCancel();
          }}>
            取消
          </Button>
          <Button type="primary" onClick={handleOk} loading={projectsLoading}>
            确认
          </Button>
        </div>
      }
    >
      <Form form={form} layout="vertical" initialValues={{ is_active: true, scope: 'project' }}>
        <FormSection title="基本信息">
          <Row gutter={[24, 16]}>
            <Col span={12}>
              <Form.Item name="name" label="凭证名称" rules={[{ required: true, message: '请输入凭证名称' }]}>
                <Input placeholder="请输入凭证名称" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="cred_type" label="凭证类型" rules={[{ required: true, message: '请选择凭证类型' }]}>
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
            </Col>
          </Row>
        </FormSection>

        <FormSection title="认证信息">
          <Row gutter={[24, 16]}>
            {!isTokenOnly && (
              <Col span={12}>
                <Form.Item name="auth_mode" label="认证模式" rules={[{ required: true, message: '请选择认证模式' }]}>
                  <Select options={[{ label: 'Token', value: 'token' }, { label: '用户名密码', value: 'password' }]} />
                </Form.Item>
              </Col>
            )}
            <Col span={isTokenOnly ? 24 : 12}>
              <Form.Item
                name="token"
                label={authMode === 'password' ? '密码' : 'Token'}
                rules={[{ required: !credential, message: authMode === 'password' ? '请输入密码' : '请输入 Token' }]}
              >
                <Input.Password placeholder={authMode === 'password' ? '请输入密码' : '请输入 Token'} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={[24, 16]}>
            <Col span={24}>
              <div
                className={`overflow-hidden transition-all duration-300 ${
                  authMode === 'password' ? 'max-h-40 opacity-100' : 'max-h-0 opacity-0'
                }`}
              >
                <Form.Item
                  name="username"
                  label="用户名"
                  rules={[{ required: authMode === 'password', message: '密码模式必须填写用户名' }]}
                >
                  <Input placeholder="请输入用户名" />
                </Form.Item>
              </div>
            </Col>
          </Row>

          <Row gutter={[24, 16]}>
            <Col span={12}>
              <Form.Item name="expires_at" label="过期时间">
                <DatePicker showTime className="w-full" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="remark" label="备注">
                <Input.TextArea rows={1} placeholder="可选" />
              </Form.Item>
            </Col>
          </Row>
        </FormSection>

        <FormSection title="作用范围">
          <Row gutter={[24, 16]}>
            <Col span={24}>
              <Form.Item name="scope" label="作用范围" rules={[{ required: true, message: '请选择作用范围' }]}>
                <Radio.Group>
                  <Radio value="personal">个人</Radio>
                  <Radio value="project">项目</Radio>
                  <Radio value="global">全局</Radio>
                </Radio.Group>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={[24, 16]}>
            <Col span={12}>
              <div
                className={`overflow-hidden transition-all duration-300 ${
                  scope === 'project' ? 'max-h-40 opacity-100' : 'max-h-0 opacity-0'
                }`}
              >
                <Form.Item
                  name="project"
                  label="关联项目"
                  rules={[{ required: scope === 'project', message: '项目级凭证必须关联项目' }]}
                >
                  <Select
                    showSearch
                    placeholder="选择项目"
                    loading={projectsLoading}
                    options={projectOptions}
                    optionFilterProp="label"
                  />
                </Form.Item>
              </div>
            </Col>
          </Row>
        </FormSection>
      </Form>
    </TsModal>
  );
}
