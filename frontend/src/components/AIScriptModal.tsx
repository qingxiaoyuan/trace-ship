import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Spin, Switch } from 'antd';
import { Check, RefreshCw, Sparkles, WandSparkles } from 'lucide-react';
import AceEditor from 'react-ace';
import ace, { type Ace } from 'ace-builds';

import 'ace-builds/src-noconflict/mode-batchfile';
import 'ace-builds/src-noconflict/mode-sh';
import 'ace-builds/src-noconflict/theme-github';
import type { AIScriptDraft, AIScriptStreamEvent } from '@/types';

const Range = ace.require('ace/range').Range as new (
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
) => Ace.Range;

interface AIScriptModalProps {
  open: boolean;
  lang: 'sh' | 'bat';
  filename: string;
  /** 由父组件发起请求（组装表单 payload 调用后端） */
  onGenerate: (hint: string, referenceExemplars: boolean) => Promise<AIScriptDraft>;
  /** 优先使用 SSE 流式生成（实时展示 AI 输出片段） */
  onGenerateStream?: (
    hint: string,
    referenceExemplars: boolean,
  ) => AsyncGenerator<AIScriptStreamEvent>;
  /** 用户点击「应用到配置」时回调脚本内容 */
  onApply: (script: string) => void;
  onClose: () => void;
}

type ErrorLike = { friendlyMessage?: string; message?: string };

