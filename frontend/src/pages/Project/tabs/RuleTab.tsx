import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Form, InputNumber, Select, Button, App } from 'antd';
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
  releaseCycle: number;
  complianceThreshold: number;
}

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

  const releaseRule = (project.release_rule as Record<string, unknown>) || {};

  const initialValues: RuleFormValues = {
    releaseCycle: (releaseRule.release_cycle_days as number) || 3,
    complianceThreshold: (releaseRule.compliance_threshold as number) ?? 90,
  };

  const mutation = useMutation({
    mutationFn: (values: RuleFormValues) => {
      const payload = {
        release_rule: {
          release_cycle_days: values.releaseCycle,
          compliance_threshold: values.complianceThreshold,
        },
      };
      return projectApi.patchProject(project.id, payload);
    },
    onSuccess: () => {
      message.success('保存成功');
      queryClient.invalidateQueries({ queryKey: ['project', project.id] });
    },
  });

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={initialValues}
      onFinish={(values) => mutation.mutate(values as RuleFormValues)}
    >
      {/* 版本号规则已迁移到仓库 */}
      <div className="mb-6 rounded-lg border border-indigo-50 bg-indigo-50/30 px-4 py-2.5 text-[12px] text-slate-500">
        版本号规则（前缀 / 初始版本 / 后缀）跟着仓库走，请到
        <span className="mx-1 font-medium text-indigo-600">仓库详情 → 版本规则</span>
        标签页配置；推荐版本号时会扫描仓库远端全部 tag（含系统接入前的历史 tag）参与递增。
      </div>

      {/* 发布规则 */}
      <div className="mb-6">
        <div className="mb-3 text-[13px] font-semibold text-slate-700">发布规则</div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-5">
          <Form.Item name="releaseCycle" label="发布周期">
            <Select options={releaseCycleOptions} />
          </Form.Item>

          <Form.Item name="complianceThreshold" label="Commit 合规率阈值（%）">
            <PercentInput />
          </Form.Item>
        </div>
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
