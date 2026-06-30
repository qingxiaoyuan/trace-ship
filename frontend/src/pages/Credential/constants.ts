import type { ComponentType } from 'react';
import {
  GitBranch,
  FolderTree,
  Hammer,
  Shield,
  KeyRound,
  User,
  Folder,
} from 'lucide-react';
import type { CredentialType, CredentialScope } from '@/types';

type LucideIcon = ComponentType<{ className?: string; strokeWidth?: number }>;

export const credentialTypeMap: Record<CredentialType, string> = {
  gitlab_token: 'GitLab Token',
  gitea_token: 'Gitea Token',
  github_token: 'GitHub Token',
  svn_password: 'SVN',
  jenkins_token: 'Jenkins',
  ldap_password: 'LDAP',
  ai_api_key: 'AI API Key',
};

export const credentialScopeMap: Record<CredentialScope, string> = {
  personal: '个人',
  project: '项目',
};

export const credentialTypeIconMap: Record<CredentialType, LucideIcon> = {
  gitlab_token: GitBranch,
  gitea_token: GitBranch,
  github_token: GitBranch,
  svn_password: FolderTree,
  jenkins_token: Hammer,
  ldap_password: Shield,
  ai_api_key: KeyRound,
};

export const credentialTypeColorMap: Record<
  CredentialType,
  { border: string; bg: string; text: string }
> = {
  gitlab_token: { border: 'border-indigo-200', bg: 'bg-indigo-50', text: 'text-indigo-600' },
  gitea_token: { border: 'border-cyan-200', bg: 'bg-cyan-50', text: 'text-cyan-600' },
  github_token: { border: 'border-slate-200', bg: 'bg-slate-50', text: 'text-slate-600' },
  svn_password: { border: 'border-amber-200', bg: 'bg-amber-50', text: 'text-amber-600' },
  jenkins_token: { border: 'border-violet-200', bg: 'bg-violet-50', text: 'text-violet-600' },
  ldap_password: { border: 'border-rose-200', bg: 'bg-rose-50', text: 'text-rose-500' },
  ai_api_key: { border: 'border-emerald-200', bg: 'bg-emerald-50', text: 'text-emerald-600' },
};

export const credentialScopeIconMap: Record<CredentialScope, LucideIcon> = {
  personal: User,
  project: Folder,
};

export const credentialScopeColorMap: Record<
  CredentialScope,
  { border: string; bg: string; text: string }
> = {
  personal: { border: 'border-violet-200', bg: 'bg-violet-50', text: 'text-violet-700' },
  project: { border: 'border-indigo-200', bg: 'bg-indigo-50', text: 'text-indigo-700' },
};

export const credentialTypeOptions: [CredentialType, string][] = Object.entries(
  credentialTypeMap
) as [CredentialType, string][];

export const credentialScopeOptions: [CredentialScope, string][] = Object.entries(
  credentialScopeMap
) as [CredentialScope, string][];
