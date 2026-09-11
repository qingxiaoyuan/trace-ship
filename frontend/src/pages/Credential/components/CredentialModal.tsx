import { useEffect, useMemo } from 'react';
import { Form, Input, Select, DatePicker, Button } from 'antd';
import dayjs from 'dayjs';
import {
  KeyRound,
  ShieldCheck,
  Check,
  Lock,
  Calendar,
  ChevronDown,
  Users,
} from 'lucide-react';
import { TsModal } from '@/components/TsModal';
import {
  credentialTypeOptions,
  credentialTypeIconMap,
} from '../constants';
import type { Credential, CredentialType } from '@/types';

interface CredentialModalProps {
  open: boolean;
  credential: Credential | null;
  onCancel: () => void;
  onOk: (values: Partial<Credential>) => void;
}

const tokenOnlyTypes: CredentialType[] = [
  'gitlab_token',
  'ai_api_key',
];

const passwordOnlyTypes: CredentialType[] = [
  'svn_password',
  'ldap_password',
  'windows_password',
  'ssh_password',
];

const selectCommonProps = {
  suffixIcon: <ChevronDown className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />,
  classNames: { popup: { root: 'credential-select-popup' } },
  className: 'credential-select',
};

interface FieldLabelProps {
  text: string;
  required?: boolean;
}

function FieldLabel({ text, required }: FieldLabelProps) {
  return (
    <span className="credential-form-label">
      {text}
      {required && <span className="req">*</span>}
    </span>
  );
}

