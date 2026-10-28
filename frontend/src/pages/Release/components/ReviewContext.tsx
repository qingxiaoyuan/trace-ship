import { useState } from 'react';
import { Button } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { releaseApi } from '@/api/release';
import type { NormalizedError } from '@/api/request';
import type { Release } from '@/types';

/** 发布草稿中的可选审查依据，提交后由服务端固定本轮内容。 */
export function ReviewContext({ release, canEdit, onDirtyChange }: { release: Release; canEdit: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const [context, setContext] = useState(release.review_context ?? '');
  const [paths, setPaths] = useState((release.review_document_paths ?? []).join('\n'));
  const [isRequirement, setIsRequirement] = useState(release.review_context_is_requirement ?? false);
  const hasContext = !!context.trim() || !!paths.trim();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () => releaseApi.updateReviewContext(release.id, context, paths.split('\n').map(path => path.trim()).filter(Boolean), isRequirement && hasContext),
    onSuccess: data => {
      queryClient.setQueryData(['release', release.id], data);
      onDirtyChange?.(false);
    },
  });
  const editable = canEdit && release.status === 'draft';
  if (!editable && !release.review_context && !release.review_document_paths?.length) return null;
  return <section aria-label="审查上下文" className="mt-4 space-y-3 rounded-lg border border-indigo-100 p-3 text-[13px]">
    <div>
      <p className="font-medium text-slate-900">审查上下文</p>
      <p className="mt-1 text-xs text-slate-500">可选。包含 AI 审查节点的流程提审时固定当前提交的文档内容；发布说明不会自动作为需求依据。</p>
    </div>
    {editable ? <>
      <label className="block text-slate-700">补充审查说明
        <textarea aria-label="补充审查说明" className="mt-1 block w-full rounded-lg border border-slate-200 p-2" rows={3} value={context}
          onChange={event => { const value = event.target.value; setContext(value); if (!value.trim() && !paths.trim()) setIsRequirement(false); onDirtyChange?.(true); save.reset(); }} disabled={save.isPending} placeholder="填写需求或其他审查重点，可留空" />
      </label>
      <label className="block text-slate-700">仓库文档路径
        <textarea aria-label="仓库文档路径" className="mt-1 block w-full rounded-lg border border-slate-200 p-2 font-mono" rows={3} value={paths}
          onChange={event => { const value = event.target.value; setPaths(value); if (!value.trim() && !context.trim()) setIsRequirement(false); onDirtyChange?.(true); save.reset(); }} disabled={save.isPending} placeholder={'每行一个仓库内相对路径，例如 docs/requirements.md'} />
      </label>
      <label className="flex items-center gap-2 text-slate-700">
        <input type="checkbox" checked={isRequirement && hasContext} disabled={save.isPending || !hasContext}
          onChange={event => { setIsRequirement(event.target.checked); onDirtyChange?.(true); save.reset(); }} />
        包含真实需求依据
      </label>
      <p className="text-xs text-slate-500">仅当说明或文档确实包含需求时勾选；审查重点与发布说明不自动视为需求。</p>
      {save.error ? <p role="alert" className="text-red-600">保存失败：{(save.error as unknown as NormalizedError).friendlyMessage || save.error.message}</p> : null}
      {save.isSuccess ? <p role="status" className="text-emerald-700">审查上下文已保存</p> : null}
      <Button type="primary" loading={save.isPending} onClick={() => save.mutate()}>保存审查上下文</Button>
    </> : <>
      {release.review_context ? <p className="whitespace-pre-wrap break-words">{release.review_context}</p> : null}
      {release.review_document_paths?.length ? <ul className="list-inside list-disc break-all font-mono">{release.review_document_paths.map(path => <li key={path}>{path}</li>)}</ul> : null}
      {release.review_context_is_requirement ? <p className="text-xs text-slate-600">已标记包含真实需求依据</p> : null}
    </>}
  </section>;
}
