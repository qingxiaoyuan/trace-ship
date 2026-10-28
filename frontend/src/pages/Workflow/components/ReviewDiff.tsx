import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { workflowApi } from '@/api/workflow';
import type { AiReviewData, AiReviewFinding, ReviewDiffFile } from '@/api/workflow';
import type { NormalizedError } from '@/api/request';
import { useAuthStore } from '@/stores/authStore';
import { uniqueHistoryFindings } from './reviewFindings';

type ReviewFinding = { finding: AiReviewFinding; nodeName: string; key: string };
type DiffLine = { text: string; oldLine?: number; newLine?: number; invalid?: boolean; kind: 'header' | 'added' | 'deleted' | 'context' | 'other' };
const PAGE_SIZE = 200;

/** 仅在整个差异块的行数与头部一致时显示行号，其他内容保留原文。 */
function parseLines(diff: string): DiffLine[] {
  const raw = diff.split('\n');
  const lines: DiffLine[] = raw.map((text) => ({ text, kind: 'other' }));
  let index = 0;
  while (index < raw.length) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw[index]);
    if (!match) { index++; continue; }
    const start = index;
    let oldLine = Number(match[1]);
    let newLine = Number(match[3]);
    let oldLeft = Number(match[2] ?? '1');
    let newLeft = Number(match[4] ?? '1');
    let valid = true;
    lines[index] = { text: raw[index], kind: 'header' };
    index++;
    while (index < raw.length && !/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.test(raw[index])) {
      const text = raw[index];
      const line: DiffLine = { text, kind: 'other' };
      if (text.startsWith('\\ No newline at end of file') || (index === raw.length - 1 && text === '')) {
        // 末尾换行和无换行提示不参与代码行计数。
      } else if (text.startsWith('-')) {
        line.kind = 'deleted';
        if (oldLeft-- <= 0) valid = false;
        else line.oldLine = oldLine++;
      } else if (text.startsWith('+')) {
        line.kind = 'added';
        if (newLeft-- <= 0) valid = false;
        else line.newLine = newLine++;
      } else if (text.startsWith(' ')) {
        line.kind = 'context';
        if (oldLeft-- <= 0 || newLeft-- <= 0) valid = false;
        else { line.oldLine = oldLine++; line.newLine = newLine++; }
      } else valid = false;
      lines[index] = line;
      index++;
    }
    if (!valid || oldLeft !== 0 || newLeft !== 0) {
      for (let position = start; position < index; position++) {
        delete lines[position].oldLine;
        delete lines[position].newLine;
        lines[position].invalid = true;
      }
    }
  }
  const oldLines = new Set<number>();
  const newLines = new Set<number>();
  let duplicate = false;
  for (const line of lines) {
    if (line.oldLine !== undefined) {
      if (oldLines.has(line.oldLine)) duplicate = true;
      oldLines.add(line.oldLine);
    }
    if (line.newLine !== undefined) {
      if (newLines.has(line.newLine)) duplicate = true;
      newLines.add(line.newLine);
    }
  }
  if (duplicate || lines.some((line) => line.invalid)) {
    for (const line of lines) {
      delete line.oldLine;
      delete line.newLine;
      if (duplicate) line.invalid = true;
    }
  }
  return lines;
}

function fileName(file: ReviewDiffFile): string {
  return file.renamed_file && file.old_path !== file.new_path
    ? `${file.old_path} → ${file.new_path}` : file.new_path || file.old_path;
}

function FindingCard({ item }: { item: ReviewFinding }) {
  const { finding } = item;
  return <div className="min-w-0 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-slate-800">
    <div className="flex flex-wrap items-center gap-2"><span className="rounded bg-amber-100 px-1.5 text-xs font-semibold text-amber-800">{finding.severity}</span><strong className="break-words">{finding.title}</strong></div>
    <p className="mt-1 text-xs text-slate-500">{item.nodeName}</p>
    <div className="mt-2 whitespace-pre-wrap break-words [&_pre]:overflow-x-auto"><Markdown remarkPlugins={[remarkGfm]}>{finding.reason}</Markdown></div>
    {finding.suggestion ? <div className="mt-2 whitespace-pre-wrap break-words text-slate-600 [&_pre]:overflow-x-auto"><span>建议：</span><Markdown remarkPlugins={[remarkGfm]}>{finding.suggestion}</Markdown></div> : null}
  </div>;
}

