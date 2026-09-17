import { useEffect, useRef, useState } from 'react';
import AceEditor from 'react-ace';
import { Modal, Popover } from 'antd';
import { Braces, Check, ChevronDown, FileCode2, Info, Maximize2, Sparkles } from 'lucide-react';

import 'ace-builds/src-noconflict/mode-batchfile';
import 'ace-builds/src-noconflict/mode-sh';
import 'ace-builds/src-noconflict/theme-github';

export type ScriptLang = 'sh' | 'bat';

/** 可插入的环境变量（与打包执行注入变量一致），含中文含义说明 */
const SCRIPT_VARIABLES: { name: string; desc: string }[] = [
  { name: 'VERSION', desc: '版本号' },
  { name: 'TAG_NAME', desc: 'Tag 名称' },
  { name: 'PROJECT_CODE', desc: '项目编码' },
  { name: 'BUILD_PATH', desc: '构建目录（相对源码根）' },
  { name: 'OUTPUT_PATH', desc: '产物目录名' },
  { name: 'WORKSPACE', desc: '任务工作区根目录' },
  { name: 'SOURCE_DIR', desc: '源码目录' },
  { name: 'ARTIFACTS_DIR', desc: '产物输出目录' },
  { name: 'TMPDIR', desc: '临时目录' },
];

interface ScriptEditorFieldProps {
  value?: string;
  onChange?: (value: string) => void;
  lang: ScriptLang;
  /** 展示用文件名，如 pack-custom.bat */
  filename: string;
  /** 底栏提示 */
  hint?: string;
  /** 全屏模式（隐藏放大按钮，避免嵌套弹层） */
  fullscreen?: boolean;
  /** 只读模式：禁止编辑与插入变量，仍可放大查看 */
  readOnly?: boolean;
  /** 点击「AI 生成」按钮回调（由外层组装表单 payload 并打开 AI 弹窗） */
  onAiGenerate?: () => void;
}

