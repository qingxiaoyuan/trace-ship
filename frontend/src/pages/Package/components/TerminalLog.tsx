import { memo, useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Download, Info } from 'lucide-react';

/** 单行高度（11.5px 字号 × 行高 ≈ 18px），虚拟滚动需要固定行高 */
const LINE_HEIGHT = 18;

function lineClass(line: string): string {
  if (/✓|success|完成/.test(line)) return 'text-emerald-400';
  if (/\[WARN\]|\[warning\]/i.test(line)) return 'text-amber-400';
  if (/\[ERROR\]|fail|错误/i.test(line)) return 'text-rose-400';
  if (/\[INFO\]/i.test(line)) return 'text-blue-400';
  if (/^\[?\d{4}-\d{2}-\d{2}/.test(line)) return 'text-slate-500';
  return '';
}

interface TerminalLogProps {
  text: string;
  /** 仅加载了末尾部分日志（大日志首屏优化） */
  partial?: boolean;
  /** 下载完整日志 */
  onDownloadFull?: () => void;
}

/** 终端日志：虚拟滚动渲染，仅挂载可视区行，超大日志不卡顿 */
export const TerminalLog = memo(function TerminalLog({ text, partial, onDownloadFull }: TerminalLogProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => (text ? text.split('\n') : []), [text]);
  // 用户停留在底部附近时，新日志追加后自动跟随到底部
  const followRef = useRef(true);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => LINE_HEIGHT,
    overscan: 20,
  });

  const handleScroll = () => {
    const el = parentRef.current;
    if (!el) return;
    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  useEffect(() => {
    const el = parentRef.current;
    if (el && followRef.current && lines.length > 0) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines.length]);

  return (
    <div className="terminal overflow-hidden">
      {(partial || onDownloadFull) && (
        <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5 text-[10px] text-slate-500">
          {partial && (
            <span className="inline-flex items-center gap-1">
              <Info className="h-3 w-3" strokeWidth={1.5} />
              日志较大，仅显示末尾部分
            </span>
          )}
          {onDownloadFull && (
            <button
              type="button"
              onClick={onDownloadFull}
              className="ml-auto inline-flex items-center gap-1 rounded px-2 py-0.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
            >
              <Download className="h-3 w-3" strokeWidth={1.5} />
              下载完整日志
            </button>
          )}
        </div>
      )}
      <div
        ref={parentRef}
        onScroll={handleScroll}
        className="overflow-auto p-4 text-[11.5px] leading-relaxed scrollbar-thin"
        style={{ minHeight: 420, maxHeight: 560 }}
      >
        {lines.length === 0 ? (
          <div className="text-slate-600">暂无日志</div>
        ) : (
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const line = lines[vi.index];
              return (
                <div
                  key={vi.key}
                  className={`absolute left-0 top-0 whitespace-pre ${lineClass(line)}`}
                  style={{
                    transform: `translateY(${vi.start}px)`,
                    height: LINE_HEIGHT,
                    minWidth: '100%',
                    width: 'max-content',
                  }}
                >
                  {line}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
