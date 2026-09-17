import { useEffect, useState } from 'react';
import { Form, Input, Select, Radio } from 'antd';
import { Package } from 'lucide-react';
import { TsModal } from '@/components/TsModal';
import { accountApi, type AccountUser } from '@/api/account';
import { useAuthStore } from '@/stores/authStore';
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
  const currentUser = useAuthStore((s) => s.user);

  useEffect(() => {
    if (open) {
      accountApi.getUsers({ page_size: 1000 }).then((res) => {
        setUsers(res.results || []);
      });
      // 新增时项目负责人默认选中当前登录用户，可手动改选
      if (!project && currentUser) {
        form.setFieldsValue({ leader_id: currentUser.id });
      }
    }
  }, [open, project, currentUser, form]);

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
      subtitle={project ? '修改项目的基本信息' : '创建项目以组合仓库、组织发布与打包'}
      titleIcon={<Package className="h-[18px] w-[18px]" strokeWidth={1.5} />}
      open={open}
      onCancel={handleCancel}
      onOk={handleOk}
      okText="确认"
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={
          project || { status: 'active' }
        }
      >
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          基本信息
        </p>

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
            showSearch
            placeholder="请选择项目负责人"
            options={users.map((u) => ({ label: u.nickname || u.username, value: u.id }))}
            filterOption={(input, option) =>
              String(option?.label ?? '')
                .toLowerCase()
                .includes(input.toLowerCase())
            }
          />
        </Form.Item>

        <Form.Item name="description" label="项目描述">
          <Input.TextArea rows={3} placeholder="请输入项目描述" />
        </Form.Item>

        <Form.Item name="status" label="状态" className="mb-0">
          <Radio.Group>
            <Radio value="active">启用</Radio>
            <Radio value="inactive">停用</Radio>
          </Radio.Group>
        </Form.Item>
      </Form>
    </TsModal>
  );
}
