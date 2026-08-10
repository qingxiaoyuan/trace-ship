import { credentialTypeIconMap } from '../constants';
import type { CredentialType } from '@/types';

type Variant = 'indigo' | 'cyan' | 'amber' | 'rose' | 'violet' | 'emerald' | 'slate';
interface CredentialIconProps {
  type: CredentialType;
  size?: 'sm' | 'md' | 'lg';
  variant?: Variant;
}

const sizeClasses = {
  sm: { wrap: 'h-8 w-8 rounded-lg', icon: 'h-4 w-4' },
  md: { wrap: 'h-9 w-9 rounded-lg', icon: 'h-[18px] w-[18px]' },
  lg: { wrap: 'h-12 w-12 rounded-xl', icon: 'h-6 w-6' },
};

const variantClasses: Record<Variant, string> = {
  indigo: 'icon-indigo',
  cyan: 'icon-cyan',
  amber: 'icon-amber',
  rose: 'icon-rose',
  violet: 'icon-violet',
  emerald: 'icon-emerald',
  slate: 'icon-slate',
};

const typeVariantMap: Record<CredentialType, Variant> = {
  gitlab_token: 'indigo',
  svn_password: 'amber',
  ldap_password: 'rose',
  windows_password: 'cyan',
  ai_api_key: 'emerald',
};

export function CredentialIcon({ type, size = 'sm', variant }: CredentialIconProps) {
  const Icon = credentialTypeIconMap[type];
  const classes = sizeClasses[size];
  const effectiveVariant = variant ?? typeVariantMap[type];
  const variantClass = variantClasses[effectiveVariant];
  return (
    <div className={['flex items-center justify-center', classes.wrap, variantClass].join(' ')}>
      <Icon className={classes.icon} strokeWidth={1.5} />
    </div>
  );
}
