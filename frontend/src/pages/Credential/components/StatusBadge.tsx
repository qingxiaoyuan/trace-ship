import { statusConfig, getCredentialStatus } from '../utils';

interface StatusBadgeProps {
  status: ReturnType<typeof getCredentialStatus>;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const cfg = statusConfig[status];
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
        cfg.border,
        cfg.bg,
        cfg.text,
      ].join(' ')}
    >
      <span className={['h-1.5 w-1.5 rounded-full', cfg.dot].join(' ')} />
      {cfg.label}
    </span>
  );
}
