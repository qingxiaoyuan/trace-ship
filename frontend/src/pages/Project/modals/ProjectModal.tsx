import { Form, Input, Select, Radio } from 'antd';
import { TsModal } from '@/components/TsModal';
import type { Project } from '@/types';

interface ProjectModalProps {
  open: boolean;
  project: Project | null;
  onCancel: () => void;
  onOk: (values: Partial<Project>) => void;
}

export function ProjectModal({ open, project, onCancel, onOk }: ProjectModalProps) {
  const [form] = Form.useForm();

  return (
    <TsModal
      title={project ? '编辑项目' : '新增项目'}
      open={open}
      onCancel={() => {
        form.resetFields();
        onCancel();
      }}
      onOk={() => {
        form.validateFields().then((values) => {
          onOk({ ...project, ...values });
          form.resetFields();
        });
      }}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={
          project || {
            status: 'active',
          }
        }
      >
        <Form.Item
          name="code"
          label="项目编码"
          rules={[{ required: true, message: '请输入项目编码' }]}
        >
          <Input placeholder="如：CORE_TRADE" />
        </Form.Item>

        <Form.Item
          name="name"
          label="项目名称"
          rules={[{ required: true, message: '请输入项目名称' }]}
        >
          <Input placeholder="请输入项目名称" />
        </Form.Item>

        <Form.Item
          name="leader_id"
          label="项目负责人"
          rules={[{ required: true, message: '请选择项目负责人' }]}
        >
          <Select placeholder="请选择项目负责人" options={[{ label: '张三', value: 'u1' }]} />
        </Form.Item>

        <Form.Item name="description" label="项目描述">
          <Input.TextArea rows={3} placeholder="请输入项目描述" />
        </Form.Item>

        <Form.Item name="status" label="状态">
          <Radio.Group>
            <Radio value="active">启用</Radio>
            <Radio value="inactive">停用</Radio>
          </Radio.Group>
        </Form.Item>
      </Form>
    </TsModal>
  );
}
