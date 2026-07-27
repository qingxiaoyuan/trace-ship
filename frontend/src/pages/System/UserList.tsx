import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { message, Dropdown } from 'antd';
import {
  Plus,
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Pencil,
  ArrowLeft,
  User as UserIcon,
  Lock,
  Mail,
  Phone,
  EyeOff,
  Eye,
  Save,
  Check,
  ShieldCheck,
} from 'lucide-react';
import { accountApi } from '@/api/account';
import type { AccountUser, AccountRoleBrief } from '@/api/account';
import { getAvatarColor } from '@/utils/avatar';

type View = 'list' | 'form';

interface FormState {
  id?: string;
  username: string;
  nickname: string;
  password: string;
  email: string;
  phone: string;
  department: string;
  source: 'local' | 'ldap';
  is_active: boolean;
  is_superuser: boolean;
  role_ids: string[];
}

const emptyForm: FormState = {
  username: '',
  nickname: '',
  password: '',
  email: '',
  phone: '',
  department: '',
  source: 'local',
  is_active: true,
  is_superuser: false,
  role_ids: [],
};

const sourceOptions = [
  { key: '', label: '全部来源' },
  { key: 'local', label: '本地' },
  { key: 'ldap', label: 'LDAP' },
];

const roleColorMap: Record<string, string> = {
  admin: 'border-violet-200 bg-violet-50 text-violet-700',
  developer: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  tester: 'border-amber-200 bg-amber-50 text-amber-700',
};

function getRoleBadgeClass(code: string): string {
  return roleColorMap[code] || 'border-slate-200 bg-slate-50 text-slate-600';
}

