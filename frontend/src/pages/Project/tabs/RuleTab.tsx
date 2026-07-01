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
  prefix: string;
  major: number;
  minor: number;
  patch: number;
  rcSuffix: string;
  betaSuffix: string;
  releaseCycle: number;
  formalBranch: string[];
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

  const versionRule = (project.version_rule as Record<string, unknown>) || {};
  const releaseRule = (project.release_rule as Record<string, unknown>) || {};
  const suffixes = (versionRule.suffixes as Record<string, string>) || {};

  const initialValues: RuleFormValues = {
    prefix: (versionRule.prefix as string) || 'VA',
    major: (versionRule.major as number) ?? 1,
    minor: (versionRule.minor as number) ?? 0,
    patch: (versionRule.patch as number) ?? 0,
    rcSuffix: suffixes.rc || 'rc',
    betaSuffix: suffixes.beta || 'beta',
    releaseCycle: (releaseRule.release_cycle_days as number) || 3,
    formalBranch: releaseRule.formal_branch
      ? String(releaseRule.formal_branch).split(',')
      : ['main', 'master'],
    complianceThreshold: (releaseRule.compliance_threshold as number) ?? 90,
  };

  const mutation = useMutation({
    mutationFn: (values: RuleFormValues) => {
      const payload = {
        version_rule: {
          prefix: values.prefix,
          major: values.major,
          minor: values.minor,
          patch: values.patch,
          suffixes: {
            rc: values.rcSuffix,
            beta: values.betaSuffix,
          },
        },
        release_rule: {
          release_cycle_days: values.releaseCycle,
          formal_branch: values.formalBranch.join(','),
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
      {/* 版本号规则 */}
      <div className="mb-6">
        <div className="mb-3 text-[13px] font-semibold text-slate-700">版本号规则</div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-5">
          <Form.Item name="prefix" label="版本前缀">
            <Input placeholder="VA" />
          </Form.Item>
          <div className="hidden" />

          <Form.Item name="major" label="主版本（初始值）">
            <InputNumber min={0} className="w-full" />
          </Form.Item>
          <Form.Item name="minor" label="次版本（初始值）">
            <InputNumber min={0} className="w-full" />
          </Form.Item>
          <Form.Item name="patch" label="修订号（初始值）">
            <InputNumber min={0} className="w-full" />
          </Form.Item>
          <div className="hidden" />

          <Form.Item name="rcSuffix" label="RC 后缀">
            <Input placeholder="rc" />
          </Form.Item>
          <Form.Item name="betaSuffix" label="Beta 后缀">
            <Input placeholder="beta" />
          </Form.Item>
        </div>
        <div className="mt-2 rounded-lg border border-indigo-50 bg-indigo-50/30 px-4 py-2.5 text-[12px] text-slate-500">
          格式预览：<span className="font-mono text-indigo-600">{form.getFieldValue('prefix') || 'VA'}.{form.getFieldValue('major') ?? 1}.{form.getFieldValue('minor') ?? 0}.{form.getFieldValue('patch') ?? 0}</span>
          <span className="mx-1 text-slate-300">|</span>
          RC: <span className="font-mono text-indigo-600">{form.getFieldValue('prefix') || 'VA'}.{form.getFieldValue('major') ?? 1}.{form.getFieldValue('minor') ?? 0}.{form.getFieldValue('patch') ?? 0}-{form.getFieldValue('rcSuffix') || 'rc'}</span>
          <span className="mx-1 text-slate-300">|</span>
          Beta: <span className="font-mono text-indigo-600">{form.getFieldValue('prefix') || 'VA'}.{form.getFieldValue('major') ?? 1}.{form.getFieldValue('minor') ?? 0}.{form.getFieldValue('patch') ?? 0}-{form.getFieldValue('betaSuffix') || 'beta'}</span>
        </div>
      </div>

      {/* 发布规则 */}
      <div className="mb-6 border-t border-slate-100 pt-5">
        <div className="mb-3 text-[13px] font-semibold text-slate-700">发布规则</div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-5">
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
