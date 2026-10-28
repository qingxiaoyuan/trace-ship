import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { Save, ShieldCheck } from 'lucide-react';
import { reviewSettingsApi, type ReviewSettings } from '@/api/system';

/** 审查模型与技能配置独立于打包脚本模型。 */
export function ReviewSettingsCard() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [clearKey, setClearKey] = useState(false);
  const [edited, setEdited] = useState<Partial<{ endpoint: string; model: string; protocol: ReviewSettings['protocol']; api_key: string }>>({});
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['review-settings'], queryFn: reviewSettingsApi.get,
  });
  const save = useMutation({
    mutationFn: reviewSettingsApi.save,
    onSuccess: (result) => {
      queryClient.setQueryData(['review-settings'], result);
      setEdited({});
      setClearKey(false);
      message.success('审查配置已保存');
    },
  });
  const fieldClass = 'input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-700 outline-none disabled:bg-slate-50';
  const endpoint = edited.endpoint ?? data?.endpoint ?? '';
  const model = edited.model ?? data?.model ?? '';
  const protocol = edited.protocol ?? data?.protocol ?? 'auto';

  return (
    <section className="tech-card rounded-xl px-5 py-4" aria-labelledby="review-settings-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-2">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-indigo-500" aria-hidden="true" />
          <div>
            <h2 id="review-settings-title" className="text-[14px] font-semibold text-slate-900">发布代码审查配置</h2>
            <p className="mt-1 text-[12px] text-slate-500">与打包脚本模型独立；审查只读取代码，发布由人工决定。计划接入只读读取、搜索、差异获取和并行审查；执行能力待接入，不执行技能中的脚本或安装命令。</p>
          </div>
        </div>
        <button type="button" disabled={isLoading || isError || save.isPending} onClick={() => {
          if (!endpoint.trim() || !model.trim()) { message.warning('请输入服务地址和模型名称'); return; }
          save.mutate({ endpoint: endpoint.trim(), model: model.trim(), protocol, skill: 'code-review-expert', ...(clearKey ? { api_key: '' } : edited.api_key ? { api_key: edited.api_key } : {}) });
        }} className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-60">
          <Save className="h-3.5 w-3.5" aria-hidden="true" />保存审查配置
        </button>
      </div>
      {isError ? <p className="mt-3 text-sm text-rose-600">加载失败 <button type="button" onClick={() => refetch()} className="underline">重试</button></p> : null}
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="text-[12px] text-slate-600">服务地址
          <input className={`${fieldClass} mt-1`} type="url" value={endpoint} disabled={isLoading || isError || save.isPending} onChange={(event) => setEdited((prev) => ({ ...prev, endpoint: event.target.value }))} placeholder="https://model.example/v1" />
        </label>
        <label className="text-[12px] text-slate-600">API 密钥
          <input className={`${fieldClass} mt-1`} type="password" value={edited.api_key ?? ''} disabled={isLoading || isError || save.isPending} onChange={(event) => { setClearKey(false); setEdited((prev) => ({ ...prev, api_key: event.target.value })); }} placeholder={clearKey ? '保存后清除' : data?.has_api_key ? '已设置，留空不修改' : '可选，本地服务可不填'} autoComplete="new-password" />
          {data?.has_api_key ? <button type="button" disabled={save.isPending} className="mt-1 text-indigo-600 underline disabled:opacity-60" onClick={() => { setClearKey(!clearKey); setEdited((prev) => ({ ...prev, api_key: '' })); }}>{clearKey ? '撤销清除密钥' : '清除已保存密钥'}</button> : null}
        </label>
        <label className="text-[12px] text-slate-600">模型名称
          <input className={`${fieldClass} mt-1`} value={model} disabled={isLoading || isError || save.isPending} onChange={(event) => setEdited((prev) => ({ ...prev, model: event.target.value }))} />
        </label>
        <label className="text-[12px] text-slate-600">协议
          <select className={`${fieldClass} mt-1`} value={protocol} disabled={isLoading || isError || save.isPending} onChange={(event) => setEdited((prev) => ({ ...prev, protocol: event.target.value as ReviewSettings['protocol'] }))}>
            <option value="auto">自动识别</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option>
          </select>
        </label>
        <label className="text-[12px] text-slate-600">默认审查技能
          <select className={`${fieldClass} mt-1`} value="code-review-expert" disabled={isLoading || isError || save.isPending} onChange={() => {}}>
            <option value="code-review-expert">code-review-expert（内置）</option>
          </select>
        </label>
      </div>
      {data ? <p className="mt-3 break-words text-[12px] text-slate-500">来源：<a className="text-indigo-600 underline" href={data.skill.source} target="_blank" rel="noreferrer">{data.skill.name}</a> · {data.skill.license} · 版本 {data.skill.revision}。包含主文档、四份参考文档、许可和平台适配说明。</p> : null}
    </section>
  );
}
