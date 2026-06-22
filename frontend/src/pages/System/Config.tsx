import { useState } from 'react';
import { Form, Input, InputNumber, Checkbox, Button, Select } from 'antd';
import { TsCard } from '@/components/TsCard';
import { SystemSubLayout } from '@/layouts/SystemSubLayout';
import { systemConfigCategories } from '@/mock/system';

const { TextArea } = Input;

export default function SystemConfig() {
  const [activeCategory, setActiveCategory] = useState('ldap');
  const [form] = Form.useForm();

  const renderForm = () => {
    switch (activeCategory) {
      case 'ldap':
        return (
          <Form form={form} layout="vertical" className="max-w-2xl">
            <Form.Item name="server" label="服务器地址">
              <Input placeholder="ldap://example.com" />
            </Form.Item>
            <Form.Item name="bind_dn" label="Bind DN">
              <Input />
            </Form.Item>
            <Form.Item name="bind_password" label="Bind 密码">
              <Input.Password />
            </Form.Item>
            <Form.Item name="user_ou" label="用户搜索 OU">
              <Input />
            </Form.Item>
          </Form>
        );
      case 'jenkins':
        return (
          <Form form={form} layout="vertical" className="max-w-2xl">
            <Form.Item name="server" label="默认地址">
              <Input placeholder="https://jenkins.example.com" />
            </Form.Item>
            <Form.Item name="timeout" label="默认超时时间（秒）">
              <InputNumber min={1} className="w-full" />
            </Form.Item>
            <Form.Item name="concurrent" label="并发构建数">
              <InputNumber min={1} className="w-full" />
            </Form.Item>
          </Form>
        );
      case 'ai':
        return (
          <Form form={form} layout="vertical" className="max-w-2xl">
            <Form.Item name="provider" label="Provider">
              <Select options={[{ label: 'Anthropic', value: 'anthropic' }, { label: 'OpenAI', value: 'openai' }]} />
            </Form.Item>
            <Form.Item name="model" label="默认模型">
              <Input placeholder="claude-3-sonnet" />
            </Form.Item>
            <Form.Item name="base_url" label="Base URL">
              <Input />
            </Form.Item>
            <Form.Item name="api_key" label="API Key">
              <Input.Password />
            </Form.Item>
          </Form>
        );
      case 'security':
        return (
          <Form form={form} layout="vertical" className="max-w-2xl">
            <Form.Item name="token_expire" label="Token 过期时间（秒）">
              <InputNumber min={60} className="w-full" />
            </Form.Item>
            <Form.Item name="password_min_length" label="密码最小长度">
              <InputNumber min={6} className="w-full" />
            </Form.Item>
            <Form.Item name="complexity" valuePropName="checked">
              <Checkbox>强制密码复杂度</Checkbox>
            </Form.Item>
          </Form>
        );
      case 'template':
        return (
          <Form form={form} layout="vertical" className="max-w-2xl">
            <Form.Item name="announcement" label="系统公告">
              <TextArea rows={4} />
            </Form.Item>
            <Form.Item name="release_template" label="发布通知模板">
              <TextArea rows={6} placeholder="支持 Markdown 变量：{{version}}, {{project}}" />
            </Form.Item>
          </Form>
        );
      default:
        return <div className="text-slate-400">该分类配置项开发中...</div>;
    }
  };

  return (
    <SystemSubLayout
      title="系统配置"
      activeKey={activeCategory}
      onChange={setActiveCategory}
      items={systemConfigCategories}
    >
      <TsCard
        title={systemConfigCategories.find((c) => c.key === activeCategory)?.label}
        extra={<Button type="primary">保存配置</Button>}
      >
        {renderForm()}
      </TsCard>
    </SystemSubLayout>
  );
}
