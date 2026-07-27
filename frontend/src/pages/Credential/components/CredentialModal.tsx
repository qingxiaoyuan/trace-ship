import { useEffect, useMemo, useCallback } from 'react';
import { ConfigProvider, Form, Input, Select, DatePicker, Button } from 'antd';
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
import { FormSection } from '@/components/FormSection';
import {
  credentialTypeOptions,
  credentialTypeIconMap,
  credentialTypeColorMap,
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

export function CredentialModal({ open, credential, onCancel, onOk }: CredentialModalProps) {
  const [form] = Form.useForm();

  const authMode = Form.useWatch('auth_mode', form);
  const credType = Form.useWatch('cred_type', form);

  const isTokenOnly = tokenOnlyTypes.includes(credType);
  const isSystemShared = credType === 'svn_password';

  const typeLabelMap = useMemo(
    () => Object.fromEntries(credentialTypeOptions) as Record<CredentialType, string>,
    [],
  );

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

      const effectiveAuthMode = isTokenOnly ? 'token' : values.auth_mode;
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
        }
      }

      delete (payload as Record<string, unknown>).token;

      onOk(payload);
      form.resetFields();
    });
  };

  /** 凭证类型选项 / 触发标签 */
  const renderTypeLabel = useCallback(
    (value: CredentialType) => {
      const Icon = credentialTypeIconMap[value];
      const color = credentialTypeColorMap[value];
      const label = typeLabelMap[value] || value;
      return (
        <div className="flex items-center gap-2">
          <div
            className={`flex h-6 w-6 items-center justify-center rounded-md border ${color.bg} ${color.border}`}
          >
            <Icon className={`h-3.5 w-3.5 ${color.text}`} strokeWidth={1.5} />
          </div>
          <span className="text-[13px] text-slate-700">{label}</span>
        </div>
      );
    },
    [typeLabelMap],
  );

  const tokenLabel = authMode === 'password' ? '密码' : 'Token';

  return (
    <TsModal
      title={credential ? '编辑凭证' : '新增凭证'}
      subtitle="凭证使用 AES-256 加密存储"
      titleIcon={<KeyRound className="h-[18px] w-[18px]" strokeWidth={1.5} />}
      open={open}
      onCancel={handleCancel}
      width={760}
      destroyOnClose
      bodyStyle={{ maxHeight: 'none' }}
      footerStyle={{ background: 'transparent' }}
      footer={
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" strokeWidth={1.5} />
            明文不会回显，留空表示不修改
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="text"
              className="rounded-lg px-4 py-2 text-[13px] font-medium text-slate-700 hover:text-indigo-600 transition h-auto"
              onClick={handleCancel}
            >
              取消
            </Button>
            <Button
              type="primary"
              className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium text-white h-auto border-0"
              onClick={handleOk}
            >
              <Check className="h-3.5 w-3.5" strokeWidth={2} />
              确认
            </Button>
          </div>
        </div>
      }
    >
      <ConfigProvider
        theme={{
          components: {
            Form: {
              itemMarginBottom: 0,
              verticalLabelPadding: 0,
            },
          },
        }}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={initialValues}
          requiredMark={false}
        >
          <FormSection title="基本信息" compact>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Form.Item
                name="name"
                label={<FieldLabel text="凭证名称" required />}
                rules={[{ required: true, message: '请输入凭证名称' }]}
              >
                <Input
                  placeholder="请输入凭证名称"
                  className="h-9 rounded-lg border-slate-200 hover:border-indigo-200 focus:border-indigo-500 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)]"
                />
              </Form.Item>
              <Form.Item
                name="cred_type"
                label={<FieldLabel text="凭证类型" required />}
                rules={[{ required: true, message: '请选择凭证类型' }]}
              >
                <Select
                  placeholder="请选择凭证类型"
                  options={credentialTypeOptions.map(([value, label]) => ({ value, label }))}
                  optionRender={(opt) => renderTypeLabel(opt.value as CredentialType)}
                  labelRender={(opt) => renderTypeLabel(opt.value as CredentialType)}
                  {...selectCommonProps}
                />
              </Form.Item>
            </div>
            {/* 共享范围说明：默认个人凭证，SVN 凭证全系统共享 */}
            {isSystemShared && (
              <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-[12px] text-indigo-600">
                <Users className="h-3.5 w-3.5" strokeWidth={1.5} />
                SVN 凭证全系统共享，所有用户可见可用；其余类型均为个人凭证
              </div>
            )}
          </FormSection>

          <FormSection
            title="认证信息"
            compact
            extra={
              isTokenOnly && (
                <span className="text-[11px] text-indigo-500 font-medium inline-flex items-center gap-1">
                  <Lock className="h-3 w-3" strokeWidth={1.5} />
                  Token 类凭证固定使用 Token 认证
                </span>
              )
            }
          >
            <div
              className="grid gap-x-4 gap-y-3"
              style={{ gridTemplateColumns: isTokenOnly ? '1fr' : 'repeat(2, 1fr)' }}
            >
              {!isTokenOnly && (
                <Form.Item
                  name="auth_mode"
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
                label={<FieldLabel text={tokenLabel} required={!credential} />}
                rules={[
                  {
                    required: !credential,
                    message: authMode === 'password' ? '请输入密码' : '请输入 Token',
                  },
                ]}
                extra={
                  credential && (
                    <p className="mt-1 mb-0 text-[11px] text-slate-400">留空表示不修改</p>
                  )
                }
              >
                <Input.Password
                  placeholder={
                    credential
                      ? '留空表示不修改'
                      : authMode === 'password'
                        ? '请输入密码'
                        : '请输入 Token'
                  }
                  className="h-9 rounded-lg border-slate-200 font-mono-ui hover:border-indigo-200 focus:border-indigo-500 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)]"
                />
              </Form.Item>
            </div>

            {/* 用户名（密码模式） */}
            <div
              className={[
                'overflow-hidden transition-all duration-300',
                authMode === 'password' ? 'max-h-40 opacity-100 mt-4' : 'max-h-0 opacity-0 mt-0',
              ].join(' ')}
            >
              <div className="w-1/2 pr-2.5">
                <Form.Item
                  name="username"
                  label={<FieldLabel text="用户名" required />}
                  rules={[
                    { required: authMode === 'password', message: '密码模式必须填写用户名' },
                  ]}
                >
                  <Input
                    placeholder="请输入用户名"
                    className="h-9 rounded-lg border-slate-200 hover:border-indigo-200 focus:border-indigo-500 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)]"
                  />
                </Form.Item>
              </div>
            </div>

            {/* 过期时间 / 备注 */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 mt-3">
              <Form.Item name="expires_at" label={<FieldLabel text="过期时间" />}>
                <DatePicker
                  showTime
                  className="w-full h-9 rounded-lg border-slate-200 hover:border-indigo-200 focus:border-indigo-500"
                  placeholder="请选择过期时间"
                  suffixIcon={
                    <Calendar className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
                  }
                />
              </Form.Item>
              <Form.Item name="remark" label={<FieldLabel text="备注" />}>
                <Input.TextArea
                  rows={1}
                  placeholder="可选"
                  className="min-h-[36px] rounded-lg border-slate-200 hover:border-indigo-200 focus:border-indigo-500"
                />
              </Form.Item>
            </div>
          </FormSection>
        </Form>
      </ConfigProvider>
    </TsModal>
  );
}
