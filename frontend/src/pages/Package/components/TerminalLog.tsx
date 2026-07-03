import { memo } from 'react';

interface LogLineProps {
  line: string;
}

const LogLine = memo(function LogLine({ line }: LogLineProps) {
  let cls = '';
  if (/✓|success|完成/.test(line)) cls = 'text-emerald-400';
  else if (/\[WARN\]|\[warning\]/i.test(line)) cls = 'text-amber-400';
  else if (/\[ERROR\]|fail|错误/i.test(line)) cls = 'text-rose-400';
  else if (/\[INFO\]|\[INFO\]/.test(line)) cls = 'text-blue-400';
  else if (/^\[?\d{4}-\d{2}-\d{2}/.test(line)) cls = 'text-slate-500';
  return <div className={cls}>{line}</div>;
});

export const TerminalLog = memo(function TerminalLog({ text }: { text: string }) {
  const lines = text ? text.split('\n') : [];
  return (
    <div className="terminal p-4 text-[11.5px] leading-relaxed overflow-y-auto scrollbar-thin" style={{ minHeight: 420, maxHeight: 560 }}>
      {lines.length === 0 ? (
        <div className="text-slate-600">暂无日志</div>
      ) : (
        lines.map((line, i) => <LogLine key={i} line={line} />)
      )}
    </div>
  );
});
