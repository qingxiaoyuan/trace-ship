import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Form, Input, InputNumber, Button, Switch, App } from 'antd';
import { repositoryApi } from '@/api/repository';
import type { Repository, VersionRule } from '@/types';

interface VersionRuleTabProps {
  repo: Repository;
}

interface VersionRuleFormValues {
  prefix: string;
  major: number;
  minor: number;
  patch: number;
  rcSuffix: string;
  betaSuffix: string;
  withDate: boolean;
}

export function VersionRuleTab({ repo }: VersionRuleTabProps) {
  const [form] = Form.useForm<VersionRuleFormValues>();
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const versionRule = (repo.version_rule as VersionRule) || {};
  const suffixes = versionRule.suffixes || {};

  const initialValues: VersionRuleFormValues = {
    prefix: versionRule.prefix || 'VA',
    major: versionRule.major ?? 1,
    minor: versionRule.minor ?? 0,
    patch: versionRule.patch ?? 0,
    rcSuffix: suffixes.rc || 'rc',
    betaSuffix: suffixes.beta || 'beta',
    withDate: versionRule.with_date ?? true,
  };

  // 实时预览用
  const prefix = Form.useWatch('prefix', form) ?? initialValues.prefix;
  const major = Form.useWatch('major', form) ?? initialValues.major;
  const minor = Form.useWatch('minor', form) ?? initialValues.minor;
  const patch = Form.useWatch('patch', form) ?? initialValues.patch;
  const rcSuffix = Form.useWatch('rcSuffix', form) ?? initialValues.rcSuffix;
  const betaSuffix = Form.useWatch('betaSuffix', form) ?? initialValues.betaSuffix;
  const withDate = Form.useWatch('withDate', form) ?? initialValues.withDate;

  const today = new Date();
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const dateSuffix = withDate ? `_${dateStr}` : '';

  const mutation = useMutation({
    mutationFn: (values: VersionRuleFormValues) => {
      const version_rule: VersionRule = {
        prefix: values.prefix,
        major: values.major,
        minor: values.minor,
        patch: values.patch,
        suffixes: {
          rc: values.rcSuffix,
          beta: values.betaSuffix,
        },
        with_date: values.withDate,
      };
      return repositoryApi.updateRepository(repo.id, { version_rule });
    },
    onSuccess: () => {
      message.success('保存成功');
      queryClient.invalidateQueries({ queryKey: ['repository', repo.id] });
    },
  });

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={initialValues}
      onFinish={(values) => mutation.mutate(values)}
      className="max-w-3xl"
    >
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

      <Form.Item name="withDate" label="携带时间" valuePropName="checked">
        <Switch checkedChildren="是" unCheckedChildren="否" />
      </Form.Item>
      <div className="-mt-3 mb-2 text-[12px] text-slate-400">
        开启后生成的 tag 末尾追加 <span className="font-mono">_YYYYMMDD</span> 日期段，关闭则不携带日期
      </div>

      <div className="mt-2 rounded-lg border border-indigo-50 bg-indigo-50/30 px-4 py-2.5 text-[12px] text-slate-500">
        格式预览：<span className="font-mono text-indigo-600">{prefix || 'VA'}.{major}.{minor}.{patch}{dateSuffix}</span>
        <span className="mx-1 text-slate-300">|</span>
        RC: <span className="font-mono text-indigo-600">{prefix || 'VA'}.{major}.{minor}.{patch}-{rcSuffix || 'rc'}{dateSuffix}</span>
        <span className="mx-1 text-slate-300">|</span>
        Beta: <span className="font-mono text-indigo-600">{prefix || 'VA'}.{major}.{minor}.{patch}-{betaSuffix || 'beta'}{dateSuffix}</span>
      </div>

      <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50/50 px-4 py-2.5 text-[12px] text-slate-500">
        推荐版本号时会扫描仓库远端全部 tag（包括系统接入前已存在的历史 tag，如
        <span className="mx-1 font-mono text-slate-600">VB.4.1.5_20250715</span>），
        只要符合上述规则即参与版本递增；未配置时沿用项目级版本规则。
      </div>

      <div className="mt-6 flex justify-end">
        <Button type="primary" htmlType="submit" loading={mutation.isPending}>
          保存规则
        </Button>
      </div>
    </Form>
  );
}