export default function SystemUserList() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>('list');
  const [keyword, setKeyword] = useState('');
  const [source, setSource] = useState<string>('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [form, setForm] = useState<FormState>(emptyForm);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['account-users', keyword, source, page, pageSize],
    queryFn: () =>
      accountApi.getUsers({
        page,
        page_size: pageSize,
        keyword: keyword || undefined,
        source: source || undefined,
      }),
    enabled: view === 'list',
  });

  const { data: rolesData } = useQuery({
    queryKey: ['account-roles-all'],
    queryFn: () => accountApi.getRoles({ page_size: 1000 }),
  });

  const roles = useMemo<AccountRoleBrief[]>(() => {
    return (rolesData?.results || []).map((r) => ({ id: r.id, name: r.name, code: r.code }));
  }, [rolesData]);

  const users = data?.results || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const saveMutation = useMutation({
    mutationFn: async (payload: FormState) => {
      const body: Record<string, unknown> = {
        username: payload.username,
        nickname: payload.nickname,
        email: payload.email,
        phone: payload.phone,
        department: payload.department,
        source: payload.source,
        is_active: payload.is_active,
        is_superuser: payload.is_superuser,
        role_ids: payload.role_ids,
      };
      if (payload.password) {
        body.password = payload.password;
      }
      if (payload.id) {
        return accountApi.updateUser(payload.id, body);
      }
      return accountApi.createUser(body as Partial<AccountUser>);
    },
    onSuccess: () => {
      message.success('保存成功');
      queryClient.invalidateQueries({ queryKey: ['account-users'] });
      setView('list');
      setSaving(false);
    },
    onError: () => {
      message.error('保存失败');
      setSaving(false);
    },
  });

  const openCreate = () => {
    setForm(emptyForm);
    setShowPassword(false);
    setView('form');
  };

  const openEdit = (u: AccountUser) => {
    setForm({
      id: u.id,
      username: u.username,
      nickname: u.nickname || '',
      password: '',
      email: u.email || '',
      phone: u.phone || '',
      department: u.department || '',
      source: (u.source as 'local' | 'ldap') || 'local',
      is_active: u.is_active,
      is_superuser: u.is_superuser,
      role_ids: (u.roles || []).map((r) => r.id),
    });
    setShowPassword(false);
    setView('form');
  };

  const handleSave = () => {
    if (!form.username.trim()) {
      message.warning('请输入用户名');
      return;
    }
    if (!form.id && !form.password) {
      message.warning('请输入密码');
      return;
    }
    setSaving(true);
    saveMutation.mutate(form);
  };

  const toggleRole = (roleId: string) => {
    setForm((prev) => ({
      ...prev,
      role_ids: prev.role_ids.includes(roleId)
        ? prev.role_ids.filter((id) => id !== roleId)
        : [...prev.role_ids, roleId],
    }));
  };

  const sourceMenuItems = sourceOptions.map((opt) => ({ key: opt.key, label: opt.label }));

  if (view === 'form') {
    const isEdit = Boolean(form.id);
    const isLdap = form.source === 'ldap';
    const usernameDisabled = isEdit && isLdap;
    const passwordDisabled = isEdit && isLdap;
    return (
      <div className="space-y-5 page-fade-in">
        <div className="flex items-center gap-2 text-[13px]">
          <button
            type="button"
            onClick={() => setView('list')}
            className="inline-flex items-center gap-1 text-slate-400 transition-colors hover:text-indigo-600"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
            用户管理
          </button>
        </div>

        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">
            {isEdit ? '编辑用户' : '新增用户'}
          </h1>
          <p className="mt-1 text-[13px] text-slate-500">
            创建本地账号并分配角色，LDAP 账号在首次登录时自动同步
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_300px]">
          <div className="tech-card space-y-4 rounded-xl p-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-slate-600">
                  用户名 <span className="text-rose-500">*</span>
                  {usernameDisabled && <span className="ml-1 text-[11px] text-slate-400">（LDAP 账号不可修改）</span>}
                </label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" strokeWidth={1.5} />
                  <input
                    type="text"
                    value={form.username}
                    disabled={usernameDisabled}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    placeholder="登录用户名"
                    className="input-field w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-[13px] text-slate-700 placeholder-slate-400 outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-slate-600">
                  姓名 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.nickname}
                  onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                  placeholder="显示名"
                  className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[13px] text-slate-700 placeholder-slate-400 outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-slate-600">
                  密码 {!isEdit && <span className="text-rose-500">*</span>}
                  {isEdit && !isLdap && <span className="ml-1 text-[11px] text-slate-400">（留空则不修改）</span>}
                  {passwordDisabled && <span className="ml-1 text-[11px] text-slate-400">（LDAP 账号由服务器管理）</span>}
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" strokeWidth={1.5} />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    disabled={passwordDisabled}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder={passwordDisabled ? 'LDAP 账号无需本地密码' : isEdit ? '不修改请留空' : '至少 8 位'}
                    className="input-field w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-10 text-[13px] text-slate-700 placeholder-slate-400 outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    disabled={passwordDisabled}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {showPassword ? <Eye className="h-4 w-4" strokeWidth={1.5} /> : <EyeOff className="h-4 w-4" strokeWidth={1.5} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-slate-600">邮箱</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" strokeWidth={1.5} />
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="user@company.com"
                    className="input-field w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-[13px] text-slate-700 placeholder-slate-400 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-slate-600">电话</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" strokeWidth={1.5} />
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="手机号"
                    className="input-field w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-[13px] text-slate-700 placeholder-slate-400 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-slate-600">部门</label>
                <input
                  type="text"
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                  placeholder="所属部门"
                  className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[13px] text-slate-700 placeholder-slate-400 outline-none"
                />
              </div>
            </div>

            <div className="border-t border-indigo-50 pt-4">
              <label className="mb-1.5 block text-[12px] font-medium text-slate-600">账号来源</label>
              <div className="flex items-center gap-4">
                {(['local', 'ldap'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setForm({ ...form, source: s })}
                    className="flex items-center gap-1.5"
                  >
                    <span className="relative inline-flex h-4 w-4 items-center justify-center rounded-full border-2"
                      style={{ borderColor: form.source === s ? '#4F46E5' : '#CBD5E1' }}
                    >
                      {form.source === s ? <span className="h-2 w-2 rounded-full bg-indigo-500" /> : null}
                    </span>
                    <span className={form.source === s ? 'text-[13px] text-slate-700' : 'text-[13px] text-slate-500'}>
                      {s === 'local' ? '本地账号' : 'LDAP 账号'}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-indigo-50 pt-4">
              <button
                type="button"
                onClick={() => setForm({ ...form, is_active: !form.is_active })}
                className="flex items-center gap-2"
              >
                <span className="relative inline-flex h-4 w-4 items-center justify-center rounded border-2"
                  style={{
                    borderColor: form.is_active ? '#4F46E5' : '#CBD5E1',
                    background: form.is_active ? '#4F46E5' : 'transparent',
                  }}
                >
                  {form.is_active ? <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} /> : null}
                </span>
                <span className="text-[13px] text-slate-700">启用账号</span>
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, is_superuser: !form.is_superuser })}
                className="flex items-center gap-2"
              >
                <span className="relative inline-flex h-4 w-4 items-center justify-center rounded border-2"
                  style={{
                    borderColor: form.is_superuser ? '#4F46E5' : '#CBD5E1',
                    background: form.is_superuser ? '#4F46E5' : 'transparent',
                  }}
                >
                  {form.is_superuser ? <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} /> : null}
                </span>
                <span className="text-[13px] text-slate-700">超管权限</span>
              </button>
            </div>
          </div>

          <div className="space-y-5">
            <div className="tech-card rounded-xl p-5">
              <div className="mb-3 flex items-center gap-2">
                <div className="icon-violet flex h-7 w-7 items-center justify-center rounded-lg">
                  <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.5} />
                </div>
                <h3 className="text-[14px] font-semibold text-slate-900">角色分配</h3>
              </div>
              <div className="space-y-2">
                {roles.length === 0 ? (
                  <div className="py-4 text-center text-[12px] text-slate-400">暂无角色</div>
                ) : (
                  roles.map((role) => {
                    const checked = form.role_ids.includes(role.id);
                    return (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => toggleRole(role.id)}
                        className={[
                          'flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
                          checked
                            ? 'border-indigo-200 bg-indigo-50/40'
                            : 'border-slate-200 bg-white hover:border-indigo-300',
                        ].join(' ')}
                      >
                        <span className="relative inline-flex h-4 w-4 items-center justify-center rounded border-2"
                          style={{
                            borderColor: checked ? '#4F46E5' : '#CBD5E1',
                            background: checked ? '#4F46E5' : 'transparent',
                          }}
                        >
                          {checked ? <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} /> : null}
                        </span>
                        <div className="flex-1">
                          <div className="text-[13px] font-medium text-slate-900">{role.name}</div>
                          <div className="font-mono text-[10px] text-slate-400">{role.code}</div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setView('list')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[13px] font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="btn-glow flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white disabled:opacity-60"
              >
                <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
                保存
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="space-y-5 page-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">用户管理</h1>
          <p className="mt-1 text-[13px] text-slate-500">管理系统用户、角色分配与账号状态</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          新增用户
        </button>
      </div>

      <div className="tech-card overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center gap-2 border-b border-indigo-50 px-5 py-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" strokeWidth={1.5} />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setPage(1); }}
              placeholder="搜索用户名 / 姓名"
              className="w-[200px] rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <Dropdown
            menu={{
              items: sourceMenuItems,
              onClick: ({ key }) => { setSource(key); setPage(1); },
              selectable: true,
              selectedKeys: [source || 'all'],
            }}
            trigger={['click']}
            placement="bottomLeft"
          >
            <button
              type="button"
              className={[
                'inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-[13px] transition-colors',
                source
                  ? 'border-indigo-200 text-indigo-600 bg-indigo-50/40'
                  : 'border-indigo-100 text-slate-600 hover:bg-indigo-50 hover:text-indigo-600',
              ].join(' ')}
            >
              <Filter className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>{source ? sourceOptions.find((o) => o.key === source)?.label : '全部来源'}</span>
              <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
            </button>
          </Dropdown>
          <div className="ml-auto text-[12px] text-slate-400">共 {total} 个用户</div>
        </div>

        <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
          <div className="col-span-2">用户名</div>
          <div className="col-span-2">姓名</div>
          <div className="col-span-2">部门</div>
          <div className="col-span-1">来源</div>
          <div className="col-span-2">角色</div>
          <div className="col-span-1">状态</div>
          <div className="col-span-2 text-right">操作</div>
        </div>

        <div className="divide-y divide-indigo-50/50 max-h-[calc(100vh-340px)] overflow-y-auto">
          {isLoading ? (
            <div className="px-5 py-12 text-center text-[13px] text-slate-400">加载中…</div>
          ) : users.length === 0 ? (
            <div className="px-5 py-12 text-center text-[13px] text-slate-400">暂无用户数据</div>
          ) : (
            users.map((u) => {
              const initial = (u.nickname || u.username).charAt(0);
              return (
                <div
                  key={u.id}
                  onClick={() => openEdit(u)}
                  className="grid grid-cols-12 cursor-pointer items-center gap-3 px-5 py-3 transition-colors hover:bg-indigo-50/30"
                >
                  <div className="col-span-6 font-mono text-[12px] text-slate-600 md:col-span-2">{u.username}</div>
                  <div className="col-span-6 flex items-center gap-2 md:col-span-2">
                    <div
                      className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                      style={{ background: getAvatarColor(u.nickname || u.username) }}
                    >
                      {initial}
                    </div>
                    <span className="text-[13px] font-medium text-slate-900">{u.nickname || '-'}</span>
                  </div>
                  <div className="col-span-6 text-[12px] text-slate-600 md:col-span-2">{u.department || '-'}</div>
                  <div className="col-span-3 md:col-span-1">
                    {u.source === 'ldap' ? (
                      <span className="inline-flex items-center rounded border border-cyan-100 bg-cyan-50/50 px-1 py-0.5 text-[10px] font-medium text-cyan-700">LDAP</span>
                    ) : (
                      <span className="inline-flex items-center rounded border border-indigo-100 bg-indigo-50/50 px-1 py-0.5 text-[10px] font-medium text-indigo-600">本地</span>
                    )}
                  </div>
                  <div className="col-span-6 flex flex-wrap items-center gap-1 md:col-span-2">
                    {(u.roles || []).length === 0 ? (
                      <span className="text-[11px] text-slate-400">-</span>
                    ) : (
                      (u.roles || []).map((r) => (
                        <span
                          key={r.id}
                          className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${getRoleBadgeClass(r.code)}`}
                        >
                          {r.name}
                        </span>
                      ))
                    )}
                  </div>
                  <div className="col-span-3 md:col-span-1">
                    {u.is_active ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        启用
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                        停用
                      </span>
                    )}
                  </div>
                  <div className="col-span-6 flex items-center justify-end gap-1 md:col-span-2">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openEdit(u); }}
                      className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                      title="编辑"
                    >
                      <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                    <ChevronRight className="h-4 w-4 text-slate-300" strokeWidth={1.5} />
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-indigo-50 px-5 py-3">
          <div className="text-[12px] text-slate-400">
            {total === 0 ? '暂无数据' : `第 ${start}-${end} 条 / 共 ${total} 条`}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-indigo-100 text-slate-400 transition-colors hover:bg-indigo-50 disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
            {Array.from({ length: totalPages }).slice(0, 7).map((_, idx) => {
              const p = idx + 1;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPage(p)}
                  className={[
                    'flex h-7 w-7 items-center justify-center rounded-md text-[12px] font-medium transition-colors',
                    p === page
                      ? 'bg-indigo-500 text-white'
                      : 'border border-indigo-100 text-slate-600 hover:bg-indigo-50',
                  ].join(' ')}
                >
                  {p}
                </button>
              );
            })}
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-indigo-100 text-slate-400 transition-colors hover:bg-indigo-50 disabled:opacity-40"
            >
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
