import { memo } from 'react';
import { getAvatarColor } from '@/utils/avatar';
import type { PackageTaskStatus } from '@/types';
import { statusMeta, isRunning } from './utils';

export const StatusBadge = memo(function StatusBadge({ status }: { status: PackageTaskStatus }) {
  const m = statusMeta[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border ${m.border} ${m.bg} px-1.5 py-0.5 text-[11px] font-medium ${m.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot} ${m.pulse ? 'pulse-dot' : ''}`} />
      {m.label}
    </span>
  );
});

export const ProgressBar = memo(function ProgressBar({ progress, status }: { progress: number; status: PackageTaskStatus }) {
  const pct = status === 'success' ? 100 : Math.max(0, Math.min(100, progress || 0));
  const barClass = isRunning(status) ? 'stage-line' : status === 'success' ? 'bg-emerald-400' : status === 'failure' ? 'bg-rose-400' : 'bg-slate-300';
  const textClass = isRunning(status) ? 'text-cyan-600' : status === 'success' ? 'text-emerald-600' : 'text-slate-400';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-indigo-50 overflow-hidden">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`font-mono text-[11px] font-medium shrink-0 ${textClass}`}>{pct}%</span>
    </div>
  );
});

export const UserAvatar = memo(function UserAvatar({ name, size = 16 }: { name?: string; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full text-white font-medium"
      style={{ width: size, height: size, background: getAvatarColor(name), fontSize: size * 0.55 }}
    >
      {(name || 'U').charAt(0)}
    </span>
  );
});
