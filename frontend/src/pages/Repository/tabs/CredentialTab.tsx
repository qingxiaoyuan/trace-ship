import { KeyRound, ShieldCheck } from 'lucide-react';
import type { Repository } from '@/types';

interface CredentialTabProps {
  repo: Repository;
}

/** 一行键值 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-indigo-50 py-1.5">
      <span className="text-[12px] text-slate-500">{label}</span>
      <span className="text-[12px] text-slate-700">{children}</span>
    </div>
  );
}

/** 凭证配置 Tab：展示仓库的凭证模式与连接状态 */
export function CredentialTab({ repo }: CredentialTabProps) {
  const isHealthy = repo.health_status === 'healthy';
  const healthText = repo.health_status === 'healthy' ? '正常' : repo.health_status === 'unhealthy' ? '异常' : '未知';
  const healthCls = repo.health_status === 'healthy'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : repo.health_status === 'unhealthy'
      ? 'border-rose-200 bg-rose-50 text-rose-600'
      : 'border-slate-200 bg-slate-50 text-slate-500';

  const mode = repo.credential_mode;
  // 凭证名称：fixed 模式显示绑定的凭证名；其余模式按模式语义展示
  const credentialName = repo.credential_name || (
    mode === 'global' ? '系统全局凭证' :
    mode === 'current_user' ? '当前登录用户凭证' :
    mode === 'specified_user' ? '指定用户凭证' : '-'
  );
  // 使用用户凭证：specified_user 显示指定用户；fixed 显示凭证归属人；current_user/global 显示语义文本
  const userCredential = mode === 'specified_user'
    ? (repo.specified_user_name || '-')
    : mode === 'fixed'
      ? (repo.credential_owner_name || '-')
      : mode === 'current_user'
        ? '当前登录用户'
        : mode === 'global'
          ? '系统全局'
          : '-';

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {/* 凭证模式 */}
      <div className="rounded-lg border border-indigo-100 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg icon-violet">
            <KeyRound className="h-4 w-4" strokeWidth={1.5} />
          </div>
          <h4 className="text-[14px] font-semibold text-slate-900">凭证模式</h4>
        </div>
        <div className="space-y-2 text-[12px]">
          <Row label="模式">{repo.credential_mode_display || repo.credential_mode || '-'}</Row>
          <Row label="凭证名称">
            <span className="font-mono">{credentialName}</span>
          </Row>
          <Row label="使用用户凭证">{userCredential}</Row>
        </div>
      </div>

      {/* 连接状态 */}
      <div className="rounded-lg border border-indigo-100 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg icon-cyan">
            <ShieldCheck className="h-4 w-4" strokeWidth={1.5} />
          </div>
          <h4 className="text-[14px] font-semibold text-slate-900">连接状态</h4>
        </div>
        <div className="space-y-2 text-[12px]">
          <Row label="最近同步">{repo.last_sync_at ? repo.last_sync_at.replace('T', ' ').slice(0, 16) : '-'}</Row>
          <Row label="状态">
            <span className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${healthCls}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${isHealthy ? 'bg-emerald-500' : repo.health_status === 'unhealthy' ? 'bg-rose-500' : 'bg-slate-400'}`} />
              {healthText}
            </span>
          </Row>
          <Row label="默认分支">
            <span className="font-mono">{repo.default_branch || '-'}</span>
          </Row>
        </div>
      </div>
    </div>
  );
}
