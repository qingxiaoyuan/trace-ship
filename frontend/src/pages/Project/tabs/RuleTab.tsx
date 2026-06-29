import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Form, Input, InputNumber, Select, Button, App } from 'antd';
import { projectApi } from '@/api/project';
import type { Project } from '@/types';

interface PercentInputProps {
  value?: number;
  onChange?: (value: number | null) => void;
}

function PercentInput({ value, onChange }: PercentInputProps) {
  return (
    <div className="flex items-center">
      <InputNumber
        min={0}
        max={100}
        className="w-24 mr-2"
        value={value}
        onChange={onChange}
      />
      <span className="text-sm text-slate-500">%</span>
    </div>
  );
}

interface RuleTabProps {
  project: Project;
}

interface RuleFormValues {
  versionRule: string;
  releaseCycle: number;
  formalBranch: string[];
  rcPrefix: string;
  betaPrefix: string;
  complianceThreshold: number;
}

const versionRuleOptions = [
  { label: '主版本.次版本.修订号', value: '主版本.次版本.修订号' },
  { label: '年月日.修订号', value: '年月日.修订号' },
];

const releaseCycleOptions = [
  { label: '3 天一发', value: 3 },
  { label: '7 天一发', value: 7 },
  { label: '14 天一发', value: 14 },
  { label: '按需发布', value: 0 },
];

export function RuleTab({ project }: RuleTabProps) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const versionRule = (project.version_rule as Record<string, unknown>) || {};
  const releaseRule = (project.release_rule as Record<string, unknown>) || {};
  const tagPrefixes = (releaseRule.tag_prefixes as Record<string, string>) || {};

  const initialValues: RuleFormValues = {
    versionRule: (versionRule.format as string) || '主版本.次版本.修订号',
    releaseCycle: (releaseRule.release_cycle_days as number) || 3,
    formalBranch: releaseRule.formal_branch
      ? String(releaseRule.formal_branch).split(',')
      : ['main', 'master'],
    rcPrefix: tagPrefixes.rc || 'rc',
    betaPrefix: tagPrefixes.beta || 'beta',
    complianceThreshold: (releaseRule.compliance_threshold as number) ?? 90,
  };

  const mutation = useMutation({
    mutationFn: (values: RuleFormValues) => {
      const payload = {
        version_rule: {
          format: values.versionRule,
        },
        release_rule: {
          release_cycle_days: values.releaseCycle,
          formal_branch: values.formalBranch.join(','),
          tag_prefixes: {
            rc: values.rcPrefix,
            beta: values.betaPrefix,
          },
          compliance_threshold: values.complianceThreshold,
        },
      };
      return projectApi.patchProject(project.id, payload);
    },
    onSuccess: () => {
      message.success('保存成功');
      queryClient.invalidateQueries({ queryKey: ['project', project.id] });
    },
    onError: () => message.error('保存失败'),
  });

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={initialValues}
      onFinish={(values) => mutation.mutate(values as RuleFormValues)}
    >
      <div className="grid grid-cols-2 gap-x-8 gap-y-5">
        <Form.Item name="versionRule" label="版本号规则">
          <Select options={versionRuleOptions} />
        </Form.Item>

        <Form.Item name="releaseCycle" label="发布周期">
          <Select options={releaseCycleOptions} />
        </Form.Item>

        <Form.Item
          name="formalBranch"
          label="正式发布分支限制"
          className="col-span-2"
        >
          <Select
            mode="tags"
            placeholder="输入分支名称"
            options={[
              { label: 'master', value: 'master' },
              { label: 'main', value: 'main' },
            ]}
            tagRender={(props) => (
              <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 text-sm mr-2">
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

        <Form.Item name="rcPrefix" label="RC Tag 前缀">
          <Input placeholder="rc" />
        </Form.Item>

        <Form.Item name="betaPrefix" label="Beta Tag 前缀">
          <Input placeholder="beta" />
        </Form.Item>

        <Form.Item name="complianceThreshold" label="Commit 合规率阈值（%）">
          <PercentInput />
        </Form.Item>
      </div>

      <div className="mt-6 flex justify-end">
        <Button
          type="primary"
          htmlType="submit"
          loading={mutation.isPending}
        >
          保存规则
        </Button>
      </div>
    </Form>
  );
}
