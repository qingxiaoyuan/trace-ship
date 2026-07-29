import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { PlugZap, Save, ShieldCheck } from 'lucide-react';
import { systemApi } from '@/api/system';

interface LdapFormState {
  enabled: boolean;
  server_uri: string;
  bind_dn: string;
  bind_password: string;
  user_search_base: string;
  user_filter: string;
  tls_reqcert: string;
  ca_cert: string;
}

/** sys_config 中 LDAP 集成配置键与表单项的映射（enabled 单独处理） */
const LDAP_KEY_MAP: { key: string; field: Exclude<keyof LdapFormState, 'enabled'>; description: string }[] = [
  { key: 'ldap_server_uri', field: 'server_uri', description: 'LDAP 服务地址（ldap://host:389 或 ldaps://host:636）' },
  { key: 'ldap_bind_dn', field: 'bind_dn', description: 'LDAP 服务账号绑定 DN（可选，匿名搜索可留空）' },
  { key: 'ldap_bind_password', field: 'bind_password', description: 'LDAP 服务账号密码（可选）' },
  { key: 'ldap_user_search_base', field: 'user_search_base', description: 'LDAP 用户搜索基准 DN' },
  { key: 'ldap_user_filter', field: 'user_filter', description: 'LDAP 登录过滤器（默认 (uid=%(user)s)，AD 可用 (sAMAccountName=%(user)s)）' },
  { key: 'ldap_tls_reqcert', field: 'tls_reqcert', description: 'ldaps 证书校验策略（demand/allow/never）' },
  { key: 'ldap_ca_cert', field: 'ca_cert', description: 'ldaps CA 证书 PEM 内容（可选，自签名证书时填写）' },
];

const tlsOptions = [
  { value: 'demand', label: '严格校验（demand）' },
  { value: 'never', label: '跳过校验（never，内网自签名）' },
  { value: 'allow', label: '宽松校验（allow）' },
];

