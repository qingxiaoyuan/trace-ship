import { Card, Avatar, Tabs, Form, Input, Button, Checkbox, message } from 'antd';
import { LockOutlined, NotificationOutlined } from '@ant-design/icons';
import { TsCard } from '@/components/TsCard';
import { tokens } from '@/styles/theme';

const { TabPane } = Tabs;

export default function Profile() {
  const [passwordForm] = Form.useForm();
  const [notifyForm] = Form.useForm();

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Card
        className="text-center"
        style={{
          borderRadius: tokens.layout.cardRadius,
          border: `1px solid ${tokens.colors.border}`,
        }}
      >
        <Avatar size={80} style={{ background: tokens.colors.primary }}>张</Avatar>
        <div className="mt-4 text-xl font-semibold">张三</div>
        <div className="text-slate-500">发布工程师 · 研发部</div>
        <div className="text-slate-400 text-sm mt-1">zhangsan@example.com</div>
      </Card>

      <TsCard title="账号设置">
        <Tabs defaultActiveKey="password">
          <TabPane tab={<span><LockOutlined /> 修改密码</span>} key="password">
            <Form form={passwordForm} layout="vertical" className="max-w-md">
              <Form.Item name="old_password" label="原密码" rules={[{ required: true }]}>
                <Input.Password />
              </Form.Item>
              <Form.Item name="new_password" label="新密码" rules={[{ required: true }]}>
                <Input.Password />
              </Form.Item>
              <Form.Item
                name="confirm_password"
                label="确认新密码"
                rules={[
                  { required: true },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue('new_password') === value) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error('两次输入的密码不一致'));
                    },
                  }),
                ]}
              >
                <Input.Password />
              </Form.Item>
              <Button type="primary" onClick={() => message.success('密码修改成功')}>保存</Button>
            </Form>
          </TabPane>

          <TabPane tab={<span><NotificationOutlined /> 通知偏好</span>} key="notification">
            <Form form={notifyForm} layout="vertical" className="max-w-md">
              <Form.Item name="channels" initialValue={['email', 'wecom']}>
                <Checkbox.Group
                  options={[
                    { label: '邮件', value: 'email' },
                    { label: '企业微信', value: 'wecom' },
                    { label: '钉钉', value: 'dingtalk' },
                    { label: '飞书', value: 'lark' },
                  ]}
                />
              </Form.Item>
              <Button type="primary" onClick={() => message.success('通知偏好保存成功')}>保存</Button>
            </Form>
          </TabPane>
        </Tabs>
      </TsCard>
    </div>
  );
}
