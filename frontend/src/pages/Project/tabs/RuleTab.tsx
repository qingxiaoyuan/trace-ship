import { Form, Input, InputNumber, Select, Button } from 'antd';

import { projectRuleInitialValues } from '@/mock/projectDetail';

export function RuleTab() {
  const [form] = Form.useForm();

  return (
    <Form form={form} layout="vertical" initialValues={projectRuleInitialValues}>
      <div className="grid grid-cols-2 gap-x-8">
        <Form.Item name="versionRule" label="版本号规则">
          <Input placeholder="VA.{major}.{minor}.{patch}" />
        </Form.Item>

        <Form.Item name="releaseCycle" label="发布周期（天）">
          <InputNumber min={1} className="w-full" />
        </Form.Item>

        <Form.Item name="formalBranch" label="正式发布分支限制">
          <Select mode="tags" placeholder="输入分支名称" options={[{ label: 'main', value: 'main' }]} />
        </Form.Item>

        <Form.Item name="testPrefix" label="测试版本命名前缀">
          <Input placeholder="test" />
        </Form.Item>

        <Form.Item name="complianceThreshold" label="Commit 合规率阈值（%）">
          <InputNumber min={0} max={100} className="w-full" />
        </Form.Item>
      </div>

      <Form.Item className="!mb-0">
        <Button type="primary">保存规则</Button>
      </Form.Item>
    </Form>
  );
}
