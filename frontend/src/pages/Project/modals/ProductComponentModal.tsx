import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Form, Input, Select, Switch } from 'antd';
import { Boxes, GitBranch, Folder } from 'lucide-react';
import { projectApi } from '@/api/project';
import { TsModal } from '@/components/TsModal';
import type { ProductComponent, Repository } from '@/types';

interface ProductComponentModalProps {
  open: boolean;
  projectId: string;
  component: ProductComponent | null;
  submitting?: boolean;
  onCancel: () => void;
  onOk: (values: Partial<ProductComponent>) => void;
}

/** 维护“产品如何使用仓库”的配置，不编辑仓库地址或凭证。 */
export function ProductComponentModal({
  open,
  projectId,
  component,
  submitting,
  onCancel,
  onOk,
}: ProductComponentModalProps) {
  const [form] = Form.useForm();

  const { data: availableRepositories, isLoading } = useQuery({
    queryKey: ['available-product-repositories', projectId],
    queryFn: () => projectApi.getAvailableRepositories(projectId),
    enabled: open && !component,
  });
  const { data: linkedRepositories, isLoading: linkedRepositoriesLoading } = useQuery({
    queryKey: ['product-components', projectId],
    queryFn: () => projectApi.getComponents(projectId),
    enabled: open && !component,
  });

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (component) {
      form.setFieldsValue({
        repository: component.repository,
        default_branch: component.default_branch,
        source_subdir: component.source_subdir,
        is_active: component.is_active,
      });
    } else {
      form.setFieldsValue({
        is_active: true,
      });
    }
  }, [component, form, open]);

  const handleRepositoryChange = (repositoryId: string) => {
    const repository = availableRepositories?.find((item) => item.id === repositoryId);
    if (!repository) return;
    form.setFieldsValue({
      default_branch: form.getFieldValue('default_branch') || repository.default_branch,
    });
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    if (component) {
      delete values.repository;
    }
    onOk(values);
  };

  const linkedRepositoryIds = new Set((linkedRepositories || []).map((item) => item.repository));
  const repositoryOptions: { value: string; label: string; disabled: boolean }[] =
    (linkedRepositories && availableRepositories
      ?.filter((repository) => !linkedRepositoryIds.has(repository.id))
      .map((repository: Repository) => ({
        value: repository.id,
        label: repository.owner_in_product === false
          ? `${repository.name}（请先将所有者${repository.owner_name ? `「${repository.owner_name}」` : ''}加入产品成员）`
          : repository.name,
        disabled: repository.owner_in_product === false,
      }))
    ) || [];

  const selectOptions: { value: string; label: string; disabled: boolean }[] = component
    ? [{ value: component.repository, label: component.repository_detail.name, disabled: true }]
    : repositoryOptions;

  return (
    <TsModal
      title={component ? '编辑仓库设置' : '关联已有仓库'}
      subtitle={component ? '调整该仓库在当前产品内的使用配置' : '将可复用的物理仓库组合进当前产品'}
      titleIcon={<Boxes className="h-[18px] w-[18px]" strokeWidth={1.5} />}
      open={open}
      onCancel={onCancel}
      width={640}
      footer={
        <div className="flex items-center justify-end gap-3">
          <Button
            type="text"
            className="h-auto rounded-lg px-4 py-2 text-[13px] font-medium text-slate-500 transition hover:text-slate-700"
            onClick={onCancel}
          >
            取消
          </Button>
          <Button
            type="primary"
            className="h-auto rounded-lg px-4 py-2 text-[13px] font-medium"
            loading={submitting}
            onClick={handleSubmit}
          >
            {component ? '保存配置' : '确认关联'}
          </Button>
        </div>
      }
    >
      <Form form={form} layout="vertical">
        {/* 仓库信息 */}
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          仓库信息
        </p>
        <p className="mb-3 text-[12px] leading-5 text-slate-400">
          版本属于仓库本身，多个产品可以发布同一个仓库的版本；关联前必须先把仓库所有者加入当前产品成员，该仓库的个人凭证才会授权给本产品使用。
        </p>
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
          <Form.Item
            name="repository"
            label="软件仓库"
            className="mb-0"
            rules={[{ required: true, message: '请选择仓库' }]}
          >
            <Select
              showSearch
              disabled={!!component}
              loading={isLoading || linkedRepositoriesLoading}
              options={selectOptions}
              optionFilterProp="label"
              placeholder="选择仓库"
              onChange={handleRepositoryChange}
              notFoundContent={isLoading || linkedRepositoriesLoading ? '加载中…' : '没有可关联的仓库'}
            />
          </Form.Item>
          <Form.Item name="default_branch" label="默认分支" className="mb-0">
            <Input
              prefix={<GitBranch className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />}
              placeholder="默认使用仓库默认分支"
            />
          </Form.Item>
        </div>

        <div className="my-5 h-px bg-[#EDEFF7]" />

        {/* 当前产品设置 */}
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          当前产品设置
        </p>
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
          <Form.Item name="source_subdir" label="源码子目录" className="mb-0">
            <Input
              prefix={<Folder className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />}
              placeholder="留空表示仓库根目录"
              className="font-mono-ui"
            />
          </Form.Item>
          <div className="flex items-center justify-between rounded-lg bg-[#FAFBFE] px-3.5 py-2 ring-1 ring-[#EDEFF7]">
            <div>
              <p className="text-[13px] font-medium text-slate-700">启用关联</p>
              <p className="text-[11px] text-slate-400">停用后当前产品不可再用该仓库发布与打包</p>
            </div>
            <Form.Item name="is_active" valuePropName="checked" className="mb-0" noStyle>
              <Switch />
            </Form.Item>
          </div>
        </div>
      </Form>
    </TsModal>
  );
}
