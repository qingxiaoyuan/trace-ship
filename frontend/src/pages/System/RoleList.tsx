import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { message } from 'antd';
import {
  Plus,
  Search,
  ChevronRight,
  Pencil,
  ArrowLeft,
  Save,
  Check,
  ShieldCheck,
  FolderKanban,
  Code2,
  Bug,
  KeyRound,
} from 'lucide-react';
import { accountApi } from '@/api/account';
import type { AccountRole, AccountPermission } from '@/api/account';

type View = 'list' | 'form';

interface FormState {
  id?: string;
  name: string;
  code: string;
  description: string;
  permission_ids: string[];
}

const emptyForm: FormState = {
  name: '',
  code: '',
  description: '',
  permission_ids: [],
};

const roleIconMap: Record<string, typeof ShieldCheck> = {
  admin: ShieldCheck,
  project_manager: FolderKanban,
  developer: Code2,
  tester: Bug,
};

const roleIconClassMap: Record<string, string> = {
  admin: 'icon-violet',
  project_manager: 'icon-indigo',
  developer: 'icon-emerald',
  tester: 'icon-amber',
};

function getRoleIcon(code: string) {
  return roleIconMap[code] || KeyRound;
}

function getRoleIconClass(code: string) {
  return roleIconClassMap[code] || 'icon-indigo';
}