/** 打包脚本编辑字段（Ace 编辑器）：工具栏 + 语法高亮 + 插入变量 + 放大编辑 */
export function ScriptEditorField({
  value,
  onChange,
  lang,
  filename,
  hint,
  fullscreen,
  readOnly,
  onAiGenerate,
}: ScriptEditorFieldProps) {
  const [expandOpen, setExpandOpen] = useState(false);
  const [varOpen, setVarOpen] = useState(false);
  const editorRef = useRef<AceEditor | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const script = value ?? '';

  // 高 DPI / 窗口缩放、弹窗动画导致容器尺寸变化时同步 Ace 渲染层，
  // 避免光标与文本位置错位
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      editorRef.current?.editor.resize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const langBadge = lang === 'bat' ? 'bat' : 'sh';

  const insertVariable = (name: string) => {
    const token = lang === 'bat' ? `%${name}%` : `$${name}`;
    const editor = editorRef.current?.editor;
    setVarOpen(false);
    if (editor) {
      // session.insert 自动把光标移到插入内容之后
      editor.session.insert(editor.getCursorPosition(), token);
      editor.focus();
    } else {
      onChange?.(script + token);
    }
  };

  /** 工具栏按钮统一阻止 mousedown 默认行为，避免夺走编辑器焦点与选区 */
  const keepFocus = { onMouseDown: (e: React.MouseEvent) => e.preventDefault() };

  const variablePanel = (
    <div className="max-h-[280px] w-[240px] overflow-y-auto py-1">
      {SCRIPT_VARIABLES.map((item) => (
        <button
          key={item.name}
          type="button"
          {...keepFocus}
          onClick={() => insertVariable(item.name)}
          className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left transition-colors hover:bg-indigo-50"
        >
          <span className="text-[12px] text-slate-600">{item.desc}</span>
          <span className="font-mono text-[11px] text-slate-400">
            {lang === 'bat' ? `%${item.name}%` : `$${item.name}`}
          </span>
        </button>
      ))}
    </div>
  );

  const toolbar = (
    <div className="flex items-center gap-1 border-b border-slate-100 bg-white px-2.5 py-1.5">
      <FileCode2 className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />
      <span className="font-mono text-[11px] text-slate-500">{filename}</span>
      <div className="ml-auto flex items-center gap-0.5">
        {!readOnly && onAiGenerate && (
          <button
            type="button"
            title="AI 生成脚本"
            {...keepFocus}
            onClick={onAiGenerate}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
            AI 生成
          </button>
        )}
        {!readOnly && (
          <Popover
            content={variablePanel}
            open={varOpen}
            onOpenChange={setVarOpen}
            trigger="click"
            placement="bottomRight"
            arrow={false}
          >
            <button
              type="button"
              title="插入变量"
              {...keepFocus}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
            >
              <Braces className="h-3.5 w-3.5" strokeWidth={1.5} />
              插入变量
              <ChevronDown className="h-3 w-3 text-slate-400" strokeWidth={1.5} />
            </button>
          </Popover>
        )}
        {!fullscreen && (
          <>
            <div className="mx-1 h-4 w-px bg-slate-200" />
            <button
              type="button"
              title="放大编辑"
              {...keepFocus}
              onClick={() => setExpandOpen(true)}
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600 max-md:inline-flex max-md:h-9 max-md:w-9 max-md:items-center max-md:justify-center"
            >
              <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </>
        )}
        {fullscreen && (
          <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-amber-600">
            {langBadge}
          </span>
        )}
      </div>
    </div>
  );

  const editor = (
    <AceEditor
      ref={editorRef}
      mode={lang === 'bat' ? 'batchfile' : 'sh'}
      theme="github"
      name={`script-editor-${filename}-${fullscreen ? 'full' : 'inline'}`}
      value={script}
      onChange={(v) => {
        // Windows 粘贴的 sh 脚本常带 CRLF，统一转成 LF，避免行尾 \r 影响 shell 执行
        const next = lang === 'sh' ? v.replace(/\r\n/g, '\n').replace(/\r/g, '\n') : v;
        onChange?.(next);
      }}
      readOnly={readOnly}
      width="100%"
      height="100%"
      fontSize={fullscreen ? 13 : 12}
      tabSize={2}
      showPrintMargin={false}
      highlightActiveLine
      focus={fullscreen}
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
  );

  return (
    <>
      <div
        className={`overflow-hidden rounded-xl border border-slate-200 bg-[#fbfcfe] transition-all focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-500/10 ${
          fullscreen ? 'flex h-full flex-col' : ''
        }`}
      >
        {toolbar}
        <div ref={containerRef} className={fullscreen ? 'min-h-0 flex-1' : 'h-[280px]'}>{editor}</div>
        {hint && (
          <div className="flex items-center gap-2 border-t border-slate-100 bg-white px-3 py-1.5 text-[10px] text-slate-400 max-md:text-xs">
            <Info className="h-3 w-3 shrink-0" strokeWidth={1.5} />
            {hint}
          </div>
        )}
      </div>

      {!fullscreen && (
        <Modal
          open={expandOpen}
          onCancel={() => setExpandOpen(false)}
          width={960}
          centered
          destroyOnHidden
          title={
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-indigo-100 bg-indigo-50 text-indigo-600">
                <FileCode2 className="h-4 w-4" strokeWidth={1.5} />
              </div>
              <div>
                <div className="text-[14px] font-semibold tracking-tight text-slate-900">编辑打包脚本</div>
                <div className="font-mono text-[11px] font-normal text-slate-400">{filename}</div>
              </div>
            </div>
          }
          footer={
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-[11px] text-slate-400">
                <Info className="h-3 w-3" strokeWidth={1.5} />
                {script.split('\n').length} 行
              </span>
              <button
                type="button"
                onClick={() => setExpandOpen(false)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-medium text-white shadow-sm transition-all hover:bg-indigo-500"
              >
                <Check className="h-3.5 w-3.5" strokeWidth={2} />
                完成
              </button>
            </div>
          }
          styles={{ body: { height: '52vh', display: 'flex', flexDirection: 'column' } }}
        >
          <div className="flex h-full flex-col">
            <ScriptEditorField
              value={script}
              onChange={onChange}
              lang={lang}
              filename={filename}
              readOnly={readOnly}
              fullscreen
            />
          </div>
        </Modal>
      )}
    </>
  );
}
