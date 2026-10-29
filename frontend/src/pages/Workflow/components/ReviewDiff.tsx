import { ReviewMarkdown } from './ReviewMarkdown';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from 'antd';
import { FileCode2, GitCompareArrows, MessageSquare } from 'lucide-react';
import { workflowApi } from '@/api/workflow';
import type { AiReviewData, AiReviewFinding, ReviewDiffFile } from '@/api/workflow';
import type { NormalizedError } from '@/api/request';
import { useAuthStore } from '@/stores/authStore';
import { uniqueHistoryFindings } from './reviewFindings';
import { FindingRemediationAction } from './ReviewRemediations';

type ReviewFinding = { finding: AiReviewFinding; nodeId: string; nodeName: string; key: string };
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
  const severityTone = finding.severity === 'P0' || finding.severity === 'P1' ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-amber-50 text-amber-800 ring-amber-200';
  const location = !finding.path ? '整体意见' : `${finding.path}${finding.side && finding.line_start ? ` · ${finding.side === 'old' ? '旧侧' : '新侧'} ${finding.line_start}${finding.line_end && finding.line_end !== finding.line_start ? `–${finding.line_end}` : ''} 行` : ' · 文件级意见'}`;
  return <article aria-label={`审查意见：${finding.title}`} className="min-w-0 overflow-hidden rounded-lg border border-indigo-200 bg-white text-sm text-slate-700 shadow-sm shadow-slate-200/30">
    <div className="flex flex-wrap items-center gap-2 border-b border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs">
      <MessageSquare className="h-3.5 w-3.5 shrink-0 text-indigo-500" strokeWidth={1.5} /><span className="font-medium text-indigo-800">AI 审查</span>
      <span className="text-slate-400">{item.nodeName}</span><span className={`ml-auto rounded px-1.5 py-0.5 font-semibold ring-1 ring-inset ${severityTone}`}>{finding.severity}</span>
    </div>
    <div className="space-y-3 p-3 sm:p-4">
      <strong className="block break-words text-slate-900">{finding.title}</strong>
      <p className="break-all font-mono text-[11px] text-slate-400">{location}</p>
      <div className="whitespace-pre-wrap break-words leading-6 [&_pre]:max-w-full [&_pre]:overflow-x-auto"><ReviewMarkdown>{finding.reason}</ReviewMarkdown></div>
      {finding.suggestion ? <div className="border-l-2 border-indigo-200 pl-3"><p className="mb-1 text-xs font-medium text-slate-500">修改建议</p><div className="whitespace-pre-wrap break-words leading-6 [&_pre]:max-w-full [&_pre]:overflow-x-auto"><ReviewMarkdown>{finding.suggestion}</ReviewMarkdown></div></div> : null}
      <FindingRemediationAction nodeId={item.nodeId} finding={finding} />
    </div>
  </article>;
}

function FindingList({ items }: { items: ReviewFinding[] }) {
  const [page, setPage] = useState(0);
  const lastPage = Math.max(0, Math.ceil(items.length / 20) - 1);
  const currentPage = Math.min(page, lastPage);
  return <div className="space-y-3">
    {items.slice(currentPage * 20, (currentPage + 1) * 20).map((item) => <FindingCard key={item.key} item={item} />)}
    {lastPage > 0 ? <div className="flex items-center gap-3 text-xs text-slate-500">
      <button type="button" aria-label="意见上一页" disabled={currentPage === 0} className="min-h-9 px-2 disabled:opacity-40" onClick={() => setPage(currentPage - 1)}>上一页</button>
      <span>{currentPage + 1} / {lastPage + 1}</span>
      <button type="button" aria-label="意见下一页" disabled={currentPage === lastPage} className="min-h-9 px-2 disabled:opacity-40" onClick={() => setPage(currentPage + 1)}>下一页</button>
    </div> : null}
  </div>;
}