/** 凭证类型卡片选择器：写入 cred_type 表单字段，与原下拉行为一致 */
function TypeCardSelect({
  value,
  onChange,
}: {
  value?: CredentialType;
  onChange?: (value: CredentialType) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {credentialTypeOptions.map(([type, label]) => {
        const Icon = credentialTypeIconMap[type];
        const selected = value === type;
        return (
          <button
            key={type}
            type="button"
            onClick={() => onChange?.(type)}
            className={
              selected
                ? 'flex flex-col items-center gap-1.5 rounded-lg bg-[#EEF2FF] px-2 py-3 ring-2 ring-[#4F46E5] transition'
                : 'flex flex-col items-center gap-1.5 rounded-lg bg-white px-2 py-3 ring-1 ring-[#E0E7FF] transition hover:ring-[#6366F1]'
            }
          >
            <Icon
              className={`h-[18px] w-[18px] ${selected ? 'text-[#4F46E5]' : 'text-slate-500'}`}
              strokeWidth={1.5}
            />
            <span
              className={`text-[12px] font-medium ${selected ? 'text-[#4F46E5]' : 'text-slate-700'}`}
            >
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function CredentialModal({ open, credential, onCancel, onOk }: CredentialModalProps) {
  const [form] = Form.useForm();

  const authMode = Form.useWatch('auth_mode', form);
  const credType = Form.useWatch('cred_type', form);

  const isTokenOnly = tokenOnlyTypes.includes(credType);
  const isPasswordOnly = passwordOnlyTypes.includes(credType);
  const isGitlabToken = credType === 'gitlab_token';
  const isSystemShared = credType === 'svn_password' || credType === 'windows_password' || credType === 'ssh_password';
  // 有效认证模式：token/密码类凭证由类型直接锁定，不依赖表单里的 auth_mode 字段
  const effectiveAuthMode = isTokenOnly ? 'token' : isPasswordOnly ? 'password' : authMode;

  const initialValues = useMemo(() => {
    if (credential) {
      return {
        ...credential,
        expires_at: credential.expires_at ? dayjs(credential.expires_at) : undefined,
      };
    }
    return { is_active: true };
  }, [credential]);

  // Token 类凭证自动锁定认证模式为 token
  useEffect(() => {
    if (isTokenOnly) {
      form.setFieldsValue({ auth_mode: 'token' });
    }
  }, [isTokenOnly, form]);

  // 密码类凭证自动锁定认证模式为 password
  useEffect(() => {
    if (isPasswordOnly) {
      form.setFieldsValue({ auth_mode: 'password' });
    }
  }, [isPasswordOnly, form]);

  const handleCancel = () => {
    form.resetFields();
    onCancel();
  };

  const handleOk = () => {
    form.validateFields().then((values) => {
      const payload: Partial<Credential> & { data?: Record<string, string> } = {
        ...credential,
        ...values,
        expires_at: values.expires_at ? values.expires_at.format() : undefined,
      };

      payload.auth_mode = effectiveAuthMode;

      // 凭证内容映射为后端加密需要的 data 字段；留空表示不修改
      if (values.token) {
        if (effectiveAuthMode === 'password') {
          payload.data = {
            username: values.username || '',
            password: values.token,
          };
        } else {
          payload.data = { token: values.token };
          if (isGitlabToken) {
            payload.data.username = values.username || '';
          }
        }
      }

      delete (payload as Record<string, unknown>).token;

      onOk(payload);
      form.resetFields();
    });
  };

  const tokenLabel = effectiveAuthMode === 'password' ? '密码' : 'Token';

  return (
    <TsModal
      title={credential ? '编辑凭证' : '新增凭证'}
      subtitle="凭证将加密存储，仅本人可见明文"
      titleIcon={<KeyRound className="h-[18px] w-[18px]" strokeWidth={1.5} />}
      open={open}
      onCancel={handleCancel}
      width={640}
      destroyOnHidden
      bodyStyle={{ maxHeight: 'none' }}
      footer={
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" strokeWidth={1.5} />
            明文不会回显，留空表示不修改
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="text"
              className="h-auto rounded-lg px-4 py-2 text-[13px] font-medium text-slate-500 transition hover:text-slate-700"
              onClick={handleCancel}
            >
              取消
            </Button>
            <Button
              type="primary"
              className="inline-flex h-auto items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium"
              onClick={handleOk}
            >
              <Check className="h-3.5 w-3.5" strokeWidth={2} />
              确认
            </Button>
          </div>
        </div>
      }
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={initialValues}
        requiredMark={false}
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
          <Form.Item
            name="cred_type"
            className="mb-0 sm:col-span-2"
            label={<FieldLabel text="凭证类型" required />}
            rules={[{ required: true, message: '请选择凭证类型' }]}
            extra={
              (isTokenOnly || isPasswordOnly) && (
                <p className="mb-0 mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-indigo-500">
                  <Lock className="h-3 w-3" strokeWidth={1.5} />
                  {isTokenOnly
                    ? 'Token 类凭证固定使用 Token 认证'
                    : '密码类凭证固定使用用户名密码认证'}
                </p>
              )
            }
          >
            <TypeCardSelect />
          </Form.Item>

          {/* 共享范围说明：默认个人凭证，SVN / Windows 凭证全系统共享 */}
          {isSystemShared && (
            <div className="-mt-2 flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-[12px] text-indigo-600 sm:col-span-2">
              <Users className="h-3.5 w-3.5" strokeWidth={1.5} />
              SVN / Windows 凭证全系统共享，所有用户可见可用；其余类型均为个人凭证
            </div>
          )}

          <Form.Item
            name="name"
            className="mb-0"
            label={<FieldLabel text="凭证名称" required />}
            rules={[{ required: true, message: '请输入凭证名称' }]}
          >
            <Input placeholder="请输入凭证名称" />
          </Form.Item>

          <Form.Item name="expires_at" className="mb-0" label={<FieldLabel text="过期时间" />}>
            <DatePicker
              showTime
              className="w-full"
              placeholder="请选择过期时间"
              suffixIcon={
                <Calendar className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
              }
            />
          </Form.Item>

          {/* GitLab Token 需要额外填写用户名，与 Token 并排展示。
              注意：本字段与下方「密码模式用户名」共用 name="username"，二者按凭证类型互斥渲染
              （GitLab Token 必为 token 模式），不会同时挂载 */}
          {isGitlabToken && (
            <Form.Item
              name="username"
              className="mb-0"
              label={<FieldLabel text="用户名" />}
              extra={
                <p className="mb-0 mt-1 text-[11px] text-slate-400">默认 oauth2</p>
              }
            >
              <Input placeholder="默认 oauth2" />
            </Form.Item>
          )}

          {!isTokenOnly && !isPasswordOnly && (
            <Form.Item
              name="auth_mode"
              className="mb-0"
              label={<FieldLabel text="认证模式" required />}
              rules={[{ required: true, message: '请选择认证模式' }]}
            >
              <Select
                placeholder="请选择认证模式"
                options={[
                  { label: 'Token', value: 'token' },
                  { label: '用户名密码', value: 'password' },
                ]}
                {...selectCommonProps}
              />
            </Form.Item>
          )}

          <Form.Item
            name="token"
            className="mb-0"
            label={<FieldLabel text={tokenLabel} required={!credential} />}
            rules={[
              {
                required: !credential,
                message: effectiveAuthMode === 'password' ? '请输入密码' : '请输入 Token',
              },
            ]}
            extra={
              credential ? (
                <p className="mb-0 mt-1 text-[11px] text-slate-400">留空表示不修改</p>
              ) : undefined
            }
          >
            <Input.Password
              placeholder={
                credential
                  ? '留空表示不修改'
                  : effectiveAuthMode === 'password'
                    ? '请输入密码'
                    : '请输入 Token'
              }
              className="font-mono-ui"
            />
          </Form.Item>

          {/* 用户名（密码模式），与密码字段并排 */}
          {effectiveAuthMode === 'password' && (
            <Form.Item
              name="username"
              className="mb-0"
              label={<FieldLabel text="用户名" required />}
              rules={[{ required: true, message: '密码模式必须填写用户名' }]}
            >
              <Input placeholder="请输入用户名" />
            </Form.Item>
          )}

          <Form.Item
            name="remark"
            className="mb-0 sm:col-span-2"
            label={<FieldLabel text="备注" />}
            extra={
              <p className="mb-0 mt-1 flex items-center gap-1 text-[11px] text-slate-400">
                <ShieldCheck className="h-3 w-3 text-emerald-500" strokeWidth={1.5} />
                使用 AES 加密存储，接口返回时自动脱敏
              </p>
            }
          >
            <Input.TextArea
              rows={1}
              placeholder="可选"
              className="min-h-[34px]"
            />
          </Form.Item>
        </div>
      </Form>
    </TsModal>
  );
}
