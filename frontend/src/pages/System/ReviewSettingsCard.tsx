import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { Save, ShieldCheck } from 'lucide-react';
import { reviewSettingsApi, reviewSkillApi } from '@/api/system';

/** 审查复用共享模型，单独维护文档型技能。 */
export function ReviewSettingsCard() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [uploadError, setUploadError] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<string>();
  const [previewSkill, setPreviewSkill] = useState<string>();
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
      message.success('审查配置已保存');
    },
  });
  const fieldClass = 'input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-700 outline-none disabled:bg-slate-50';
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
            <p className="mt-1 text-[12px] text-slate-500">模型复用上方「AI 模型服务」，此处只维护审查技能。支持固定提交的只读访问及分批审查，发布由人工决定。</p>
          </div>
        </div>
        <button type="button" disabled={isLoading || isError || save.isPending || upload.isPending || skills.isError} onClick={() => {
          save.mutate({ skill });
        }} className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-60 max-md:min-h-9">
          <Save className="h-3.5 w-3.5" aria-hidden="true" />保存审查配置
        </button>
      </div>
      {isError ? <p className="mt-3 text-sm text-rose-600">加载失败 <button type="button" onClick={() => refetch()} className="underline">重试</button></p> : null}
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-2.5 text-xs text-slate-500">
        <span>使用共享模型</span><span className="break-all font-mono font-medium text-slate-700">{data?.model || '读取中…'}</span>
        {data && !data.endpoint ? <span className="text-amber-700">请先在上方配置 AI 模型服务</span> : null}
        <a href="#ai-model-service" className="inline-flex min-h-9 items-center text-indigo-600 underline underline-offset-2">前往模型设置</a>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
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
