import { useCallback, useMemo, useState } from 'react';
import { App, Form, Select, Button } from 'antd';
import { Plus, Search, User, Trash2, CalendarDays, UserPlus, X, Info } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { accountApi, type AccountUser } from '@/api/account';
import { projectApi } from '@/api/project';
import {
  projectMemberApi,
  type ProjectMember,
  type ProjectMemberRole,
} from '@/api/projectMember';
import { getAvatarColor } from '@/utils/avatar';
import { useProjectRole } from '@/hooks/useProjectRole';
import { PermissionAlert } from '@/components/PermissionAlert';
import { TsModal } from '@/components/TsModal';

const roleMap: Record<ProjectMemberRole, string> = {
  manager: '产品负责人',
  tester: '测试人员',
  developer: '开发工程师',
  auditor: '审核人',
  viewer: '只读人员',
  software_admin: '软件管理员',
};

/** 按可授予角色集合过滤出角色下拉选项 */
function buildRoleOptions(grantableRoles: ProjectMemberRole[]) {
  return grantableRoles.map((value) => ({ value, label: roleMap[value] }));
}

/** 解析用户选项标签「昵称 (域账号)」，供选中胶囊与下拉选项共用 */
function parseUserLabel(label: unknown) {
  const text = String(label ?? '');
  return {
    name: text.replace(/\s*\(.*\)$/, ''),
    username: text.match(/\((.*)\)/)?.[1] || '',
  };
}

/** 角色卡片上的权限说明 */
const roleDescMap: Record<ProjectMemberRole, string> = {
  manager: '管理产品成员、仓库与全部设置',
  developer: '可同步提交、发起发布申请与打包任务',
  tester: '可查看发布与打包记录，参与测试验证',
  auditor: '可处理审批任务，不可发起发布',
  viewer: '仅可查看产品与发布信息',
  software_admin: '等同项目内全部权限',
};

