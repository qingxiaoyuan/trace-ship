import { credentialTypeColorMap } from '../constants';
import type { CredentialType } from '@/types';

interface TypeTagProps {
  type: CredentialType;
}

export function TypeTag({ type }: TypeTagProps) {
  const colors = credentialTypeColorMap[type];
  return (
    <span
      className={[
        'rounded border px-1.5 py-0.5 text-[10px] font-medium font-mono',
        colors.border,
        colors.bg,
        colors.text,
      ].join(' ')}
    >
      {type}
    </span>
  );
}
