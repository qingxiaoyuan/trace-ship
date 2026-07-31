import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { Container, PlugZap, Save } from 'lucide-react';
import { systemApi } from '@/api/system';
import { packageApi } from '@/api/package';

interface NexusFormState {
  base_url: string;
  username: string;
  password: string;
  registry_host: string;
}

/** sys_config 中 Nexus 集成配置键与表单项的映射 */
const NEXUS_KEY_MAP: { key: string; field: keyof NexusFormState; description: string }[] = [
  { key: 'nexus_base_url', field: 'base_url', description: 'Nexus 服务地址（如 http://nexus.example.com:8081）' },
  { key: 'nexus_username', field: 'username', description: 'Nexus 认证用户名（可选）' },
  { key: 'nexus_password', field: 'password', description: 'Nexus 认证密码（可选）' },
  { key: 'nexus_registry_host', field: 'registry_host', description: 'Nexus 镜像拉取地址 host:port（可选，留空取服务地址）' },
];

/** 系统配置页面顶部的 Nexus 集成卡片：维护 nexus_* 系统参数 */
export function NexusIntegrationCard() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  // 用户编辑覆盖层：未编辑的字段直接取服务端值，避免 effect 里同步 setState
  const [edited, setEdited] = useState<Partial<NexusFormState>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['system-configs', 'nexus-integration'],
    queryFn: () => systemApi.getConfigs({ keyword: 'nexus_', page_size: 100 }),
  });

  const existingKeys = new Set((data?.results || []).map((c) => c.key));

  const valueMap = useMemo(
    () => new Map((data?.results || []).map((c) => [c.key, c.value])),
    [data]
  );

  const form: NexusFormState = {
    base_url: edited.base_url ?? valueMap.get('nexus_base_url') ?? '',
    username: edited.username ?? valueMap.get('nexus_username') ?? '',
    password: edited.password ?? valueMap.get('nexus_password') ?? '',
    registry_host: edited.registry_host ?? valueMap.get('nexus_registry_host') ?? '',
  };

  const saveMutation = useMutation({
    mutationFn: async (values: NexusFormState) => {
      // 按键逐个 upsert：已存在则更新，不存在则创建；留空表示删除该键（回退环境变量）
      for (const item of NEXUS_KEY_MAP) {
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
      message.success('Nexus 配置已保存');
      setEdited({});
      queryClient.invalidateQueries({ queryKey: ['system-configs'] });
    },
  });

  const testMutation = useMutation({
    mutationFn: () => packageApi.getNexusRepositories(),
    onSuccess: (repos) => message.success(`连接成功，共 ${repos.length} 个 Docker 仓库`),
  });

  const set = (field: keyof NexusFormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setEdited((prev) => ({ ...prev, [field]: e.target.value }));

  return (
    <div className="tech-card rounded-xl px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg icon-indigo">
            <Container className="h-3.5 w-3.5" strokeWidth={1.5} />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-slate-900">Nexus 镜像仓库集成</div>
            <div className="text-[11px] text-slate-400">用于「打包镜像」页面检索远程镜像，保存后立即生效</div>
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

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-slate-600">
            服务地址 <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={form.base_url}
            onChange={set('base_url')}
            disabled={isLoading}
            placeholder="http://nexus.example.com:8081"
            className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[13px] text-slate-700 placeholder-slate-400 outline-none disabled:bg-slate-50"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-slate-600">镜像拉取地址</label>
          <input
            type="text"
            value={form.registry_host}
            onChange={set('registry_host')}
            disabled={isLoading}
            placeholder="host:port，留空则取服务地址"
            className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[13px] text-slate-700 placeholder-slate-400 outline-none disabled:bg-slate-50"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-slate-600">用户名</label>
          <input
            type="text"
            value={form.username}
            onChange={set('username')}
            disabled={isLoading}
            placeholder="可选，Basic 认证"
            className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[13px] text-slate-700 placeholder-slate-400 outline-none disabled:bg-slate-50"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-slate-600">密码</label>
          <input
            type="password"
            value={form.password}
            onChange={set('password')}
            disabled={isLoading}
            placeholder="可选，Basic 认证"
            className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[13px] text-slate-700 placeholder-slate-400 outline-none disabled:bg-slate-50"
          />
        </div>
      </div>
    </div>
  );
}
