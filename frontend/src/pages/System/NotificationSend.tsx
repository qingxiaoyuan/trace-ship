import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { App, Button, Form, Input, Radio, Select } from 'antd';
import { Bell, Send, Users } from 'lucide-react';
import { notificationApi } from '@/api/notification';
import { accountApi, type AccountUser } from '@/api/account';

interface BroadcastFormValues {
  title: string;
  content: string;
  scope: 'all' | 'users';
  user_ids?: string[];
}

/** 系统管理 · 通知发送：向全员或指定用户下发系统通知（需 system.notification 权限） */
export default function NotificationSend() {
  const { message } = App.useApp();
  const [form] = Form.useForm<BroadcastFormValues>();
  const scope = Form.useWatch('scope', form) ?? 'all';
  const [lastSent, setLastSent] = useState<number | null>(null);

  // 指定用户时加载用户列表（人员查询全员可读，普通管理员也可用）
  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['notification-broadcast-users'],
    queryFn: () => accountApi.getUsers({ page_size: 1000 }),
    enabled: scope === 'users',
  });
  const userOptions = useMemo(
    () =>
      (usersData?.results || [])
        // 停用用户不能接收通知，不出现在选择器中（后端同样按 is_active 过滤）
        .filter((u: AccountUser) => u.is_active !== false)
        .map((u: AccountUser) => ({
          value: u.id,
          label: `${u.nickname || u.username}（${u.username}）`,
        })),
    [usersData],
  );

  const sendMutation = useMutation({
    mutationFn: (values: BroadcastFormValues) =>
      notificationApi.broadcast({
        title: values.title,
        content: values.content,
        scope: values.scope,
        user_ids: values.scope === 'users' ? values.user_ids : undefined,
      }),
    onSuccess: (result) => {
      message.success(`已发送给 ${result.count} 位用户`);
      setLastSent(result.count);
      // resetFields 恢复 initialValues（含 scope: 'all'）
      form.resetFields();
    },
  });

  return (
    <div className="space-y-5 page-fade-in">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">通知发送</h1>
        <p className="mt-1 text-[13px] text-slate-500">
          向全部用户或指定用户发送系统通知，接收人将在通知中心看到（系统类型）
        </p>
      </div>

      <div className="tech-card max-w-2xl rounded-xl px-6 py-5">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg icon-cyan">
            <Bell className="h-3.5 w-3.5" strokeWidth={1.5} />
          </div>
          <div className="text-[14px] font-semibold text-slate-900">新建系统通知</div>
        </div>

        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{ scope: 'all' }}
          onFinish={(values) => sendMutation.mutate(values)}
        >
          <Form.Item
            name="title"
            label={<span className="text-[12px] font-medium text-slate-600">通知标题</span>}
            rules={[
              { required: true, whitespace: true, message: '请输入通知标题' },
              { max: 200, message: '标题不能超过 200 字' },
            ]}
          >
            <Input placeholder="如：系统停机维护通知" className="rounded-lg" />
          </Form.Item>
          <Form.Item
            name="content"
            label={<span className="text-[12px] font-medium text-slate-600">通知内容</span>}
            rules={[
              { required: true, whitespace: true, message: '请输入通知内容' },
              { max: 2000, message: '内容不能超过 2000 字' },
            ]}
          >
            <Input.TextArea
              rows={5}
              showCount
              maxLength={2000}
              placeholder="输入通知正文，将原样展示在通知中心"
              className="rounded-lg"
            />
          </Form.Item>
          <Form.Item
            name="scope"
            label={<span className="text-[12px] font-medium text-slate-600">接收范围</span>}
          >
            <Radio.Group
              options={[
                { label: '全部用户', value: 'all' },
                { label: '指定用户', value: 'users' },
              ]}
            />
          </Form.Item>
          {scope === 'users' && (
            <Form.Item
              name="user_ids"
              label={<span className="text-[12px] font-medium text-slate-600">接收用户</span>}
              rules={[{ required: true, message: '请选择接收用户' }]}
            >
              <Select
                mode="multiple"
                showSearch
                placeholder="请选择接收用户，支持搜索与多选"
                loading={usersLoading}
                options={userOptions}
                optionFilterProp="label"
                maxTagCount="responsive"
              />
            </Form.Item>
          )}

          <div className="flex items-center gap-3">
            <Button
              type="primary"
              htmlType="submit"
              loading={sendMutation.isPending}
              icon={<Send className="h-3.5 w-3.5" strokeWidth={1.5} />}
            >
              发送通知
            </Button>
            {lastSent !== null && (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-400">
                <Users className="h-3.5 w-3.5" strokeWidth={1.5} />
                上次发送：{lastSent} 位用户
              </span>
            )}
          </div>
        </Form>
      </div>
    </div>
  );
}