/** 角色单选卡片：写入 role 表单字段，与原下拉行为一致 */
function RoleCardSelect({
  value,
  onChange,
  options,
}: {
  value?: ProjectMemberRole;
  onChange?: (value: ProjectMemberRole) => void;
  options: { value: ProjectMemberRole; label: string }[];
}) {
  return (
    <div className="space-y-2">
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange?.(opt.value)}
            className={
              selected
                ? 'flex w-full items-start gap-3 rounded-lg bg-[#EEF2FF] px-3.5 py-3 text-left ring-2 ring-[#4F46E5] transition'
                : 'group flex w-full items-start gap-3 rounded-lg bg-white px-3.5 py-3 text-left ring-1 ring-[#E0E7FF] transition hover:ring-[#6366F1]'
            }
          >
            <span
              className={
                selected
                  ? 'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#4F46E5]'
                  : 'mt-0.5 h-4 w-4 shrink-0 rounded-full ring-1 ring-slate-300 transition group-hover:ring-[#6366F1]'
              }
            >
              {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className={`text-[13px] font-medium ${selected ? 'text-slate-900' : 'text-slate-700'}`}>
                  {opt.label}
                </span>
                {opt.value === 'developer' && (
                  <span className="rounded-full bg-[#4F46E5]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#4F46E5]">
                    常用
                  </span>
                )}
              </span>
              <span className={`mt-0.5 block text-[11px] leading-relaxed ${selected ? 'text-slate-500' : 'text-slate-400'}`}>
                {roleDescMap[opt.value]}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface MemberTabProps {
  projectId: string;
}

export function MemberTab({ projectId }: MemberTabProps) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [form] = Form.useForm();
  const selectedUserIds: string[] = Form.useWatch('user_ids', form) || [];

  const { data, isLoading, error } = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => projectMemberApi.getMembers(projectId),
    enabled: !!projectId,
  });

  // 任意产品成员均可拉人（可授予角色按当前用户角色收缩）；改角色/移除仅产品管理员
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectApi.getProject(projectId),
    enabled: !!projectId,
  });
  const { canManage, canAddMember, grantableRoles } = useProjectRole(project);
  const roleOptions = useMemo(() => buildRoleOptions(grantableRoles), [grantableRoles]);

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['account-users-all'],
    queryFn: () => accountApi.getUsers({ page_size: 1000 }),
    enabled: isModalOpen,
  });

  const addMutation = useMutation({
    mutationFn: (values: { user_ids: string[]; role: ProjectMemberRole }) =>
      projectMemberApi.addMembers(projectId, values),
    onSuccess: (result) => {
      message.success(
        result.skipped > 0
          ? `已添加 ${result.created.length} 位成员，${result.skipped} 位已在产品中自动跳过`
          : '添加成功'
      );
      setIsModalOpen(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['project-members', projectId] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      memberId,
      role,
    }: {
      memberId: string;
      role: ProjectMemberRole;
    }) => projectMemberApi.updateMember(projectId, memberId, { role }),
    onSuccess: () => {
      message.success('更新成功');
      queryClient.invalidateQueries({ queryKey: ['project-members', projectId] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (memberId: string) => projectMemberApi.removeMember(projectId, memberId),
    onSuccess: () => {
      message.success('移除成功');
      queryClient.invalidateQueries({ queryKey: ['project-members', projectId] });
    },
  });

  const handleRemove = useCallback(
    (member: ProjectMember) => {
      modal.confirm({
        title: '确认移除成员',
        content: `确定要移除成员「${member.user.nickname || member.user.username}」吗？`,
        okText: '移除',
        okType: 'danger',
        cancelText: '取消',
        onOk: () => removeMutation.mutate(member.id),
      });
    },
    [modal, removeMutation]
  );

  const userOptions = useMemo(() => {
    // 过滤掉已在产品中的用户与已停用用户，避免重复添加、避免拉入停用账号
    const existingIds = new Set((data?.results || []).map((m) => String(m.user_id)));
    return (usersData?.results || [])
      .filter((u: AccountUser) => u.is_active !== false && !existingIds.has(String(u.id)))
      .map((u: AccountUser) => ({
        value: u.id,
        label: `${u.nickname || u.username} (${u.username})`,
      }));
  }, [usersData, data]);

  const filteredMembers = useMemo(() => {
    const members = data?.results || [];
    if (!keyword.trim()) return members;
    const lower = keyword.toLowerCase();
    return members.filter((m) => {
      const name = (m.user.nickname || m.user.username).toLowerCase();
      const username = m.user.username.toLowerCase();
      const department = (m.user.department || '').toLowerCase();
      return name.includes(lower) || username.includes(lower) || department.includes(lower);
    });
  }, [data, keyword]);

  return (
    <div className="space-y-5 page-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">产品成员</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            {canManage
              ? '管理产品成员、角色与权限'
              : '产品成员与角色（可添加成员，角色调整仅产品管理员）'}
          </p>
        </div>
        {canAddMember && (
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
            添加成员
          </button>
        )}
      </div>

      <PermissionAlert error={error} className="rounded-xl" />

      <div className="tech-card overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center gap-2 border-b border-indigo-50 px-5 py-3">
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" strokeWidth={1.5} />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索成员 / 用户名 / 部门"
              className="w-full sm:w-[220px] rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div className="ml-auto text-[12px] text-slate-400">共 {filteredMembers.length} 位成员</div>
        </div>

        <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
          <div className="col-span-3">成员</div>
          <div className="col-span-2">用户名</div>
          <div className="col-span-2">部门</div>
          <div className="col-span-2">角色</div>
          <div className="col-span-2">加入时间</div>
          <div className="col-span-1 text-right">操作</div>
        </div>

        <div className="divide-y divide-indigo-50/50 max-md:divide-y-0 max-md:space-y-3 max-md:p-3 max-h-[calc(100vh-340px)] overflow-y-auto max-md:max-h-none">
          {isLoading ? (
            <div className="px-5 py-12 text-center text-[13px] text-slate-400">加载中…</div>
          ) : filteredMembers.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-5 py-12 text-[13px] text-slate-400">
              <User className="mb-2 h-8 w-8 text-slate-300" strokeWidth={1.5} />
              暂无成员
            </div>
          ) : (
            filteredMembers.map((member) => {
              const name = member.user.nickname || member.user.username;
              const initial = name.charAt(0);
              // 行内角色 Select：可授选项之外的当前角色仅作回显（不可再选中授予）
              const memberRoleOptions = roleOptions.some((o) => o.value === member.role)
                ? roleOptions
                : [...roleOptions, { value: member.role, label: roleMap[member.role] }];
              return (
                <div
                  key={member.id}
                  className="transition-colors hover:bg-indigo-50/30 max-md:rounded-xl max-md:border max-md:border-indigo-100/70 max-md:bg-white max-md:p-4"
                >
                  {/* 桌面端网格行 */}
                  <div className="hidden grid-cols-12 items-center gap-3 px-5 py-3 md:grid">
                    <div className="col-span-3 flex items-center gap-2">
                      <div
                        className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                        style={{ background: getAvatarColor(name) }}
                      >
                        {initial}
                      </div>
                      <span className="text-[13px] font-medium text-slate-900">{name}</span>
                    </div>
                    <div className="col-span-2 text-[12px] text-slate-600">{member.user.username}</div>
                    <div className="col-span-2 text-[12px] text-slate-600">{member.user.department || '-'}</div>
                    <div className="col-span-2">
                      <Select
                        value={member.role}
                        options={memberRoleOptions}
                        disabled={!canManage}
                        onChange={(newRole) => updateMutation.mutate({ memberId: member.id, role: newRole })}
                        loading={updateMutation.isPending && updateMutation.variables?.memberId === member.id}
                        style={{ width: 140 }}
                      />
                    </div>
                    <div className="col-span-2 text-[12px] text-slate-600">
                      {dayjs(member.created_at).format('YYYY-MM-DD HH:mm')}
                    </div>
                    <div className="col-span-1 flex justify-end">
                      {canManage && (
                        <button
                          type="button"
                          disabled={removeMutation.isPending && removeMutation.variables === member.id}
                          onClick={() => handleRemove(member)}
                          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40"
                          title="移除"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 移动端卡片（参考 docs/ui/mobile/mobile-release.html） */}
                  <div className="md:hidden">
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-600">
                        {roleMap[member.role]}
                      </span>
                      {member.user.department ? (
                        <span className="truncate rounded-md bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
                          {member.user.department}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2.5 flex items-center gap-2.5">
                      <div
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[12px] font-semibold text-white"
                        style={{ background: getAvatarColor(name) }}
                      >
                        {initial}
                      </div>
                      <div className="flex min-w-0 items-baseline gap-2">
                        <span className="truncate text-[15px] font-semibold tracking-tight text-slate-900">{name}</span>
                        <span className="truncate font-mono text-[12px] text-slate-400">{member.user.username}</span>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
                      <CalendarDays className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                      <span>{dayjs(member.created_at).format('YYYY-MM-DD')} 加入</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-indigo-50 pt-3">
                      <Select
                        value={member.role}
                        options={memberRoleOptions}
                        disabled={!canManage}
                        onChange={(newRole) => updateMutation.mutate({ memberId: member.id, role: newRole })}
                        loading={updateMutation.isPending && updateMutation.variables?.memberId === member.id}
                        style={{ width: 132, height: 36 }}
                      />
                      {canManage && (
                        <button
                          type="button"
                          disabled={removeMutation.isPending && removeMutation.variables === member.id}
                          onClick={() => handleRemove(member)}
                          className="rounded-md p-3 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40"
                          title="移除"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <TsModal
        title="添加成员"
        subtitle="将成员加入产品并授予角色"
        titleIcon={<UserPlus className="h-[18px] w-[18px]" strokeWidth={1.5} />}
        open={isModalOpen}
        onCancel={() => {
          setIsModalOpen(false);
          form.resetFields();
        }}
        footer={
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400">
              已选择 <span className="font-semibold text-[#4F46E5]">{selectedUserIds.length}</span> 名成员
            </span>
            <div className="flex items-center gap-3">
              <Button
                type="text"
                className="h-auto rounded-lg px-4 py-2 text-[13px] font-medium text-slate-500 transition hover:text-slate-700"
                onClick={() => {
                  setIsModalOpen(false);
                  form.resetFields();
                }}
              >
                取消
              </Button>
              <Button
                type="primary"
                className="inline-flex h-auto items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium"
                loading={addMutation.isPending}
                onClick={() => form.submit()}
              >
                <UserPlus className="h-3.5 w-3.5" strokeWidth={1.5} />
                添加成员
              </Button>
            </div>
          </div>
        }
      >
        <Form form={form} layout="vertical" onFinish={(values) => addMutation.mutate(values)}>
          <Form.Item
            name="user_ids"
            label="选择用户"
            rules={[{ required: true, message: '请选择用户' }]}
          >
            <Select
              mode="multiple"
              showSearch
              placeholder="搜索姓名或域账号，可多选"
              loading={usersLoading}
              options={userOptions}
              virtual
              maxTagCount="responsive"
              filterOption={(input, option) =>
                String(option?.label ?? '')
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
              tagRender={(props) => {
                const { name } = parseUserLabel(props.label);
                return (
                  <span className="my-0.5 mr-1 inline-flex items-center gap-1.5 rounded-full bg-[#EEF2FF] py-0.5 pl-0.5 pr-2 ring-1 ring-[#4F46E5]/20">
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                      style={{ background: getAvatarColor(name) }}
                    >
                      {name.charAt(0).toUpperCase()}
                    </span>
                    <span className="text-[12px] font-medium text-[#3730A3]">{name}</span>
                    {props.closable && (
                      <span
                        role="button"
                        aria-label="移除"
                        className="cursor-pointer text-[#6366F1] transition hover:text-[#3730A3]"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={props.onClose}
                      >
                        <X className="h-3 w-3" strokeWidth={1.5} />
                      </span>
                    )}
                  </span>
                );
              }}
              optionRender={(opt) => {
                const { name, username } = parseUserLabel(opt.label);
                return (
                  <div className="flex items-center gap-2.5 py-0.5">
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                      style={{ background: getAvatarColor(name) }}
                    >
                      {name.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] leading-tight text-slate-700">{name}</span>
                      <span className="block text-[11px] leading-tight text-slate-400">{username}</span>
                    </span>
                  </div>
                );
              }}
            />
          </Form.Item>
          <Form.Item
            name="role"
            label="授予角色"
            initialValue="developer"
            rules={[{ required: true, message: '请选择角色' }]}
            extra={
              <p className="mb-0 mt-2 flex items-center gap-1 text-[11px] text-slate-400">
                <Info className="h-3 w-3" strokeWidth={1.5} />
                当前角色可授予：{roleOptions.map((o) => o.label).join(' / ')}
              </p>
            }
          >
            <RoleCardSelect options={roleOptions} />
          </Form.Item>
        </Form>
      </TsModal>
    </div>
  );
}
