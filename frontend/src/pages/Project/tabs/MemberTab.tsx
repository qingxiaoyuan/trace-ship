import { useCallback, useMemo, useState } from 'react';
import { Table, Button, Space, Avatar, App, Modal, Form, Select } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { accountApi, type AccountUser } from '@/api/account';
import {
  projectMemberApi,
  type ProjectMember,
  type ProjectMemberRole,
  type ProjectMemberUser,
} from '@/api/projectMember';
import { getAvatarColor } from '@/utils/avatar';

const roleMap: Record<ProjectMemberRole, string> = {
  manager: '项目负责人',
  tester: '测试人员',
  developer: '开发工程师',
  auditor: '审核人',
  viewer: '只读人员',
};

// 角色选项在模块级缓存，避免每次渲染重新创建
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

  const columns = useMemo(
    () => [
      {
        title: '成员',
        dataIndex: 'user',
        key: 'user',
        render: (user: ProjectMemberUser) => (
          <Space>
            <Avatar
              size="small"
              style={{
                backgroundColor: getAvatarColor(user.nickname || user.username),
                color: '#fff',
              }}
            >
              {(user.nickname || user.username).charAt(0)}
            </Avatar>
            {user.nickname || user.username}
          </Space>
        ),
      },
      {
        title: '用户名',
        dataIndex: 'user',
        key: 'username',
        render: (user: ProjectMemberUser) => user.username,
      },
      {
        title: '部门',
        dataIndex: 'user',
        key: 'department',
        render: (user: ProjectMemberUser) => user.department || '-',
      },
      {
        title: '角色',
        dataIndex: 'role',
        key: 'role',
        render: (role: ProjectMemberRole, record: ProjectMember) => (
          <Select
            value={role}
            options={roleOptions}
            onChange={(newRole) =>
              updateMutation.mutate({ memberId: record.id, role: newRole })
            }
            loading={
              updateMutation.isPending &&
              updateMutation.variables?.memberId === record.id
            }
            style={{ width: 140 }}
          />
        ),
      },
      {
        title: '加入时间',
        dataIndex: 'created_at',
        key: 'created_at',
        render: (text: string) => new Date(text).toLocaleString(),
      },
      {
        title: '操作',
        key: 'action',
        render: (_: unknown, record: ProjectMember) => (
          <Button
            type="text"
            danger
            loading={
              removeMutation.isPending && removeMutation.variables === record.id
            }
            onClick={() => handleRemove(record)}
          >
            移除
          </Button>
        ),
      },
    ],
    [updateMutation, removeMutation, handleRemove]
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setIsModalOpen(true)}
        >
          添加成员
        </Button>
      </div>
      <Table
        rowKey="id"
        dataSource={data?.results || []}
        loading={isLoading}
        pagination={false}
        columns={columns}
      />
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
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => addMutation.mutate(values)}
        >
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
