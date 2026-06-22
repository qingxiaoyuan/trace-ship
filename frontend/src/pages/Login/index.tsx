import { useState } from 'react';
import { Form, Input, Button, Checkbox, Typography, message } from 'antd';
import {
  ThunderboltOutlined,
  EyeInvisibleOutlined,
  EyeTwoTone,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

const { Text, Link } = Typography;

type LoginTab = 'domain' | 'local';

export default function Login() {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<LoginTab>('domain');
  const [form] = Form.useForm();

  const handleLogin = async (values: { username: string; password: string; remember?: boolean }) => {
    setLoading(true);
    try {
      await login(values.username, values.password);
      message.success('登录成功');
      navigate('/');
    } catch (err: any) {
      message.error(err?.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const tabs: { key: LoginTab; label: string }[] = [
    { key: 'domain', label: '域账号登录' },
    { key: 'local', label: '本地账号' },
  ];

  return (
    <div
      className="w-full max-w-md p-8 rounded-2xl"
      style={{
        background: 'rgba(255, 255, 255, 0.92)',
        backdropFilter: 'blur(16px) saturate(180%)',
        WebkitBackdropFilter: 'blur(16px) saturate(180%)',
        border: '1px solid rgba(255, 255, 255, 0.6)',
        boxShadow: '0 12px 24px -6px rgba(15, 23, 42, 0.08), 0 6px 12px -4px rgba(15, 23, 42, 0.05)',
      }}
    >
      {/* 品牌区 */}
      <div className="flex flex-col items-center mb-8">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center text-white mb-5"
          style={{
            background: 'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)',
            boxShadow:
              '0 0 0 4px rgba(255, 255, 255, 0.5), 0 10px 15px -3px rgba(59, 130, 246, 0.25)',
          }}
        >
          <ThunderboltOutlined style={{ fontSize: 36 }} />
        </div>

        <div className="text-2xl font-bold text-slate-900">TraceShip</div>
        <div className="text-sm text-slate-500 mt-1.5 text-center">
          软件版本发布管理与提交规范审查系统
        </div>

        <div
          className="inline-flex items-center mt-4 px-2.5 py-1 rounded-full text-xs font-medium text-slate-500"
          style={{
            background: 'rgba(241, 245, 249, 0.8)',
            border: '1px solid rgba(226, 232, 240, 0.6)',
          }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mr-2"
          />
          v2.4.0
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex border-b border-slate-200 mb-6">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className="flex-1 pb-3 text-sm transition-colors outline-none"
              style={{
                fontWeight: isActive ? 600 : 500,
                color: isActive ? '#2563EB' : '#64748B',
                borderBottom: `2px solid ${isActive ? '#2563EB' : 'transparent'}`,
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 登录表单 */}
      <Form
        form={form}
        layout="vertical"
        initialValues={{ username: 'zhangsan', remember: true }}
        onFinish={handleLogin}
      >
        <Form.Item
          name="username"
          label={<span className="text-sm font-medium text-slate-700">用户名</span>}
          rules={[{ required: true, message: '请输入用户名' }]}
          className="!mb-4"
        >
          <Input
            placeholder={activeTab === 'domain' ? '请输入域账号/用户名' : '请输入本地账号'}
            style={{
              height: 40,
              borderRadius: 12,
              borderColor: '#E2E8F0',
              fontSize: 14,
            }}
          />
        </Form.Item>

        <Form.Item
          name="password"
          label={<span className="text-sm font-medium text-slate-700">密码</span>}
          rules={[{ required: true, message: '请输入密码' }]}
          className="!mb-4"
        >
          <Input.Password
            placeholder="请输入密码"
            iconRender={(visible) => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
            style={{
              height: 40,
              borderRadius: 12,
              borderColor: '#E2E8F0',
              fontSize: 14,
            }}
          />
        </Form.Item>

        <div className="flex items-center justify-between text-sm mb-6">
          <Form.Item name="remember" valuePropName="checked" className="!mb-0">
            <Checkbox className="text-slate-600">记住我</Checkbox>
          </Form.Item>
          <Link className="text-sm font-medium" style={{ color: '#2563EB' }}>忘记密码？</Link>
        </div>

        <Button
          type="primary"
          htmlType="submit"
          block
          loading={loading}
          className="login-btn"
          style={{
            height: 44,
            borderRadius: 12,
            fontSize: 16,
            fontWeight: 600,
            color: '#fff',
            border: 'none',
            background: 'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)',
            boxShadow: '0 1px 2px rgba(37, 99, 235, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.15)',
          }}
        >
          登 录
        </Button>
      </Form>

      <div className="mt-6 text-center">
        <Text className="text-xs text-slate-400">
          首次登录将自动同步 LDAP 用户信息
        </Text>
      </div>
    </div>
  );
}