function DiffFile({ file, items }: { file: ReviewDiffFile; items: ReviewFinding[] }) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const lines = useMemo(() => expanded ? parseLines(file.diff) : [], [expanded, file.diff]);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of lines) {
      for (const [side, number] of [['old', line.oldLine], ['new', line.newLine]] as const) {
        if (number !== undefined) {
          const key = `${side}:${number}`;
          map.set(key, (map.get(key) || 0) + 1);
        }
      }
    }
    return map;
  }, [lines]);
  const canLocate = (finding: AiReviewFinding) => {
    const { side, line_start: start, line_end: end } = finding;
    if (!side || !Number.isInteger(start) || !Number.isInteger(end) || !start || !end || start < 1 || end < start || end - start >= 500) return false;
    for (let number = start; number <= end; number++) if (counts.get(`${side}:${number}`) !== 1) return false;
    return true;
  };
  const unlocated = items.filter(({ finding }) => expanded ? !canLocate(finding) : !finding.side || !finding.line_start);
  const byLine = new Map<string, ReviewFinding[]>();
  for (const item of items) {
    if (!canLocate(item.finding)) continue;
    const key = `${item.finding.side}:${item.finding.line_start}`;
    byLine.set(key, [...(byLine.get(key) || []), item]);
  }
  const located = items.filter(({ finding }) => expanded ? canLocate(finding) : !!finding.side && !!finding.line_start);
  const target = located.find((item) => item.key === targetKey);
  const targetIndex = target && expanded ? lines.findIndex((line) =>
    (target.finding.side === 'old' ? line.oldLine : line.newLine) === target.finding.line_start) : -1;
  const currentPage = targetIndex >= 0 ? Math.floor(targetIndex / PAGE_SIZE) : page;
  return <article aria-label={fileName(file)} className="min-w-0 rounded-lg border border-slate-200">
    <div className="space-y-2 border-b border-slate-200 p-3">
      <h5 className="break-all font-mono text-xs font-semibold">{fileName(file)}</h5>
      <p className="text-xs text-slate-500">{file.renamed_file ? '重命名' : file.new_file ? '新增文件' : file.deleted_file ? '删除文件' : '修改文件'}</p>
      {unlocated.length ? <p className="text-xs text-slate-500">文件级意见（未能可靠定位到行）</p> : null}
      {unlocated.map((item) => <FindingCard key={item.key} item={item} />)}
      {located.length ? <div className="space-y-1 text-xs text-indigo-700">{located.map((item) => <button type="button" key={item.key}
        className="block max-w-full break-words text-left underline" onClick={() => { setExpanded(true); setTargetKey(item.key); }}>
        {expanded ? `跳转至 ${item.finding.title}（${item.finding.side === 'old' ? '旧侧' : '新侧'}第 ${item.finding.line_start} 行）` : `查看意见：${item.finding.title}`}</button>)}</div> : null}
      {file.diff ? <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700" onClick={() => { setExpanded(!expanded); setTargetKey(null); setPage(0); }}>{expanded ? '收起代码差异' : '展开代码差异'}</button> : null}
    </div>
    {file.binary || file.too_large || file.collapsed || !file.diff ? <p className="p-3 text-sm text-amber-700">此文件差异不可完整读取，请结合覆盖范围核对。</p> : null}
    {expanded && lines.some((line) => line.invalid) ? <p className="p-3 text-sm text-amber-700">差异块不完整或行数不匹配，无法可靠定位行号；原文已保留。</p> : null}
    {file.diff && expanded ? <div className="max-w-full overflow-x-auto" aria-label={`${fileName(file)} 代码差异`}>
      <div className="min-w-max font-mono text-xs">
        {lines.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((line, index) => {
          const attached = [
            ...(byLine.get(`old:${line.oldLine}`) || []),
            ...(byLine.get(`new:${line.newLine}`) || []),
          ];
          return <div key={index} className={line.kind === 'added' ? 'bg-emerald-50' : line.kind === 'deleted' ? 'bg-rose-50' : ''}>
            <div className="flex min-w-max"><span className="w-12 shrink-0 select-none px-1 text-right text-slate-400" aria-label={line.oldLine === undefined ? undefined : `旧侧第 ${line.oldLine} 行`}>{line.oldLine ?? ''}</span>
              <span className="w-12 shrink-0 select-none px-1 text-right text-slate-400" aria-label={line.newLine === undefined ? undefined : `新侧第 ${line.newLine} 行`}>{line.newLine ?? ''}</span>
              <span aria-hidden="true" className="w-4 shrink-0 text-center text-slate-500">{line.kind === 'added' ? '+' : line.kind === 'deleted' ? '−' : ''}</span>
              <code className="whitespace-pre px-2">{['added', 'deleted', 'context'].includes(line.kind) ? line.text.slice(1) : line.text}</code></div>
            {attached.map((item) => <div key={item.key} data-line-side={item.finding.side} className="mx-2 my-2 max-w-[min(72rem,calc(100vw-4rem))] whitespace-normal font-sans"><FindingCard item={item} /></div>)}
          </div>;
        })}
      </div>
    </div> : null}
    {expanded && lines.length > PAGE_SIZE ? <div className="flex items-center gap-3 border-t border-slate-200 p-3 text-xs">
      <button type="button" disabled={currentPage === 0} className="rounded border px-2 py-1 disabled:opacity-40" onClick={() => { setTargetKey(null); setPage(currentPage - 1); }}>上一页</button>
      <span>第 {currentPage + 1} / {Math.ceil(lines.length / PAGE_SIZE)} 页（共 {lines.length} 行）</span>
      <button type="button" disabled={(currentPage + 1) * PAGE_SIZE >= lines.length} className="rounded border px-2 py-1 disabled:opacity-40" onClick={() => { setTargetKey(null); setPage(currentPage + 1); }}>下一页</button>
    </div> : null}
  </article>;
}

