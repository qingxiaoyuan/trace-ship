import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { Save, Sparkles } from 'lucide-react';
import { systemApi } from '@/api/system';

interface AiFormState {
  endpoint: string;
  api_key: string;
  model: string;
  protocol: string;
  manifest_chars: string;
  tree_chars: string;
  knowledge_chars: string;
  exemplar_chars: string;
  max_tokens: string;
}

/** sys_config 中 AI 服务配置键与表单项的映射 */
const AI_KEY_MAP: { key: string; field: keyof AiFormState; description: string }[] = [
  { key: 'ai_endpoint', field: 'endpoint', description: 'AI 服务地址（如 http://127.0.0.1:11434/v1 或 https://api.deepseek.com）' },
  { key: 'ai_api_key', field: 'api_key', description: 'AI API 密钥（可选，本地服务可不填）' },
  { key: 'ai_model', field: 'model', description: 'AI 模型名称（默认 deepseek-v4-flash）' },
  { key: 'ai_protocol', field: 'protocol', description: 'AI 协议：auto 按地址自动识别 / openai / anthropic' },
  { key: 'ai_manifest_chars', field: 'manifest_chars', description: '仓库清单文件进入 prompt 的字符上限（默认 32768）' },
  { key: 'ai_tree_chars', field: 'tree_chars', description: '仓库文件树进入 prompt 的字符上限（默认 15000）' },
  { key: 'ai_knowledge_chars', field: 'knowledge_chars', description: '知识库注入 prompt 的字符上限（默认 12000）' },
  { key: 'ai_exemplar_chars', field: 'exemplar_chars', description: '历史成功脚本注入 prompt 的字符上限（默认 12000）' },
  { key: 'ai_max_tokens', field: 'max_tokens', description: 'AI 输出 token 上限（默认 16384，推理模型会消耗大量输出 token，过低会截断）' },
];

const protocolOptions = [
  { value: 'auto', label: 'auto（按地址自动识别）' },
  { value: 'openai', label: 'openai（/v1/chat/completions）' },
  { value: 'anthropic', label: 'anthropic（/v1/messages）' },
];

/** 系统配置页面的 AI 服务卡片：维护 ai_* 系统参数，保存后即时生效 */
export function AiIntegrationCard() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  // 用户编辑覆盖层：未编辑的字段直接取服务端值，避免 effect 里同步 setState
  const [edited, setEdited] = useState<Partial<AiFormState>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['system-configs', 'ai-integration'],
    queryFn: () => systemApi.getConfigs({ keyword: 'ai_', page_size: 100 }),
  });

  const existingKeys = new Set((data?.results || []).map((c) => c.key));

  const valueMap = useMemo(
    () => new Map((data?.results || []).map((c) => [c.key, c.value])),
    [data]
  );

  const form: AiFormState = {
    endpoint: edited.endpoint ?? valueMap.get('ai_endpoint') ?? '',
    api_key: edited.api_key ?? maskKey(valueMap.get('ai_api_key') ?? ''),
    model: edited.model ?? valueMap.get('ai_model') ?? 'deepseek-v4-flash',
    protocol: edited.protocol ?? valueMap.get('ai_protocol') ?? 'auto',
    manifest_chars: edited.manifest_chars ?? valueMap.get('ai_manifest_chars') ?? '32768',
    tree_chars: edited.tree_chars ?? valueMap.get('ai_tree_chars') ?? '15000',
    knowledge_chars: edited.knowledge_chars ?? valueMap.get('ai_knowledge_chars') ?? '12000',
    exemplar_chars: edited.exemplar_chars ?? valueMap.get('ai_exemplar_chars') ?? '12000',
    max_tokens: edited.max_tokens ?? valueMap.get('ai_max_tokens') ?? '16384',
  };

  /** 已保存密钥展示脱敏：仅显示尾 4 位，避免明文泄露 */
  function maskKey(stored: string): string {
    return stored ? `••••${stored.slice(-4)}` : '';
  }

  const saveMutation = useMutation({
    mutationFn: async (values: AiFormState) => {
      // 按键逐个 upsert：已存在则更新，不存在则创建；留空表示删除该键（回退默认值）
      for (const item of AI_KEY_MAP) {
        // 密钥未编辑（仍是脱敏展示值）时跳过，保留原值，避免把掩码写回
        if (item.key === 'ai_api_key' && edited.api_key === undefined) {
          continue;
        }
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
      message.success('AI 服务配置已保存，即时生效');
      setEdited({});
      queryClient.invalidateQueries({ queryKey: ['system-configs'] });
    },
  });

  const setText =
    (field: keyof AiFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setEdited((prev) => ({ ...prev, [field]: e.target.value }));

  return (
    <div className="tech-card rounded-xl px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg icon-amber">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-slate-900">AI 打包脚本服务</div>
            <div className="text-[11px] text-slate-400">
              供「打包配置 · AI 生成脚本」调用，兼容 OpenAI / Anthropic 协议，保存后立即生效
            </div>
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

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-slate-600">
            服务地址 <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={form.endpoint}
            onChange={setText('endpoint')}
            disabled={isLoading}
            placeholder="http://127.0.0.1:11434/v1"
            className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[13px] text-slate-700 placeholder-slate-400 outline-none disabled:bg-slate-50"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-slate-600">API 密钥</label>
          <input
            type="password"
            value={form.api_key}
            onChange={setText('api_key')}
            disabled={isLoading}
            placeholder="可选，本地服务可不填"
            className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[13px] text-slate-700 placeholder-slate-400 outline-none disabled:bg-slate-50"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-slate-600">模型名称</label>
          <input
            type="text"
            value={form.model}
            onChange={setText('model')}
            disabled={isLoading}
            placeholder="deepseek-v4-flash"
            className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[13px] text-slate-700 placeholder-slate-400 outline-none disabled:bg-slate-50"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-slate-600">协议</label>
          <select
            value={form.protocol}
            onChange={setText('protocol')}
            disabled={isLoading}
            className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[13px] text-slate-700 outline-none disabled:bg-slate-50"
          >
            {protocolOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 px-3.5 py-2.5">
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">
          上下文体积上限（字符，留空使用默认值）
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-slate-600">仓库清单</label>
            <input
              type="number"
              min={1000}
              max={200000}
              value={form.manifest_chars}
              onChange={setText('manifest_chars')}
              disabled={isLoading}
              className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[12px] text-slate-700 outline-none disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-slate-600">文件树</label>
            <input
              type="number"
              min={1000}
              max={200000}
              value={form.tree_chars}
              onChange={setText('tree_chars')}
              disabled={isLoading}
              className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[12px] text-slate-700 outline-none disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-slate-600">知识库</label>
            <input
              type="number"
              min={1000}
              max={200000}
              value={form.knowledge_chars}
              onChange={setText('knowledge_chars')}
              disabled={isLoading}
              className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[12px] text-slate-700 outline-none disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-slate-600">历史脚本</label>
            <input
              type="number"
              min={1000}
              max={200000}
              value={form.exemplar_chars}
              onChange={setText('exemplar_chars')}
              disabled={isLoading}
              className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[12px] text-slate-700 outline-none disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-slate-600">输出上限</label>
            <input
              type="number"
              min={512}
              max={32768}
              value={form.max_tokens}
              onChange={setText('max_tokens')}
              disabled={isLoading}
              className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[12px] text-slate-700 outline-none disabled:bg-slate-50"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
