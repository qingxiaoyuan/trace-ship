import type { ComponentType } from 'react';
import {
  GitBranch,
  FolderTree,
  Shield,
  KeyRound,
  Monitor,
  User,
  Users,
} from 'lucide-react';
import type { CredentialType } from '@/types';

type LucideIcon = ComponentType<{ className?: string; strokeWidth?: number }>;

/** 凭证共享范围：personal 个人 / system 系统共享（SVN / Windows） */
export type CredentialShare = 'personal' | 'system';

export const credentialTypeMap: Record<CredentialType, string> = {
  gitlab_token: 'GitLab Token',
  svn_password: 'SVN',
  ldap_password: 'LDAP',
  windows_password: 'Windows',
  ai_api_key: 'AI API Key',
};

export const credentialShareMap: Record<CredentialShare, string> = {
  personal: '个人',
  system: '系统共享',
};

export const credentialTypeIconMap: Record<CredentialType, LucideIcon> = {
  gitlab_token: GitBranch,
  svn_password: FolderTree,
  ldap_password: Shield,
  windows_password: Monitor,
  ai_api_key: KeyRound,
};

export const credentialTypeColorMap: Record<
  CredentialType,
  { border: string; bg: string; text: string }
> = {
  gitlab_token: { border: 'border-indigo-200', bg: 'bg-indigo-50', text: 'text-indigo-600' },
  svn_password: { border: 'border-amber-200', bg: 'bg-amber-50', text: 'text-amber-600' },
  ldap_password: { border: 'border-rose-200', bg: 'bg-rose-50', text: 'text-rose-500' },
  windows_password: { border: 'border-sky-200', bg: 'bg-sky-50', text: 'text-sky-600' },
  ai_api_key: { border: 'border-emerald-200', bg: 'bg-emerald-50', text: 'text-emerald-600' },
};

export const credentialShareIconMap: Record<CredentialShare, LucideIcon> = {
  personal: User,
  system: Users,
};

export const credentialShareColorMap: Record<
  CredentialShare,
  { border: string; bg: string; text: string }
> = {
  personal: { border: 'border-violet-200', bg: 'bg-violet-50', text: 'text-violet-700' },
  system: { border: 'border-indigo-200', bg: 'bg-indigo-50', text: 'text-indigo-700' },
};

export const credentialTypeOptions: [CredentialType, string][] = Object.entries(
  credentialTypeMap
) as [CredentialType, string][];

export const credentialShareOptions: [CredentialShare, string][] = Object.entries(
  credentialShareMap
) as [CredentialShare, string][];

/** 由凭证推导共享范围（与后端 is_system_shared 规则一致：svn/windows 密码全系统共享） */
export function getCredentialShare(credType: CredentialType): CredentialShare {
  return credType === 'svn_password' || credType === 'windows_password' ? 'system' : 'personal';
}
