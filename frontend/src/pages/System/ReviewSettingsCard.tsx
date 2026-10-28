import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { Save, ShieldCheck } from 'lucide-react';
import { reviewSettingsApi, reviewSkillApi, type ReviewSettings } from '@/api/system';

/** 审查模型与技能配置独立于打包脚本模型。 */
export function ReviewSettingsCard() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [clearKey, setClearKey] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<string>();
  const [previewSkill, setPreviewSkill] = useState<string>();
  const [edited, setEdited] = useState<Partial<{ endpoint: string; model: string; protocol: ReviewSettings['protocol']; api_key: string }>>({});
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['review-settings'], queryFn: reviewSettingsApi.get,
  });
  const skills = useQuery({ queryKey: ['review-skills'], queryFn: reviewSkillApi.list });
  const skillDetail = useQuery({ queryKey: ['review-skill', previewSkill], queryFn: () => reviewSkillApi.detail(previewSkill!), enabled: !!previewSkill });
  const upload = useMutation({
    mutationFn: reviewSkillApi.upload,
    onMutate: () => setUploadError(''),
    onError: (error: unknown) => {
      const result = error as { data?: { file?: unknown }; friendlyMessage?: string };
      const errors = result.data?.file;
      setUploadError(Array.isArray(errors) && typeof errors[0] === 'string' ? errors[0] : result.friendlyMessage || '上传失败，请重试');
    },
    onSuccess: (item) => {
      queryClient.setQueryData(['review-skills'], (old: unknown) => [item, ...(Array.isArray(old) ? old : [])]);
      setSelectedSkill(item.id);
      setPreviewSkill(undefined);
      message.success('技能已上传，请保存配置以使用');
    },
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
  const skillsList = Array.isArray(skills.data) ? skills.data : [];
  const skill = selectedSkill ?? (data?.skill.source ? 'code-review-expert' : data?.skill.revision) ?? 'code-review-expert';
  const selected = skillsList.find((item) => item.id === skill);

  return (
    <section className="tech-card rounded-xl px-5 py-4" aria-labelledby="review-settings-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-2">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-indigo-500" aria-hidden="true" />
          <div>
            <h2 id="review-settings-title" className="text-[14px] font-semibold text-slate-900">发布代码审查配置</h2>
            <p className="mt-1 text-[12px] text-slate-500">与打包脚本模型独立；单批审查支持固定提交的只读访问，发布由人工决定。大改动分批审查待接入；不执行技能中的脚本或安装命令。</p>
          </div>
        </div>
        <button type="button" disabled={isLoading || isError || save.isPending || upload.isPending || skills.isError} onClick={() => {
          if (!endpoint.trim() || !model.trim()) { message.warning('请输入服务地址和模型名称'); return; }
          save.mutate({ endpoint: endpoint.trim(), model: model.trim(), protocol, skill, ...(clearKey ? { api_key: '' } : edited.api_key ? { api_key: edited.api_key } : {}) });
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
          <select className={`${fieldClass} mt-1`} value={skill} disabled={isLoading || isError || save.isPending || upload.isPending} onChange={(event) => { setSelectedSkill(event.target.value); setPreviewSkill(undefined); }}>
            <option value="code-review-expert">code-review-expert（内置）</option>
            {skillsList.map((item) => <option key={item.id} value={item.id}>{item.name}（{item.id.slice(0, 8)}）</option>)}
          </select>
        </label>
      </div>
      <label className="mt-4 block text-[12px] text-slate-600">上传审查技能
        <input type="file" accept=".md,.zip" className="mt-1 block max-w-full" disabled={save.isPending || upload.isPending} onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ''; }} />
      </label>
      <p className="mt-1 text-[12px] text-slate-500">支持 SKILL.md 或含参考 Markdown 的 ZIP；外部引用需包含在文档包中。不执行脚本与安装命令。</p>
      {uploadError ? <p role="alert" className="mt-2 break-words text-sm text-rose-600">{uploadError}</p> : null}
      {skills.isError ? <p className="mt-2 text-sm text-rose-600">技能列表加载失败 <button type="button" onClick={() => skills.refetch()} className="underline">重试</button></p> : null}
      {selected ? <div className="mt-3 break-words text-[12px] text-slate-600">文件清单：{selected.files.join('、')} <button type="button" className="text-indigo-600 underline" onClick={() => setPreviewSkill(previewSkill === selected.id ? undefined : selected.id)}>查看文档</button></div> : null}
      {previewSkill && skillDetail.isError ? <p className="text-rose-600">文档加载失败 <button type="button" className="underline" onClick={() => skillDetail.refetch()}>重试</button></p> : null}
      {previewSkill && skillDetail.data ? <div className="mt-3 space-y-2">{Object.entries(skillDetail.data.documents).map(([path, text]) => <details key={path}><summary className="cursor-pointer break-all text-xs">{path}</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-2 text-xs">{text}</pre></details>)}</div> : null}
      {data && skill === 'code-review-expert' ? <p className="mt-3 break-words text-[12px] text-slate-500">内置来源：<a className="text-indigo-600 underline" href={data.skill.source || 'https://github.com/sanyuan0704/sanyuan-skills'} target="_blank" rel="noreferrer">code-review-expert</a> · MIT。包含主文档、四份参考文档、许可和平台适配说明。</p> : null}
    </section>
  );
}