function DiffFile({ file, items }: { file: ReviewDiffFile; items: ReviewFinding[] }) {
  const [page, setPage] = useState(0);
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const lines = useMemo(() => parseLines(file.diff), [file.diff]);
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
  const unlocated = items.filter(({ finding }) => !canLocate(finding));
  const byLine = new Map<string, ReviewFinding[]>();
  for (const item of items) {
    if (!canLocate(item.finding)) continue;
    const key = `${item.finding.side}:${item.finding.line_start}`;
    byLine.set(key, [...(byLine.get(key) || []), item]);
  }
  const located = items.filter(({ finding }) => canLocate(finding));
  const target = located.find((item) => item.key === targetKey);
  const targetIndex = target ? lines.findIndex((line) =>
    (target.finding.side === 'old' ? line.oldLine : line.newLine) === target.finding.line_start) : -1;
  const currentPage = targetIndex >= 0 ? Math.floor(targetIndex / PAGE_SIZE) : page;
  const jumpTo = (key: string) => {
    setTargetKey(key);
    requestAnimationFrame(() => document.getElementById(`review-finding-${key}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  };
  return <article aria-label={fileName(file)} className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
    <div className="space-y-2 border-b border-slate-200 bg-slate-50 px-3 py-3"><div className="flex items-start gap-2">
      <FileCode2 className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.5} /><h5 className="min-w-0 flex-1 break-all font-mono text-xs font-semibold text-slate-700">{fileName(file)}</h5>
      <span className="text-[11px] text-slate-400">{file.renamed_file ? '重命名' : file.new_file ? '新增文件' : file.deleted_file ? '删除文件' : '修改文件'}</span></div>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-mono text-[11px]"><span className="text-emerald-600">+{lines.filter(line => line.kind === 'added').length}</span><span className="ml-2 text-rose-500">−{lines.filter(line => line.kind === 'deleted').length}</span></p>
      {located.length ? <select aria-label="跳转到审查意见" value="" className="min-h-9 max-w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-600" onChange={(event) => jumpTo(event.target.value)}>
        <option value="" disabled>{located.length} 条行内意见 · 跳转</option>
        {located.map((item) => <option key={item.key} value={item.key}>{item.finding.severity} · {item.finding.side === 'old' ? '旧侧' : '新侧'} L{item.finding.line_start} · {item.finding.title}</option>)}
      </select> : null}</div>
    </div>
    {unlocated.length ? <div className="space-y-3 border-b border-slate-200 bg-slate-50/60 p-3"><p className="text-xs text-slate-500">文件级意见（未能可靠定位到行）</p><FindingList items={unlocated} /></div> : null}
    {file.binary || file.too_large || file.collapsed || !file.diff ? <p className="p-3 text-sm text-amber-700">此文件差异不可完整读取，请结合覆盖范围核对。</p> : null}
    {lines.some((line) => line.invalid) ? <p className="p-3 text-sm text-amber-700">差异块不完整或行数不匹配，无法可靠定位行号；原文已保留。</p> : null}
    {file.diff ? <div aria-label={`${fileName(file)} 代码差异`} className="min-w-0 py-1 font-mono text-xs leading-6">
      {lines.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((line, index) => {
        const attached = [...(byLine.get(`old:${line.oldLine}`) || []), ...(byLine.get(`new:${line.newLine}`) || [])];
        return <div key={index}>
          <div className={`grid grid-cols-[2.25rem_2.25rem_1rem_minmax(0,1fr)] sm:grid-cols-[2.75rem_2.75rem_1rem_minmax(0,1fr)] ${line.kind === 'added' ? 'bg-emerald-50' : line.kind === 'deleted' ? 'bg-rose-50' : line.kind === 'header' ? 'bg-sky-50/70 text-sky-800' : ''}`}>
            <span className="select-none px-1 text-right text-slate-400" aria-label={line.oldLine === undefined ? undefined : `旧侧第 ${line.oldLine} 行`}>{line.oldLine ?? ''}</span>
            <span className="select-none px-1 text-right text-slate-400" aria-label={line.newLine === undefined ? undefined : `新侧第 ${line.newLine} 行`}>{line.newLine ?? ''}</span>
            <span aria-hidden="true" className="select-none text-center text-slate-500">{line.kind === 'added' ? '+' : line.kind === 'deleted' ? '−' : ''}</span>
            <code className="min-w-0 whitespace-pre-wrap px-2 [overflow-wrap:anywhere]">{['added', 'deleted', 'context'].includes(line.kind) ? line.text.slice(1) : line.text}</code>
          </div>
          {attached.map((item) => <div id={`review-finding-${item.key}`} key={item.key} data-line-side={item.finding.side} className="border-y border-slate-100 bg-slate-50/50 px-2 py-4 font-sans sm:pl-12 sm:pr-4"><FindingCard item={item} /></div>)}
        </div>;
      })}
    </div> : null}
    {lines.length > PAGE_SIZE ? <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 p-3 text-xs text-slate-500">
      <button type="button" disabled={currentPage === 0} className="min-h-9 rounded border px-2 disabled:opacity-40" onClick={() => { setTargetKey(null); setPage(currentPage - 1); }}>上一页</button>
      <span>第 {currentPage + 1} / {Math.ceil(lines.length / PAGE_SIZE)} 页（共 {lines.length} 行）</span>
      <button type="button" disabled={(currentPage + 1) * PAGE_SIZE >= lines.length} className="min-h-9 rounded border px-2 disabled:opacity-40" onClick={() => { setTargetKey(null); setPage(currentPage + 1); }}>下一页</button>
    </div> : null}
  </article>;
}

/** 默认以固定代码差异呈现审查，正文读取仍由独立接口鉴权。 */
export function ReviewDiff({ instanceId, reviews, active = true }: { instanceId: string; reviews: AiReviewData[]; active?: boolean }) {
  const [selection, setSelection] = useState<{ instanceId: string; index: number } | null>(null);
  const sessionVersion = useAuthStore((state) => state.sessionVersion);
  const canRead = reviews.some((review) => review.findings !== undefined || review.history !== undefined);
  const query = useQuery({ queryKey: ['review-diff', instanceId, sessionVersion], queryFn: () => workflowApi.getReviewDiff(instanceId), enabled: active && canRead, retry: false, gcTime: 0 });
  const findings = useMemo(() => reviews.flatMap((review) => {
    const nodeName = review.node_name || 'AI 代码审查';
    const current = (review.findings || []).map((finding, index) => ({
      finding, nodeId: review.node_id, nodeName: `${nodeName} · 当前执行`, key: `${review.node_id}:current:${finding.id || index}`,
    }));
    const unique = uniqueHistoryFindings(review);
    const history = (review.history || []).flatMap((attempt, attemptIndex) => (unique.get(attempt.token) || []).map((finding, index) => ({
      finding, nodeId: review.node_id, nodeName: `${nodeName} · 第 ${attemptIndex + 1} 次历史执行`, key: `${review.node_id}:${attempt.token}:${finding.id || index}`,
    })));
    return [...current, ...history];
  }), [reviews]);
  if (!canRead) return null;
  const files = query.error || !query.isFetchedAfterMount ? [] : query.data?.diffs || [];
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
  const loading = query.isLoading || !query.isFetchedAfterMount;
  return <section aria-label="本轮代码差异" className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="flex items-center gap-2 font-semibold text-slate-800"><GitCompareArrows className="h-4 w-4 text-slate-400" strokeWidth={1.5} />代码变更与审查意见</h4>
      <span className="text-xs text-slate-400">{files.length} 个文件 · {findings.length} 条意见</span>
    </div>
    {loading ? <p className="text-sm text-slate-500">正在读取本轮固定差异…</p> : null}
    {query.error ? <div role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">代码差异读取失败：{(query.error as unknown as NormalizedError).friendlyMessage || '请稍后重试'}；审查意见保留在下方。<Button size="small" aria-label="重新读取代码差异" className="ml-2 max-md:min-h-9" onClick={() => void query.refetch()}>重试</Button></div> : null}
    {!loading && !query.error && query.data ? <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-500"><span>固定审查范围</span><code className="break-all text-slate-700" title={query.data.base_git_hash}>{query.data.base_git_hash?.slice(0, 12) || '首次发布'}</code><span aria-hidden="true">→</span><code className="break-all text-slate-700" title={query.data.head_git_hash}>{query.data.head_git_hash?.slice(0, 12) || '未取得'}</code></div>
      {query.data.status === 'incomplete' ? <p className="text-sm text-amber-700">本轮差异未完整取得，以下内容仅为已保存部分。</p> : null}
      {files.length === 0 ? <p className="text-sm text-slate-500">本轮没有可展示的代码差异。</p> : <div className="grid min-w-0 grid-cols-1 items-start gap-3 xl:grid-cols-[180px_minmax(0,1fr)]">
        <nav className="max-h-64 min-w-0 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/60 p-2 xl:sticky xl:top-4 xl:max-h-[65vh]" aria-label="差异文件列表">
          <p className="px-2 py-2 text-[11px] font-medium text-slate-400">变更文件</p>
          {files.map((file, index) => <button type="button" key={`${index}:${file.old_path}:${file.new_path}`} aria-label={`查看文件 ${fileName(file)}`} aria-pressed={selectedIndex === index}
            onClick={() => setSelection({ instanceId, index })}
            className={`mb-1 flex min-h-9 w-full items-start gap-2 rounded-md px-2 py-2.5 text-left text-xs transition-colors ${selectedIndex === index ? 'bg-indigo-100/70 font-medium text-indigo-800' : 'text-slate-600 hover:bg-slate-100'}`}>
            <FileCode2 className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" strokeWidth={1.5} /><span className="min-w-0 flex-1" title={fileName(file)}><span className="block truncate font-mono leading-5">{(file.new_path || file.old_path).split('/').pop()}</span><span className="mt-0.5 block truncate text-[10px] font-normal text-slate-400">{(file.new_path || file.old_path).split('/').slice(0, -1).join('/') || '根目录'}</span></span>
            {assignments[index].length ? <span aria-label={`${assignments[index].length} 条意见`} className="mt-0.5 shrink-0 rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600">{assignments[index].length}</span> : null}
          </button>)}
        </nav>
        <DiffFile key={`${instanceId}:${sessionVersion}:${selectedIndex}`} file={files[selectedIndex]} items={assignments[selectedIndex]} />
      </div>}
    </> : null}
    {!loading && unassigned.length ? <div className="space-y-3"><h5 className="text-xs font-medium text-slate-500">{files.length ? '整体或无法可靠定位的意见' : '审查意见'}</h5><FindingList items={unassigned} /></div> : null}
    {!loading && !findings.length ? <p className="text-sm text-slate-500">未报告意见，仍需人工判断。</p> : null}
  </section>;
}
