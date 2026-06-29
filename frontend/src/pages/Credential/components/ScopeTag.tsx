import { credentialScopeMap, credentialScopeIconMap, credentialScopeColorMap } from '../constants';
import type { CredentialScope } from '@/types';

interface ScopeTagProps {
  scope: CredentialScope;
}

export function ScopeTag({ scope }: ScopeTagProps) {
  const Icon = credentialScopeIconMap[scope];
  const colors = credentialScopeColorMap[scope];
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
      {credentialScopeMap[scope]}
    </span>
  );
}
