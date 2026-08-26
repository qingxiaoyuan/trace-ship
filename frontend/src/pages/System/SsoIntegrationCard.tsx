import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { KeyRound, Save } from 'lucide-react';
import { systemApi } from '@/api/system';

interface SsoFormState {
  enabled: boolean;
  verify_url: string;
}

/** sys_config 中 SSO 集成配置键与表单项的映射（enabled 单独处理） */
const SSO_KEY_MAP: { key: string; field: Exclude<keyof SsoFormState, 'enabled'>; description: string }[] = [
  { key: 'sso_verify_url', field: 'verify_url', description: 'OA 中间件验票接口完整地址（按系统注册入口分配）' },
];

/** 系统配置页面的 OA 单点登录集成卡片：维护 sso_* 系统参数，保存后即时生效 */
export function SsoIntegrationCard() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  // 用户编辑覆盖层：未编辑的字段直接取服务端值，避免 effect 里同步 setState
  const [edited, setEdited] = useState<Partial<SsoFormState>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['system-configs', 'sso-integration'],
    queryFn: () => systemApi.getConfigs({ keyword: 'sso_', page_size: 100 }),
  });

  const existingKeys = new Set((data?.results || []).map((c) => c.key));

  const valueMap = useMemo(
    () => new Map((data?.results || []).map((c) => [c.key, c.value])),
    [data]
  );

  const form: SsoFormState = {
    enabled: edited.enabled ?? (valueMap.get('sso_enabled') === 'true'),
    verify_url: edited.verify_url ?? valueMap.get('sso_verify_url') ?? '',
  };

  const saveMutation = useMutation({
    mutationFn: async (values: SsoFormState) => {
      // 开关始终写入；验票地址：留空表示删除（回退环境变量），已存在则更新，不存在则创建
      const enabledValue = values.enabled ? 'true' : 'false';
      if (existingKeys.has('sso_enabled')) {
        await systemApi.patchConfig('sso_enabled', { value: enabledValue });
      } else {
        await systemApi.createConfig({
          key: 'sso_enabled',
          value: enabledValue,
          description: '是否启用 EKP OA 单点登录',
          is_public: false,
        });
      }
      for (const item of SSO_KEY_MAP) {
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
      message.success('SSO 配置已保存，即时生效');
      setEdited({});
      queryClient.invalidateQueries({ queryKey: ['system-configs'] });
    },
  });

  const setText =
    (field: keyof SsoFormState) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setEdited((prev) => ({ ...prev, [field]: e.target.value }));

  // 部署在子路径时带上 Vite base 前缀（BASE_URL 以 / 结尾）
  const entryUrl = `${window.location.origin}${import.meta.env.BASE_URL}sso?token={token}`;

  return (
    <div className="tech-card rounded-xl px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg icon-violet">
            <KeyRound className="h-3.5 w-3.5" strokeWidth={1.5} />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-slate-900">OA 单点登录（EKP）</div>
            <div className="text-[11px] text-slate-400">启用后支持从 OA 门户免登录跳转进入，保存后即时生效</div>
          </div>
        </div>
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
          启用 OA 单点登录
          {form.enabled && !form.verify_url ? (
            <span className="ml-2 text-[11px] text-amber-600">验票接口地址为必填</span>
          ) : null}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-slate-600">
            验票接口地址 <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={form.verify_url}
            onChange={setText('verify_url')}
            disabled={isLoading}
            placeholder="http://oa.example.com/api/v1/sso/traceship/verify-token"
            className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[13px] text-slate-700 placeholder-slate-400 outline-none disabled:bg-slate-50"
          />
          <div className="mt-1 text-[11px] text-slate-400">
            由 OA 管理员为本系统注册入口后提供；后端拿 token 调该接口换取用户身份
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-slate-600">门户跳转入口（提供给 OA 管理员配置）</label>
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 font-mono text-[12px] break-all text-slate-600">
            {entryUrl}
          </div>
        </div>
      </div>
    </div>
  );
}
