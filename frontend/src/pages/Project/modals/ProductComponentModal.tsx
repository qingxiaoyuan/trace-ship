import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Col, Form, Input, Row, Select, Switch } from 'antd';
import { projectApi } from '@/api/project';
import { FormSection } from '@/components/FormSection';
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
  const repositoryOptions = (linkedRepositories && availableRepositories
    ?.filter((repository) => !linkedRepositoryIds.has(repository.id))
    .map((repository: Repository) => ({
      value: repository.id,
      label: repository.owner_in_product === false
        ? `${repository.name}（请先将所有者${repository.owner_name ? `「${repository.owner_name}」` : ''}加入产品成员）`
        : repository.name,
      disabled: repository.owner_in_product === false,
    }))
  ) || [];

  return (
    <TsModal
      title={component ? '编辑仓库设置' : '关联已有仓库'}
      open={open}
      onCancel={onCancel}
      width={720}
      footer={
        <div className="flex justify-end gap-3">
          <Button type="text" onClick={onCancel}>取消</Button>
          <Button type="primary" loading={submitting} onClick={handleSubmit}>
            {component ? '保存配置' : '确认关联'}
          </Button>
        </div>
      }
    >
      <Form form={form} layout="vertical">
        <FormSection title="仓库信息">
          <p className="mb-3 text-[12px] leading-5 text-slate-500">
            版本属于仓库本身。多个产品可以发布同一个仓库的版本；关联前必须先把仓库所有者加入当前产品成员，该仓库的个人凭证才会授权给本产品使用。
          </p>
          <Row gutter={[20, 16]}>
            <Col xs={24} md={12}>
              <Form.Item
                name="repository"
                label="软件仓库"
                rules={[{ required: true, message: '请选择仓库' }]}
              >
                <Select
                  showSearch
                  disabled={!!component}
                  loading={isLoading || linkedRepositoriesLoading}
                  options={component ? [{ value: component.repository, label: component.repository_detail.name }] : repositoryOptions}
                  optionFilterProp="label"
                  placeholder="选择仓库"
                  onChange={handleRepositoryChange}
                  notFoundContent={isLoading || linkedRepositoriesLoading ? '加载中…' : '没有可关联的仓库'}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="default_branch" label="默认分支">
                <Input placeholder="默认使用仓库默认分支" />
              </Form.Item>
            </Col>
          </Row>
        </FormSection>

        <FormSection title="当前产品设置">
          <Row gutter={[20, 16]}>
            <Col xs={24} md={12}>
              <Form.Item name="source_subdir" label="源码子目录">
                <Input placeholder="留空表示仓库根目录" />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="is_active" label="启用关联" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
        </FormSection>
      </Form>
    </TsModal>
  );
}
