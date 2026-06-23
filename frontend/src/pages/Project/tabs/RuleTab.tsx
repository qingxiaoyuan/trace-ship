import { Form, Input, InputNumber, Select, Button } from 'antd';
import type { Project } from '@/types';

interface PercentInputProps {
  value?: number;
  onChange?: (value: number | null) => void;
}

function PercentInput({ value, onChange }: PercentInputProps) {
  return (
    <div className="flex items-center">
      <InputNumber min={0} max={100} className="w-24 mr-2" value={value} onChange={onChange} />
      <span className="text-sm text-slate-500">%</span>
    </div>
  );
}

interface RuleTabProps {
  project: Project;
}

export function RuleTab({ project }: RuleTabProps) {
  const [form] = Form.useForm();
  const initialValues = {
    versionRule: project.version_rule || '主版本.次版本.修订号',
    releaseCycle: project.release_cycle || '正式版本 3 天一发',
    formalBranch: project.formal_branch ? project.formal_branch.split(',') : ['main'],
    testPrefix: project.test_prefix || '-test',
    complianceThreshold: project.compliance_threshold ?? 90,
  };

  return (
    <Form form={form} layout="vertical" initialValues={initialValues}>
      <div className="grid grid-cols-2 gap-x-8 gap-y-5">
        <Form.Item name="versionRule" label="版本号规则">
          <Select
            options={[
              { label: '主版本.次版本.修订号', value: '主版本.次版本.修订号' },
              { label: '年月日.修订号', value: '年月日.修订号' },
            ]}
          />
        </Form.Item>

        <Form.Item name="releaseCycle" label="发布周期">
          <Select
            options={[
              { label: '正式版本 3 天一发', value: '正式版本 3 天一发' },
              { label: '正式版本 7 天一发', value: '正式版本 7 天一发' },
              { label: '按需发布', value: '按需发布' },
            ]}
          />
        </Form.Item>

        <Form.Item name="formalBranch" label="正式发布分支限制" className="col-span-2">
          <Select
            mode="tags"
            placeholder="输入分支名称"
            options={[{ label: 'master', value: 'master' }, { label: 'main', value: 'main' }]}
            tagRender={(props) => (
              <span
                className="inline-flex items-center px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 text-sm mr-2"
              >
                {props.label}
                <span
                  className="ml-1.5 cursor-pointer text-blue-400 hover:text-blue-600"
                  onClick={props.onClose}
                >
                  ×
                </span>
              </span>
            )}
          />
        </Form.Item>

        <Form.Item name="testPrefix" label="测试版本命名前缀">
          <Input placeholder="-test" />
        </Form.Item>

        <Form.Item name="complianceThreshold" label="Commit 合规率阈值（%）">
          <PercentInput />
        </Form.Item>
      </div>

      <div className="mt-6 flex justify-end">
        <Button type="primary">保存规则</Button>
      </div>
    </Form>
  );
}
