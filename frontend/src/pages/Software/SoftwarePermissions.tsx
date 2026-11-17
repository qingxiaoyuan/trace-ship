import { useMutation } from '@tanstack/react-query';
import { Button, Form, Input, Modal, Popconfirm } from 'antd';
import { softwareApi, type Software } from '@/api/software';
import { PermissionAlert } from '@/components/PermissionAlert';

interface Props {
  software: Software;
  onClose: () => void;
  refresh: () => Promise<void>;
}

type AuthorizationChange =
  | { kind: 'grant' | 'transfer'; username: string }
  | { kind: 'revoke'; userId: string };

export function SoftwarePermissions({ software, onClose, refresh }: Props) {
  const [grantForm] = Form.useForm<{ username: string }>();
  const [transferForm] = Form.useForm<{ owner: string }>();
  const change = useMutation({
    mutationFn: (operation: AuthorizationChange) => {
      if (operation.kind === 'revoke') return softwareApi.revoke(software.id, operation.userId);
      if (operation.kind === 'transfer') return softwareApi.update(software.id, { owner_username: operation.username });
      return softwareApi.grant(software.id, operation.username);
    },
    onSuccess: async (_, operation) => {
      if (operation.kind === 'grant') grantForm.resetFields();
      if (operation.kind === 'transfer') onClose();
      await refresh();
    },
  });
  return (
    <Modal title="维护授权" open footer={null} onCancel={onClose}>
      <div className="space-y-4">
        <p className="break-all text-sm font-semibold text-slate-800">{software.name}</p>
        <p className="break-all text-sm text-slate-600">
          当前负责人 {software.owner.nickname || software.owner.username}
        </p>
        {software.maintainers.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {software.maintainers.map((user) => (
              <li key={user.id} className="flex items-center justify-between gap-2 py-1">
                <span className="min-w-0 break-all">{user.nickname || user.username}</span>
                <Button
                  className="min-h-9"
                  aria-label={`撤销 ${user.username}`}
                  disabled={change.isPending}
                  onClick={() => change.mutate({ kind: 'revoke', userId: user.id })}
                >撤销</Button>
              </li>
            ))}
          </ul>
        )}
        <Form
          form={grantForm}
          layout="vertical"
          onFinish={({ username }) => change.mutate({ kind: 'grant', username })}
        >
          <Form.Item name="username" label="协作维护者登录名" rules={[{ required: true, whitespace: true, message: '请输入登录名' }]}>
            <Input maxLength={150} />
          </Form.Item>
          <Button htmlType="submit" className="min-h-9" disabled={change.isPending}>授权</Button>
        </Form>
        <Form form={transferForm} layout="vertical" className="border-t border-slate-100 pt-4">
          <Form.Item name="owner" label="新负责人登录名" rules={[{ required: true, whitespace: true, message: '请输入登录名' }]}>
            <Input maxLength={150} />
          </Form.Item>
          <Popconfirm
            title="移交软件维护负责人"
            description="新负责人将接管维护授权和软件启停。"
            okText="确认移交"
            cancelText="取消"
            onConfirm={async () => {
              const { owner } = await transferForm.validateFields().catch(() => ({ owner: undefined }));
              if (owner) change.mutate({ kind: 'transfer', username: owner });
            }}
          >
            <Button className="min-h-9" disabled={change.isPending}>移交负责人</Button>
          </Popconfirm>
        </Form>
        <PermissionAlert error={change.error} errorTitle="更新授权失败" />
      </div>
    </Modal>
  );
}