/** 在审批实例固定差异旁呈现对应意见；读取接口每次独立检查权限。 */
export function ReviewDiff({ instanceId, reviews }: { instanceId: string; reviews: AiReviewData[] }) {
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<{ instanceId: string; index: number } | null>(null);
  const sessionVersion = useAuthStore((state) => state.sessionVersion);
  const query = useQuery({ queryKey: ['review-diff', instanceId, sessionVersion], queryFn: () => workflowApi.getReviewDiff(instanceId), enabled: open, retry: false, gcTime: 0 });
  const findings = useMemo(() => reviews.flatMap((review) => {
    const nodeName = review.node_name || 'AI 代码审查';
    const current = (review.findings || []).map((finding, index) => ({
      finding, nodeName: `${nodeName} · 当前执行`, key: `${review.node_id}:current:${finding.id || index}`,
    }));
    const unique = uniqueHistoryFindings(review);
    const history = (review.history || []).flatMap((attempt, attemptIndex) => (unique.get(attempt.token) || []).map((finding, index) => ({
      finding, nodeName: `${nodeName} · 第 ${attemptIndex + 1} 次历史执行`, key: `${review.node_id}:${attempt.token}:${finding.id || index}`,
    })));
    return [...current, ...history];
  }), [reviews]);
  if (!reviews.some((review) => review.findings !== undefined || review.history !== undefined)) return null;
  const files = query.data?.diffs || [];
  const selectedIndex = selection?.instanceId === instanceId && selection.index < files.length ? selection.index : 0;
  const assignments = files.map(() => [] as ReviewFinding[]);
  const unassigned: ReviewFinding[] = [];
  for (const item of findings) {
    const { path, side } = item.finding;
    const matches = files.map((file, index) => ({ file, index })).filter(({ file }) => path &&
      (side === 'old' ? file.old_path === path : side === 'new' ? file.new_path === path : file.old_path === path || file.new_path === path));
    if (matches.length === 1) assignments[matches[0].index].push(item);
    else unassigned.push(item);
  }
  return <div className="min-w-0 space-y-3">
    <button type="button" className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50" onClick={() => setOpen(!open)}>{open ? '收起代码差异' : '查看代码差异'}</button>
    {open && query.isFetching ? <p className="text-sm text-slate-500">正在读取本轮固定差异…</p> : null}
    {open && query.error ? <div role="alert" className="rounded bg-rose-50 p-3 text-sm text-rose-700">代码差异读取失败：{(query.error as unknown as NormalizedError).friendlyMessage || '请稍后重试'} <button type="button" className="underline" onClick={() => void query.refetch()}>重试</button></div> : null}
    {open && !query.isFetching && !query.error && query.data ? <section aria-label="本轮代码差异" className="min-w-0 space-y-3">
      {query.data.status === 'incomplete' ? <p className="text-sm text-amber-700">本轮差异未完整取得，以下内容仅为已保存部分。</p> : null}
      {files.length === 0 ? <p className="text-sm text-slate-500">本轮没有可展示的代码差异。</p> : <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 md:grid md:grid-cols-[190px_minmax(0,1fr)]">
        <div className="max-h-72 overflow-y-auto border-b border-slate-100 bg-slate-50/60 p-2 md:border-b-0 md:border-r" aria-label="差异文件列表">
          <p className="px-2 py-2 text-xs text-slate-500">变更文件 · {files.length}</p>
          {files.map((file, index) => <button type="button" key={`${index}:${file.old_path}:${file.new_path}`} aria-label={`查看文件 ${fileName(file)}`} aria-pressed={selectedIndex === index}
            onClick={() => setSelection({ instanceId, index })}
            className={`mb-1 block w-full rounded-lg px-2 py-2 text-left text-xs ${selectedIndex === index ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}>
            <span className="block break-all">{fileName(file)}</span>{assignments[index].length ? <span className="mt-1 block text-slate-400">{assignments[index].length} 条意见</span> : null}
          </button>)}
        </div>
        <div className="min-w-0 p-3">{files.map((file, index) => <div key={`${instanceId}:${index}:${file.old_path}:${file.new_path}`} hidden={selectedIndex !== index}>
          <DiffFile file={file} items={assignments[index]} />
        </div>)}</div>
      </div>}
      {unassigned.length ? <div className="space-y-2"><h5 className="font-semibold">整体或无法可靠定位的意见</h5>{unassigned.map((item) => <FindingCard key={item.key} item={item} />)}</div> : null}
    </section> : null}
  </div>;
}