export default function SystemRoleList() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>('list');
  const [keyword, setKeyword] = useState('');
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['account-roles'],
    queryFn: () => accountApi.getRoles({ page_size: 1000 }),
    enabled: view === 'list',
  });

  const { data: permissionsData } = useQuery({
    queryKey: ['account-permissions'],
    queryFn: () => accountApi.getPermissions({ page_size: 1000 }),
    enabled: view === 'form',
  });

  const permissions = useMemo<AccountPermission[]>(() => permissionsData?.results || [], [permissionsData]);

  const groupedPermissions = useMemo(() => {
    const map = new Map<string, AccountPermission[]>();
    permissions.forEach((p) => {
      const mod = p.module || '其他';
      if (!map.has(mod)) map.set(mod, []);
      map.get(mod)!.push(p);
    });
    return Array.from(map.entries()).map(([module, items]) => ({ module, items }));
  }, [permissions]);

  const filteredRoles = useMemo(() => {
    const list = data?.results || [];
    if (!keyword.trim()) return list;
    const kw = keyword.toLowerCase();
    return list.filter((r) => r.name.toLowerCase().includes(kw) || r.code.toLowerCase().includes(kw));
  }, [data, keyword]);

  const saveMutation = useMutation({
    mutationFn: async (payload: FormState) => {
      const body = {
        name: payload.name,
        code: payload.code,
        description: payload.description,
        permission_ids: payload.permission_ids,
      };
      if (payload.id) {
        return accountApi.updateRole(payload.id, body);
      }
      return accountApi.createRole(body);
    },
    onSuccess: () => {
      message.success('保存成功');
      queryClient.invalidateQueries({ queryKey: ['account-roles'] });
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
    setView('form');
  };

  const openEdit = (role: AccountRole) => {
    setForm({
      id: role.id,
      name: role.name,
      code: role.code,
      description: role.description || '',
      permission_ids: (role.permissions || []).map((p) => p.id),
    });
    setView('form');
  };

  const handleSave = () => {
    if (!form.name.trim()) {
      message.warning('请输入角色名称');
      return;
    }
    if (!form.code.trim()) {
      message.warning('请输入角色编码');
      return;
    }
    setSaving(true);
    saveMutation.mutate(form);
  };

  const togglePermission = (id: string) => {
    setForm((prev) => ({
      ...prev,
      permission_ids: prev.permission_ids.includes(id)
        ? prev.permission_ids.filter((p) => p !== id)
        : [...prev.permission_ids, id],
    }));
  };

  const toggleGroup = (items: AccountPermission[], selectAll: boolean) => {
    setForm((prev) => {
      const ids = new Set(prev.permission_ids);
      items.forEach((i) => {
        if (selectAll) ids.add(i.id);
        else ids.delete(i.id);
      });
      return { ...prev, permission_ids: Array.from(ids) };
    });
  };

  const selectAllPermissions = () => {
    setForm((prev) => ({ ...prev, permission_ids: permissions.map((p) => p.id) }));
  };

  const clearPermissions = () => {
    setForm((prev) => ({ ...prev, permission_ids: [] }));
  };

  if (view === 'form') {
    const isEdit = Boolean(form.id);
    const selectedPerms = permissions.filter((p) => form.permission_ids.includes(p.id));

    const moduleLabelMap: Record<string, string> = {
      project: '项目管理',
      release: '发布管理',
      repository: '仓库管理',
      credential: '凭证管理',
      jenkins: 'Jenkins',
      commit: '提交审查',
      system: '系统管理',
      auth: '认证',
      workflow: '工作流',
      dashboard: '工作台',
    };

    return (
      <div className="space-y-5 page-fade-in">
        <div className="flex items-center gap-2 text-[13px]">
          <button
            type="button"
            onClick={() => setView('list')}
            className="inline-flex items-center gap-1 text-slate-400 transition-colors hover:text-indigo-600"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
            角色管理
          </button>
        </div>

        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">
            {isEdit ? '编辑角色' : '新增角色'}
          </h1>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
          <div className="space-y-5">
            <div className="tech-card space-y-4 rounded-xl p-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-slate-600">
                    角色名称 <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="如：项目经理"
                    className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[13px] text-slate-700 placeholder-slate-400 outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-slate-600">
                    角色编码 <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    placeholder="如：project_manager"
                    className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-mono text-[13px] text-slate-700 placeholder-slate-400 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-slate-600">描述</label>
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="角色职责说明"
                  className="input-field w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[13px] text-slate-700 placeholder-slate-400 outline-none"
                />
              </div>
            </div>

            <div className="tech-card rounded-xl p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="icon-emerald flex h-7 w-7 items-center justify-center rounded-lg">
                    <KeyRound className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </div>
                  <h3 className="text-[14px] font-semibold text-slate-900">权限分配</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={selectAllPermissions} className="text-[11px] font-medium text-indigo-600 hover:text-indigo-500">全选</button>
                  <span className="text-slate-300">|</span>
                  <button type="button" onClick={clearPermissions} className="text-[11px] font-medium text-slate-500 hover:text-indigo-600">清空</button>
                </div>
              </div>

              <div className="space-y-4">
                {groupedPermissions.length === 0 ? (
                  <div className="py-6 text-center text-[12px] text-slate-400">暂无权限数据</div>
                ) : (
                  groupedPermissions.map((group) => {
                    const allSelected = group.items.every((i) => form.permission_ids.includes(i.id));
                    return (
                      <div key={group.module} className="border-t border-indigo-50 pt-3 first:border-0 first:pt-0">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                            {moduleLabelMap[group.module] || group.module}
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleGroup(group.items, !allSelected)}
                            className="text-[10px] font-medium text-slate-400 hover:text-indigo-600"
                          >
                            {allSelected ? '取消本组' : '全选本组'}
                          </button>
                        </div>
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                          {group.items.map((perm) => {
                            const checked = form.permission_ids.includes(perm.id);
                            return (
                              <button
                                key={perm.id}
                                type="button"
                                onClick={() => togglePermission(perm.id)}
                                className={[
                                  'flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors',
                                  checked
                                    ? 'border-indigo-200 bg-indigo-50/40'
                                    : 'border-slate-200 bg-white hover:border-indigo-300',
                                ].join(' ')}
                              >
                                <span
                                  className="relative inline-flex h-4 w-4 items-center justify-center rounded border-2"
                                  style={{
                                    borderColor: checked ? '#4F46E5' : '#CBD5E1',
                                    background: checked ? '#4F46E5' : 'transparent',
                                  }}
                                >
                                  {checked ? <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} /> : null}
                                </span>
                                <span className="text-[12px] text-slate-700">{perm.name}</span>
                                <span className="ml-auto font-mono text-[10px] text-slate-400">{perm.code}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
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
                className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium text-white disabled:opacity-60"
              >
                <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
                保存
              </button>
            </div>
          </div>

          <div className="tech-card sticky top-20 h-fit rounded-xl p-5">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">已选权限</div>
            <div className="space-y-1.5">
              {selectedPerms.length === 0 ? (
                <div className="py-4 text-center text-[12px] text-slate-400">未选择权限</div>
              ) : (
                selectedPerms.map((perm) => (
                  <div key={perm.id} className="flex items-center gap-2 text-[12px]">
                    <Check className="h-3 w-3 text-emerald-500" strokeWidth={2} />
                    <span className="text-slate-700">{perm.name}</span>
                    <span className="ml-auto font-mono text-[10px] text-slate-400">{perm.code}</span>
                  </div>
                ))
              )}
            </div>
            <div className="mt-4 border-t border-indigo-50 pt-3 text-[12px] text-slate-400">
              已选 <span className="font-mono font-semibold text-indigo-600">{form.permission_ids.length}</span> 项权限
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 page-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">角色管理</h1>
          <p className="mt-1 text-[13px] text-slate-500">管理系统角色与权限分配，角色是一组权限的集合</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          新增角色
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
              placeholder="搜索角色名 / 编码"
              className="w-[200px] rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div className="ml-auto text-[12px] text-slate-400">共 {filteredRoles.length} 个角色</div>
        </div>

        <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
          <div className="col-span-3">角色名称</div>
          <div className="col-span-2">编码</div>
          <div className="col-span-4">描述</div>
          <div className="col-span-2 text-center">权限数</div>
          <div className="col-span-1 text-right">操作</div>
        </div>

        <div className="divide-y divide-indigo-50/50 max-h-[calc(100vh-300px)] overflow-y-auto">
          {isLoading ? (
            <div className="px-5 py-12 text-center text-[13px] text-slate-400">加载中…</div>
          ) : filteredRoles.length === 0 ? (
            <div className="px-5 py-12 text-center text-[13px] text-slate-400">暂无角色数据</div>
          ) : (
            filteredRoles.map((role) => {
              const Icon = getRoleIcon(role.code);
              const permCount = role.permissions?.length ?? 0;
              return (
                <div
                  key={role.id}
                  onClick={() => openEdit(role)}
                  className="grid grid-cols-12 cursor-pointer items-center gap-3 px-5 py-3.5 transition-colors hover:bg-indigo-50/30"
                >
                  <div className="col-span-12 flex items-center gap-2 md:col-span-3">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${getRoleIconClass(role.code)}`}>
                      <Icon className="h-4 w-4" strokeWidth={1.5} />
                    </div>
                    <span className="text-[13px] font-medium text-slate-900">{role.name}</span>
                  </div>
                  <div className="col-span-6 font-mono text-[12px] text-slate-500 md:col-span-2">{role.code}</div>
                  <div className="col-span-12 text-[12px] text-slate-500 md:col-span-4">{role.description || '-'}</div>
                  <div className="col-span-3 text-center font-mono text-[13px] text-slate-700 md:col-span-2">
                    {role.code === 'admin' ? '全部' : permCount}
                  </div>
                  <div className="col-span-3 flex items-center justify-end gap-1 md:col-span-1">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openEdit(role); }}
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
      </div>
    </div>
  );
}
