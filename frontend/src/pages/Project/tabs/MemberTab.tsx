import { useCallback, useMemo, useState } from 'react';
import { App, Modal, Form, Select } from 'antd';
import { Plus, Search, User, Trash2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { accountApi, type AccountUser } from '@/api/account';
import {
  projectMemberApi,
  type ProjectMember,
  type ProjectMemberRole,
} from '@/api/projectMember';
import { getAvatarColor } from '@/utils/avatar';

const roleMap: Record<ProjectMemberRole, string> = {
  manager: '项目负责人',
  tester: '测试人员',
  developer: '开发工程师',
  auditor: '审核人',
  viewer: '只读人员',
};

const roleOptions = Object.entries(roleMap).map(([value, label]) => ({
  value,
  label,
}));

interface MemberTabProps {
  projectId: string;
}

export function MemberTab({ projectId }: MemberTabProps) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [form] = Form.useForm();

  const { data, isLoading } = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => projectMemberApi.getMembers(projectId),
    enabled: !!projectId,
  });

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['account-users-all'],
    queryFn: () => accountApi.getUsers({ page_size: 1000 }),
    enabled: isModalOpen,
  });

  const addMutation = useMutation({
    mutationFn: (values: { user_id: string; role: ProjectMemberRole }) =>
      projectMemberApi.addMember(projectId, values),
    onSuccess: () => {
      message.success('添加成功');
      setIsModalOpen(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['project-members', projectId] });
    },
    onError: () => message.error('添加失败'),
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
    onError: () => message.error('更新失败'),
  });

  const removeMutation = useMutation({
    mutationFn: (memberId: string) => projectMemberApi.removeMember(projectId, memberId),
    onSuccess: () => {
      message.success('移除成功');
      queryClient.invalidateQueries({ queryKey: ['project-members', projectId] });
    },
    onError: () => message.error('移除失败'),
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

  const userOptions = useMemo(
    () =>
      (usersData?.results || []).map((u: AccountUser) => ({
        value: u.id,
        label: `${u.nickname || u.username} (${u.username})`,
      })),
    [usersData]
  );

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
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">项目成员</h1>
          <p className="mt-1 text-[13px] text-slate-500">管理项目成员、角色与权限</p>
        </div>
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          添加成员
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
              placeholder="搜索成员 / 用户名 / 部门"
              className="w-[220px] rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
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

        <div className="divide-y divide-indigo-50/50 max-h-[calc(100vh-340px)] overflow-y-auto">
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
              return (
                <div
                  key={member.id}
                  className="grid grid-cols-12 items-center gap-3 px-5 py-3 transition-colors hover:bg-indigo-50/30"
                >
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
                      options={roleOptions}
                      onChange={(newRole) => updateMutation.mutate({ memberId: member.id, role: newRole })}
                      loading={updateMutation.isPending && updateMutation.variables?.memberId === member.id}
                      style={{ width: 140 }}
                    />
                  </div>
                  <div className="col-span-2 text-[12px] text-slate-600">
                    {dayjs(member.created_at).format('YYYY-MM-DD HH:mm')}
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button
                      type="button"
                      disabled={removeMutation.isPending && removeMutation.variables === member.id}
                      onClick={() => handleRemove(member)}
                      className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40"
                      title="移除"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <Modal
        title="添加成员"
        open={isModalOpen}
        onCancel={() => {
          setIsModalOpen(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        okButtonProps={{ loading: addMutation.isPending }}
      >
        <Form form={form} layout="vertical" onFinish={(values) => addMutation.mutate(values)}>
          <Form.Item
            name="user_id"
            label="选择用户"
            rules={[{ required: true, message: '请选择用户' }]}
          >
            <Select
              showSearch
              placeholder="请选择用户"
              loading={usersLoading}
              options={userOptions}
              virtual
              filterOption={(input, option) =>
                String(option?.label ?? '')
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item
            name="role"
            label="角色"
            initialValue="developer"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select options={roleOptions} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
