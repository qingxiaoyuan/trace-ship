import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueries } from '@tanstack/react-query';
import { App, Popconfirm } from 'antd';
import dayjs from 'dayjs';
import {
  UserCircle,
  AtSign,
  Mail,
  Phone,
  Building2,
  Database,
  Network,
  CircleCheck,
  CalendarPlus,
  CalendarClock,
  ShieldCheck,
  KeyRound,
  Lock,
  LogOut,
  Crown,
  Users,
  Info,
  Contact,
  Fingerprint,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { accountApi } from '@/api/account';
import type { AccountRole } from '@/api/account';

function formatDateTime(dateStr?: string | null): string {
  if (!dateStr) return '-';
  const d = dayjs(dateStr);
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : '-';
}

function formatRelative(dateStr?: string | null): string {
  if (!dateStr) return '从未登录';
  const d = dayjs(dateStr);
  if (!d.isValid()) return '从未登录';
  const now = dayjs();
  const diffMin = now.diff(d, 'minute');
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)} 小时前`;
  if (diffMin < 2880) return '昨天';
  return d.format('MM-DD HH:mm');
}

const iconClassPool = ['icon-indigo', 'icon-violet', 'icon-cyan', 'icon-amber', 'icon-emerald', 'icon-rose'];

function getRoleIconClass(code: string): string {
  let hash = 0;
  for (let i = 0; i < code.length; i++) hash = code.charCodeAt(i) + ((hash << 5) - hash);
  return iconClassPool[Math.abs(hash) % iconClassPool.length];
}

export default function Profile() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  const { data: accountUser, isLoading } = useQuery({
    queryKey: ['profile-user', user?.id],
    queryFn: () => accountApi.getUser(user!.id),
    enabled: !!user?.id,
  });

  const roles = accountUser?.roles || [];

  const roleQueries = useQueries({
    queries: roles.map((r) => ({
      queryKey: ['role-detail', r.id],
      queryFn: () => accountApi.getRole(r.id),
      enabled: roles.length > 0,
      staleTime: 60_000,
    })),
  });

  const roleDetails = useMemo(
    () => roleQueries.map((q) => q.data).filter(Boolean) as AccountRole[],
    [roleQueries],
  );

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch {
      message.error('退出失败');
    }
  };

  const nickname = accountUser?.nickname || user?.nickname || user?.username || '-';
  const initial = nickname.charAt(0).toUpperCase();
  const source = accountUser?.source || user?.source || 'local';
  const isLdap = source === 'ldap';
  const isSuperuser = accountUser?.is_superuser ?? user?.is_superuser ?? false;
  const isActive = accountUser?.is_active ?? true;
  const department = accountUser?.department || user?.department || '-';
  const email = accountUser?.email || user?.email || '-';

  const sourceLabel = isLdap ? 'LDAP' : '本地';

  const accountInfoRows = [
    { icon: AtSign, label: '用户名', value: accountUser?.username || user?.username || '-', mono: true },
    { icon: Contact, label: '姓名', value: nickname },
    { icon: Mail, label: '邮箱', value: email },
    { icon: Phone, label: '手机号', value: accountUser?.phone || '-', mono: true },
    { icon: Building2, label: '部门', value: department },
    {
      icon: isLdap ? Network : Database,
      label: '账号来源',
      badge: sourceLabel,
    },
    {
      icon: CircleCheck,
      label: '账号状态',
      badge: isActive ? '启用' : '停用',
      badgeType: isActive ? 'success' : 'muted',
    },
    { icon: CalendarPlus, label: '创建时间', value: formatDateTime(accountUser?.created_at), mono: true },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-[13px] text-slate-400">加载中…</div>
    );
  }

  return (
    <div className="space-y-5 page-fade-in max-w-[920px] mx-auto">
      {/* ============ 个人信息头部卡片 ============ */}
      <div className="tech-card rounded-xl p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div
              className="flex h-16 w-16 items-center justify-center rounded-2xl text-[26px] font-semibold tracking-tight text-white"
              style={{
                background: 'linear-gradient(135deg,#6366F1,#06B6D4)',
                boxShadow: '0 6px 18px -6px rgba(99,102,241,.5)',
              }}
            >
              {initial}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">{nickname}</h1>
                {isSuperuser ? (
                  <span className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700">
                    <ShieldCheck className="h-3 w-3" strokeWidth={1.5} />
                    超管
                  </span>
                ) : null}
                <span
                  className={[
                    'inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
                    isActive
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 bg-slate-50 text-slate-500',
                  ].join(' ')}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                  {isActive ? '启用' : '停用'}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
                <span className="font-mono">{accountUser?.username || user?.username}</span>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span className="inline-flex items-center gap-1 rounded border border-indigo-100 bg-indigo-50/50 px-1 py-0.5 text-[10px] font-medium text-indigo-600">
                  {isLdap ? <Network className="h-2.5 w-2.5" strokeWidth={1.5} /> : <Database className="h-2.5 w-2.5" strokeWidth={1.5} />}
                  {sourceLabel}账号
                </span>
                {department && department !== '-' ? (
                  <>
                    <span className="h-1 w-1 rounded-full bg-slate-300" />
                    <span className="flex items-center gap-1">
                      <Building2 className="h-3 w-3" strokeWidth={1.5} />
                      {department}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Popconfirm title="确定退出登录？" onConfirm={handleLogout}>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[13px] font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
              >
                <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
                退出登录
              </button>
            </Popconfirm>
          </div>
        </div>
      </div>

      {/* ============ LDAP 同步提示 ============ */}
      {isLdap ? (
        <div className="tech-card rounded-xl p-4 flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg icon-indigo">
            <Info className="h-4 w-4" strokeWidth={1.5} />
          </div>
          <div className="text-[12px] text-slate-600 leading-relaxed">
            <span className="font-medium text-indigo-700">该账号为 LDAP 账号，姓名、邮箱、部门由 LDAP 目录同步。</span>
            下次登录时这些字段将自动覆盖本地修改。如需变更，请联系管理员在 LDAP 目录中修改。
          </div>
        </div>
      ) : null}

      {/* ============ 两栏：账号信息 + 角色权限 ============ */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* 左：账号信息（只读） */}
        <div className="tech-card rounded-xl overflow-hidden">
          <div className="flex items-center gap-2.5 border-b border-indigo-50 px-5 py-3.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg icon-indigo">
              <UserCircle className="h-3.5 w-3.5" strokeWidth={1.5} />
            </div>
            <h3 className="text-[14px] font-semibold text-slate-900">账号信息</h3>
            <span className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
              <Lock className="h-2.5 w-2.5" strokeWidth={1.5} />
              只读
            </span>
          </div>
          <div className="divide-y divide-indigo-50/60">
            {accountInfoRows.map((row) => (
              <div key={row.label} className="flex items-center justify-between px-5 py-3">
                <span className="flex items-center gap-2 text-[13px] text-slate-500">
                  <row.icon className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />
                  {row.label}
                </span>
                {row.badge ? (
                  <span
                    className={[
                      'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium',
                      row.badgeType === 'success'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : row.badgeType === 'muted'
                          ? 'border-slate-200 bg-slate-50 text-slate-500'
                          : 'border-indigo-100 bg-indigo-50/50 text-indigo-600',
                    ].join(' ')}
                  >
                    {row.badge}
                  </span>
                ) : (
                  <span className={row.mono ? 'font-mono text-[13px] text-slate-800' : 'text-[13px] text-slate-800'}>
                    {row.value}
                  </span>
                )}
              </div>
            ))}
            {isLdap && accountUser?.ldap_dn ? (
              <div className="flex items-center justify-between px-5 py-3">
                <span className="flex items-center gap-2 text-[13px] text-slate-500">
                  <Fingerprint className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />
                  LDAP DN
                </span>
                <span
                  className="font-mono text-[11px] text-slate-600 truncate max-w-[260px]"
                  title={accountUser.ldap_dn}
                >
                  {accountUser.ldap_dn}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {/* 右：角色与权限 */}
        <div className="tech-card rounded-xl overflow-hidden">
          <div className="flex items-center gap-2.5 border-b border-indigo-50 px-5 py-3.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg icon-violet">
              <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.5} />
            </div>
            <h3 className="text-[14px] font-semibold text-slate-900">角色与权限</h3>
            <span className="ml-auto text-[11px] text-slate-400">{roles.length} 个角色</span>
          </div>
          <div className="p-5 space-y-3">
            {roles.length === 0 ? (
              <div className="py-8 text-center text-[13px] text-slate-400">暂无角色</div>
            ) : (
              roles.map((roleBrief, idx) => {
                const detail = roleDetails.find((d) => d.id === roleBrief.id);
                const isBuiltin = roleBrief.code === 'super_admin' || roleBrief.code === 'developer';
                const permissions = detail?.permissions || [];
                const iconClass = getRoleIconClass(roleBrief.code);
                return (
                  <div
                    key={roleBrief.id}
                    className={[
                      'rounded-lg p-4',
                      idx === 0
                        ? 'border border-violet-100 bg-violet-50/30'
                        : 'border border-indigo-100 bg-white',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${iconClass}`}>
                          {isBuiltin ? (
                            <Crown className="h-3.5 w-3.5" strokeWidth={1.5} />
                          ) : (
                            <Users className="h-3.5 w-3.5" strokeWidth={1.5} />
                          )}
                        </div>
                        <div>
                          <div className="text-[13px] font-semibold text-slate-900">{roleBrief.name}</div>
                          <div className="font-mono text-[10px] text-slate-400">{roleBrief.code}</div>
                        </div>
                      </div>
                      <span
                        className={[
                          'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
                          isBuiltin
                            ? 'border-violet-200 bg-white text-violet-600'
                            : 'border-indigo-200 bg-indigo-50 text-indigo-600',
                        ].join(' ')}
                      >
                        {isBuiltin ? '内置' : '业务'}
                      </span>
                    </div>
                    {detail?.description ? (
                      <p className="mt-2 text-[12px] text-slate-500 leading-relaxed">{detail.description}</p>
                    ) : null}
                    {permissions.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-indigo-50 pt-3">
                        {permissions.slice(0, 12).map((p) => (
                          <span
                            key={p.id}
                            className="inline-flex items-center rounded border border-indigo-100 bg-indigo-50/40 px-1.5 py-0.5 text-[10px] font-medium text-indigo-500"
                          >
                            {p.name}
                          </span>
                        ))}
                        {permissions.length > 12 ? (
                          <span className="inline-flex items-center rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                            +{permissions.length - 12}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ============ 安全信息 ============ */}
      <div className="tech-card rounded-xl overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-indigo-50 px-5 py-3.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg icon-amber">
            <KeyRound className="h-3.5 w-3.5" strokeWidth={1.5} />
          </div>
          <h3 className="text-[14px] font-semibold text-slate-900">安全信息</h3>
        </div>
        <div className="grid grid-cols-1 divide-y divide-indigo-50/60 md:grid-cols-3 md:divide-y-0 md:divide-x md:divide-indigo-50/60">
          <div className="px-5 py-4">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">
              <Lock className="h-3 w-3" strokeWidth={1.5} />
              密码管理
            </div>
            <div className="mt-1.5 text-[13px] text-slate-800">
              {isLdap ? 'LDAP 域控统管' : '本地密码'}
            </div>
            <p className="mt-1 text-[11px] text-slate-400 leading-relaxed">
              {isLdap
                ? '密码由域控制器统一管理，无法在此修改'
                : '可通过系统设置修改密码'}
            </p>
          </div>
          <div className="px-5 py-4">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">
              <CalendarClock className="h-3 w-3" strokeWidth={1.5} />
              最近登录
            </div>
            <div className="mt-1.5 text-[13px] text-slate-800">
              {formatRelative(accountUser?.last_login)}
            </div>
            <p className="mt-1 text-[11px] text-slate-400 leading-relaxed">
              {accountUser?.last_login ? formatDateTime(accountUser.last_login) : '暂无记录'}
            </p>
          </div>
          <div className="px-5 py-4">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">
              <ShieldCheck className="h-3 w-3" strokeWidth={1.5} />
              超管权限
            </div>
            <div className="mt-1.5 text-[13px] text-slate-800">
              {isSuperuser ? '已启用' : '未启用'}
            </div>
            <p className="mt-1 text-[11px] text-slate-400 leading-relaxed">
              {isSuperuser ? '拥有系统全部权限' : '仅拥有角色授权的权限'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
