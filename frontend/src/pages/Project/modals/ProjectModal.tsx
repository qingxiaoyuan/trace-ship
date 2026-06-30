import { useEffect, useState } from 'react';
import { Form, Input, Select, Radio, Button } from 'antd';
import { TsModal } from '@/components/TsModal';
import { FormSection } from '@/components/FormSection';
import { accountApi, type AccountUser } from '@/api/account';
import type { Project } from '@/types';

interface ProjectModalProps {
  open: boolean;
  project: Project | null;
  onCancel: () => void;
  onOk: (values: Partial<Project>) => void;
}

export function ProjectModal({ open, project, onCancel, onOk }: ProjectModalProps) {
  const [form] = Form.useForm();
  const [users, setUsers] = useState<AccountUser[]>([]);

  useEffect(() => {
    if (open) {
      accountApi.getUsers({ page_size: 1000 }).then((res) => {
        setUsers(res.results || []);
      });
    }
  }, [open]);

  const handleCancel = () => {
    form.resetFields();
    onCancel();
  };

  const handleOk = () => {
    form.validateFields().then((values) => {
      onOk({ ...project, ...values });
      form.resetFields();
    });
  };

  return (
    <TsModal
      title={project ? '编辑项目' : '新增项目'}
      open={open}
      onCancel={handleCancel}
      footerStyle={{ background: 'transparent' }}
      footer={
        <div className="flex items-center justify-end gap-3">
          <Button
            type="text"
            className="h-auto rounded-lg px-4 py-2 text-[13px] font-medium text-slate-700 transition hover:text-indigo-600"
            onClick={handleCancel}
          >
            取消
          </Button>
          <Button
            type="primary"
            className="h-auto rounded-lg px-4 py-2 text-[13px] font-medium"
            onClick={handleOk}
          >
            确认
          </Button>
        </div>
      }
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
        <FormSection title="基本信息">
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
            <Select
              placeholder="请选择项目负责人"
              options={users.map((u) => ({ label: u.nickname || u.username, value: u.id }))}
            />
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
        </FormSection>
      </Form>
    </TsModal>
  );
}