/** 系统配置页面的 LDAP 集成卡片：维护 ldap_* 系统参数，保存后即时生效 */
export function LdapIntegrationCard() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  // 用户编辑覆盖层：未编辑的字段直接取服务端值，避免 effect 里同步 setState
  const [edited, setEdited] = useState<Partial<LdapFormState>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['system-configs', 'ldap-integration'],
    queryFn: () => systemApi.getConfigs({ keyword: 'ldap_', page_size: 100 }),
  });

  const existingKeys = new Set((data?.results || []).map((c) => c.key));

  const valueMap = useMemo(
    () => new Map((data?.results || []).map((c) => [c.key, c.value])),
    [data]
  );

  const form: LdapFormState = {
    enabled: edited.enabled ?? (valueMap.get('ldap_enabled') === 'true'),
    server_uri: edited.server_uri ?? valueMap.get('ldap_server_uri') ?? '',
    bind_dn: edited.bind_dn ?? valueMap.get('ldap_bind_dn') ?? '',
    bind_password: edited.bind_password ?? valueMap.get('ldap_bind_password') ?? '',
    user_search_base: edited.user_search_base ?? valueMap.get('ldap_user_search_base') ?? '',
    user_filter: edited.user_filter ?? valueMap.get('ldap_user_filter') ?? '',
    tls_reqcert: edited.tls_reqcert ?? valueMap.get('ldap_tls_reqcert') ?? 'demand',
    ca_cert: edited.ca_cert ?? valueMap.get('ldap_ca_cert') ?? '',
  };

  const saveMutation = useMutation({
    mutationFn: async (values: LdapFormState) => {
      // 开关始终写入；其余键：留空表示删除（回退环境变量），已存在则更新，不存在则创建
      const enabledValue = values.enabled ? 'true' : 'false';
      if (existingKeys.has('ldap_enabled')) {
        await systemApi.patchConfig('ldap_enabled', { value: enabledValue });
      } else {
        await systemApi.createConfig({
          key: 'ldap_enabled',
          value: enabledValue,
          description: '是否启用 LDAP 登录',
          is_public: false,
        });
      }
      for (const item of LDAP_KEY_MAP) {
        const value = values[item.field].trim();
        if (!value) {
          if (existingKeys.has(item.key)) {
            await systemApi.deleteConfig(item.key);
          }
        } else if (existingKeys.has(item.key)) {
          await systemApi.patchConfig(item.key, { value });
        } else {
          await systemApi.createConfig({
            key: item.key,
            value,
            description: item.description,
            is_public: false,
          });
        }
      }
    },
    onSuccess: () => {
      message.success('LDAP 配置已保存，即时生效');
      setEdited({});
      queryClient.invalidateQueries({ queryKey: ['system-configs'] });
    },
    onError: () => message.error('保存失败'),
  });

  const testMutation = useMutation({
    mutationFn: () => systemApi.testLdapConnection(),
    onSuccess: (res) => message.success(res.detail || '连接成功'),
    onError: (err) => message.error((err as { message?: string })?.message || '连接失败'),
  });

  const setText =
    (field: keyof LdapFormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setEdited((prev) => ({ ...prev, [field]: e.target.value }));

  const isLdaps = form.server_uri.trim().toLowerCase().startsWith('ldaps://');

  return (
    <div className="tech-card rounded-xl px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg icon-violet">
            <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.5} />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-slate-900">LDAP 登录集成</div>
            <div className="text-[11px] text-slate-400">启用后登录自动走「LDAP 优先、本地账号兜底」，保存后即时生效</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={testMutation.isPending}
            onClick={() => testMutation.mutate()}
            title="使用已保存的配置测试连接"
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-60"
          >
            <PlugZap className="h-3.5 w-3.5" strokeWidth={1.5} />
            测试连接
          </button>
          <button
            type="button"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate(form)}
            className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-60"
          >
            <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
            保存
          </button>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2.5">
        <button
          type="button"
          role="switch"
          aria-checked={form.enabled}
          onClick={() => setEdited((prev) => ({ ...prev, enabled: !form.enabled }))}
          className={[
            'relative h-5 w-9 shrink-0 rounded-full transition-colors',
            form.enabled ? 'bg-indigo-500' : 'bg-slate-300',
          ].join(' ')}
        >
          <span
            className={[
              'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
              form.enabled ? 'left-[18px]' : 'left-0.5',
            ].join(' ')}
          />
        </button>
        <span className="text-[13px] text-slate-700">
          启用 LDAP 登录
          {form.enabled && (!form.server_uri || !form.user_search_base) ? (
            <span className="ml-2 text-[11px] text-amber-600">服务地址与搜索基准 DN 为必填</span>
          ) : null}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-slate-600">
            服务地址 <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={form.server_uri}
            onChange={setText('server_uri')}
            disabled={isLoading}
            placeholder="ldaps://ldap.example.com:636"
            className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[13px] text-slate-700 placeholder-slate-400 outline-none disabled:bg-slate-50"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-slate-600">
            用户搜索基准 DN <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={form.user_search_base}
            onChange={setText('user_search_base')}
            disabled={isLoading}
            placeholder="ou=users,dc=example,dc=com"
            className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[13px] text-slate-700 placeholder-slate-400 outline-none disabled:bg-slate-50"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-slate-600">服务账号绑定 DN</label>
          <input
            type="text"
            value={form.bind_dn}
            onChange={setText('bind_dn')}
            disabled={isLoading}
            placeholder="cn=readonly,ou=service,dc=example,dc=com"
            className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[13px] text-slate-700 placeholder-slate-400 outline-none disabled:bg-slate-50"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-slate-600">服务账号密码</label>
          <input
            type="password"
            value={form.bind_password}
            onChange={setText('bind_password')}
            disabled={isLoading}
            placeholder="绑定 DN 对应密码"
            className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[13px] text-slate-700 placeholder-slate-400 outline-none disabled:bg-slate-50"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-slate-600">登录过滤器</label>
          <input
            type="text"
            value={form.user_filter}
            onChange={setText('user_filter')}
            disabled={isLoading}
            placeholder="留空默认 (uid=%(user)s)，AD 填 (sAMAccountName=%(user)s)"
            className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[13px] text-slate-700 placeholder-slate-400 outline-none disabled:bg-slate-50"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-slate-600">ldaps 证书校验</label>
          <select
            value={form.tls_reqcert}
            onChange={setText('tls_reqcert')}
            disabled={isLoading}
            className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-700 outline-none disabled:bg-slate-50"
          >
            {tlsOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLdaps && form.tls_reqcert !== 'never' ? (
        <div className="mt-3">
          <label className="mb-1 block text-[12px] font-medium text-slate-600">
            CA 证书（PEM）
            <span className="ml-2 font-normal text-[11px] text-slate-400">自签名证书且选择严格/宽松校验时必填</span>
          </label>
          <textarea
            rows={4}
            value={form.ca_cert}
            onChange={setText('ca_cert')}
            disabled={isLoading}
            placeholder="-----BEGIN CERTIFICATE-----&#10;…&#10;-----END CERTIFICATE-----"
            className="input-field w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[12px] leading-5 text-slate-700 placeholder-slate-400 outline-none disabled:bg-slate-50"
          />
        </div>
      ) : null}
    </div>
  );
}
