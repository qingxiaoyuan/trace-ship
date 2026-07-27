import { credentialShareMap, credentialShareIconMap, credentialShareColorMap } from '../constants';
import type { CredentialShare } from '../constants';

interface ScopeTagProps {
  share: CredentialShare;
}

export function ScopeTag({ share }: ScopeTagProps) {
  const Icon = credentialShareIconMap[share];
  const colors = credentialShareColorMap[share];
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
        colors.border,
        colors.bg,
        colors.text,
      ].join(' ')}
    >
      <Icon className="h-3 w-3" strokeWidth={1.5} />
      {credentialShareMap[share]}
    </span>
  );
}