/** AI 生成打包脚本弹窗：可选补充说明 → 生成 → 脚本 + 逐行解释 → 应用到配置 */
export function AIScriptModal({
  open,
  lang,
  filename,
  onGenerate,
  onGenerateStream,
  onApply,
  onClose,
}: AIScriptModalProps) {
  const [hint, setHint] = useState('');
  const [referenceExemplars, setReferenceExemplars] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<AIScriptDraft | null>(null);
  const [streamText, setStreamText] = useState('');
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const editorRef = useRef<AceEditor | null>(null);
  const markerRef = useRef<number | null>(null);
  const editorContainerRef = useRef<HTMLDivElement | null>(null);

  // 弹窗动画 / 高 DPI / 窗口缩放导致容器尺寸变化时同步 Ace 渲染层，避免光标错位
  useEffect(() => {
    const el = editorContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      editorRef.current?.editor.resize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const generate = async () => {
    setLoading(true);
    setError('');
    setStreamText('');
    setProgressLog([]);
    try {
      if (onGenerateStream) {
        let result: AIScriptDraft | null = null;
        for await (const event of onGenerateStream(hint, referenceExemplars)) {
          if (event.type === 'progress') {
            setProgressLog((prev) => [...prev, event.message]);
          } else if (event.type === 'delta') {
            setStreamText((prev) => prev + event.text);
          } else if (event.type === 'done') {
            result = event.data;
          } else {
            throw new Error(event.message);
          }
        }
        if (!result) {
          throw new Error('AI 未返回结果，请重试');
        }
        setDraft(result);
      } else {
        const result = await onGenerate(hint, referenceExemplars);
        setDraft(result);
      }
    } catch (err) {
      const e = err as ErrorLike;
      setError(e?.friendlyMessage || e?.message || '生成失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  /** 点击解释条目：跳转到对应行并高亮 */
  const focusLine = (line: number) => {
    const editor = editorRef.current?.editor;
    if (!editor) return;
    editor.gotoLine(line, 0, true);
    const session = editor.session;
    if (markerRef.current !== null) {
      session.removeMarker(markerRef.current);
    }
    const range = new Range(line - 1, 0, line - 1, Number.MAX_SAFE_INTEGER);
    markerRef.current = session.addMarker(range, 'ai-script-highlight-line', 'text');
  };

  const warnings = [
    draft?.repo_scan_warning && `仓库上下文：${draft.repo_scan_warning}`,
    draft?.container_probe_warning && `容器探测：${draft.container_probe_warning}`,
    draft?.node_probe_warning && `节点探测：${draft.node_probe_warning}`,
  ].filter(Boolean) as string[];

  const referencedCount = draft?.referenced_scripts?.length ?? 0;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={1080}
      centered
      destroyOnHidden
      title={
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-indigo-100 bg-indigo-50 text-indigo-600">
            <Sparkles className="h-4 w-4" strokeWidth={1.5} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold tracking-tight text-slate-900">AI 生成打包脚本</span>
              <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-amber-600">
                Beta
              </span>
            </div>
            <div className="font-mono text-[11px] font-normal text-slate-400">
              测试版功能：生成结果仅供人工核对参考，草稿不会自动保存，确认后可应用到脚本编辑器
            </div>
          </div>
        </div>
      }
      footer={
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] text-slate-400">
            {draft ? `${draft.script.split('\n').length} 行` : `${lang === 'bat' ? 'bat' : 'sh'} 脚本`}
          </span>
          <div className="flex items-center gap-2">
            <Button onClick={onClose}>关闭</Button>
            {draft && (
              <Button icon={<RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />} onClick={generate}>
                重新生成
              </Button>
            )}
            <Button
              type="primary"
              disabled={!draft}
              icon={<Check className="h-3.5 w-3.5" strokeWidth={2} />}
              onClick={() => draft && onApply(draft.script)}
            >
              应用到配置
            </Button>
          </div>
        </div>
      }
      styles={{ body: { maxHeight: '72vh', overflowY: 'auto' } }}
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-slate-600">补充说明（可选）</label>
          <div className="flex items-start gap-2">
            <textarea
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              disabled={loading}
              rows={2}
              placeholder="例如：Vue3 + npm，构建前先 npm ci，产物在 dist；远程节点已装 .NET SDK"
              className="flex-1 resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50"
            />
            <Button
              type="primary"
              loading={loading}
              onClick={generate}
              icon={<WandSparkles className="h-3.5 w-3.5" strokeWidth={2} />}
            >
              生成脚本
            </Button>
          </div>
          {loading && (
            <div className="mt-3 flex items-center gap-2 text-[12px] text-slate-400">
              <Spin size="small" />
              正在扫描仓库、探测环境并调用 AI 生成，可能需要 1-3 分钟…
            </div>
          )}
          {loading && (progressLog.length > 0 || streamText) && (
            <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-900">
              <div className="border-b border-slate-700/60 bg-slate-800/60 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">
                AI 正在生成…
              </div>
              <div className="max-h-40 overflow-y-auto px-3 py-2">
                {progressLog.map((message, index) => (
                  <div key={`${index}-${message}`} className="text-[11px] leading-5 text-slate-300">
                    ▸ {message}
                  </div>
                ))}
                {streamText && (
                  <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] leading-5 text-emerald-300">
                    {streamText}
                  </pre>
                )}
              </div>
            </div>
          )}
          <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
            <div>
              <div className="text-[12px] font-medium text-slate-700">参考历史成功脚本</div>
              <div className="text-[10px] text-slate-400">
                仅引用平台内真实打包成功的脚本，同项目优先、跨项目兜底
              </div>
            </div>
            <Switch
              size="small"
              checked={referenceExemplars}
              disabled={loading}
              onChange={setReferenceExemplars}
            />
          </div>
        </div>

        {error && <Alert type="error" showIcon message={error} className="mt-3" />}

        {warnings.length > 0 && (
          <Alert
            type="warning"
            showIcon
            message="部分上下文获取失败，脚本可能不够准确"
            className="mt-3"
            description={warnings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          />
        )}

        {draft && (
          <>
            {draft.summary && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2">
                <span className="text-[12px] text-slate-600">{draft.summary}</span>
                <span className="ml-auto shrink-0 rounded-md border border-indigo-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-indigo-600">
                  {draft.model}
                </span>
              </div>
            )}
            {referencedCount > 0 && (
              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-1.5 text-[11px] text-slate-500">
                参考了 {referencedCount} 个历史成功脚本：
                {draft?.referenced_scripts?.slice(0, 3).map((s) => (
                  <span key={`${s.project_name}-${s.repository_name}-${s.version}`} className="mr-1">
                    {s.project_name}/{s.repository_name}（{s.version}，成功 {s.success_count} 次）
                  </span>
                ))}
              </div>
            )}
            <div className="mt-3 flex h-[46vh] gap-3">
              <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-[#fbfcfe]">
                <div className="flex items-center gap-1 border-b border-slate-100 bg-white px-2.5 py-1.5">
                  <WandSparkles className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />
                  <span className="font-mono text-[11px] text-slate-500">{filename}</span>
                  <span className="ml-auto rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-amber-600">
                    {lang === 'bat' ? 'bat' : 'sh'}
                  </span>
                </div>
                <div ref={editorContainerRef} className="h-[calc(100%-33px)]">
                  <AceEditor
                    ref={editorRef}
                    mode={lang === 'bat' ? 'batchfile' : 'sh'}
                    theme="github"
                    name="ai-script-preview"
                    value={draft.script}
                    readOnly
                    width="100%"
                    height="100%"
                    fontSize={12}
                    tabSize={2}
                    showPrintMargin={false}
                    highlightActiveLine={false}
                    setOptions={{
                      useWorker: false,
                      // 等宽字体 fallback：避免字体未加载时测量宽度失真导致高 DPI 光标错位
                      fontFamily: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
                      fixedWidthGutter: true,
                      showLineNumbers: true,
                      showGutter: true,
                      displayIndentGuides: false,
                      scrollPastEnd: true,
                    }}
                  />
                </div>
              </div>
              <div className="w-[340px] shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  逐行解释（{draft.explanations.length}）
                </div>
                <div className="max-h-full overflow-y-auto py-1">
                  {draft.explanations.length === 0 ? (
                    <div className="px-3 py-8 text-center text-[12px] text-slate-400">
                      AI 未返回逐行解释
                    </div>
                  ) : (
                    draft.explanations.map((item) => (
                      <button
                        key={`${item.line}-${item.reason}`}
                        type="button"
                        onClick={() => focusLine(item.line)}
                        className="flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors hover:bg-indigo-50"
                      >
                        <span className="mt-0.5 inline-flex h-4 min-w-6 shrink-0 items-center justify-center rounded bg-indigo-100 px-1 font-mono text-[10px] font-medium text-indigo-600">
                          {item.line}
                        </span>
                        <span className="text-[12px] leading-5 text-slate-600">{item.reason}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
