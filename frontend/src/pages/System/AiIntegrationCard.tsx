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
      const { api_key, ...settings } = values;
      // 模型四字段必须一起提交；未编辑密钥时不发送掩码。
      await systemApi.saveAiSettings({
        ...settings,
        ...(edited.api_key === undefined ? {} : { api_key }),
      });
    },
    onSuccess: () => {
      message.success('AI 服务配置已保存，即时生效');
      setEdited({});
      queryClient.invalidateQueries({ queryKey: ['system-configs'] });
      queryClient.invalidateQueries({ queryKey: ['review-settings'] });
    },
  });

  const setText =
    (field: keyof AiFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setEdited((prev) => ({ ...prev, [field]: e.target.value }));

  return (
    <section id="ai-model-service" aria-label="AI 模型服务" className="tech-card scroll-mt-20 rounded-xl px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg icon-amber">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-slate-900">AI 模型服务</div>
            <div className="text-[11px] text-slate-400">
              供 AI 生成打包脚本与发布代码审查共用，兼容 OpenAI / Anthropic 协议；新审查在提审时固定模型
            </div>
          </div>
        </div>
        <button
          type="button"
          disabled={isLoading || !data || saveMutation.isPending}
          onClick={() => saveMutation.mutate(form)}
          className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-60 max-md:min-h-9"
        >
          <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
          保存
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="shared-ai-endpoint" className="mb-1 block text-[12px] font-medium text-slate-600">
            服务地址 <span className="text-rose-500">*</span>
          </label>
          <input
            id="shared-ai-endpoint"
            type="text"
            value={form.endpoint}
            onChange={setText('endpoint')}
            disabled={isLoading}
            placeholder="http://127.0.0.1:11434/v1"
            className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[13px] text-slate-700 placeholder-slate-400 outline-none disabled:bg-slate-50"
          />
        </div>
        <div>
          <label htmlFor="shared-ai-key" className="mb-1 block text-[12px] font-medium text-slate-600">API 密钥</label>
          <input
            id="shared-ai-key"
            type="password"
            value={form.api_key}
            onChange={setText('api_key')}
            disabled={isLoading}
            placeholder="可选，本地服务可不填"
            className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[13px] text-slate-700 placeholder-slate-400 outline-none disabled:bg-slate-50"
          />
        </div>
        <div>
          <label htmlFor="shared-ai-model" className="mb-1 block text-[12px] font-medium text-slate-600">模型名称</label>
          <input
            id="shared-ai-model"
            type="text"
            value={form.model}
            onChange={setText('model')}
            disabled={isLoading}
            placeholder="deepseek-v4-flash"
            className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[13px] text-slate-700 placeholder-slate-400 outline-none disabled:bg-slate-50"
          />
        </div>
        <div>
          <label htmlFor="shared-ai-protocol" className="mb-1 block text-[12px] font-medium text-slate-600">协议</label>
          <select id="shared-ai-protocol"
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
          脚本生成额度（仅用于 AI 写脚本，留空使用默认值）
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
    </section>
  );
}
