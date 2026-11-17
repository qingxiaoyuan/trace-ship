import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Empty, Form, Input, Modal, Pagination, Popconfirm, Spin, Tag } from 'antd';
import { softwareApi, type Software } from '@/api/software';
import { PermissionAlert } from '@/components/PermissionAlert';
import { useAuthStore } from '@/stores/authStore';
import type { Repository } from '@/types';
import { SoftwarePermissions } from './SoftwarePermissions';

interface SoftwareForm {
  name: string;
  slug: string;
  description: string;
}

type Dialog = { kind: 'register' } | { kind: 'edit' | 'permissions'; id: string };

export function SoftwareDirectory({ repository }: { repository?: Repository }) {
  const userId = useAuthStore((state) => state.user?.id);
  const [dialog, setDialog] = useState<Dialog>();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const repositoryId = repository?.id;
  const queryClient = useQueryClient();
  const listingKey = ['software-directory', userId, repositoryId, search, page] as const;
  const listing = useQuery({
    queryKey: listingKey,
    queryFn: () => softwareApi.list({ repository: repositoryId, search, page }),
  });
  const items = listing.data?.results ?? [];
  const current = dialog && 'id' in dialog ? items.find(({ id }) => id === dialog.id) : undefined;
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['software-directory'] }),
      queryClient.invalidateQueries({ queryKey: ['project-software'] }),
    ]);
  };
  const writing = useMutation({
    mutationFn: ({ values, editing }: { values: SoftwareForm; editing?: Software }) =>
      editing
        ? softwareApi.update(editing.id, { name: values.name, description: values.description })
        : softwareApi.register({ ...values, repository: repositoryId! }),
    onSuccess: async () => {
      setDialog(undefined);
      await refresh();
    },
  });
  const toggle = useMutation({
    mutationFn: (software: Software) => softwareApi.update(software.id, { is_active: !software.is_active }),
    onSuccess: refresh,
  });
  const saving = dialog?.kind === 'register' || (dialog?.kind === 'edit' && current?.can_maintain);

  function open(next: Dialog) {
    writing.reset();
    setDialog(next);
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input.Search
          aria-label="搜索软件"
          placeholder="搜索名称、标识或主仓库"
          allowClear
          className="w-full sm:w-72"
          onSearch={(value) => { setSearch(value.trim()); setPage(1); }}
        />
        {repository?.can_register_software && (
          <Button type="primary" className="min-h-9" onClick={() => open({ kind: 'register' })}>登记软件</Button>
        )}
      </div>
      <PermissionAlert error={listing.error} />
      <Spin spinning={listing.isPending}>
        {listing.isSuccess && items.length === 0 && <Empty description="暂无可见软件" />}
        {items.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {items.map((software) => (
              <li key={software.id} className="flex flex-col gap-3 py-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="m-0 break-all text-sm font-semibold text-slate-900">{software.name}</h2>
                    <Tag color={software.is_active ? 'green' : 'default'}>{software.is_active ? '启用' : '已停用'}</Tag>
                  </div>
                  <div className="break-all text-xs text-slate-600">
                    <code>{software.slug}</code> · {software.repository_name} · 负责人 {software.owner.nickname || software.owner.username}
                  </div>
                  {software.description && <p className="m-0 whitespace-pre-wrap break-all text-sm text-slate-600">{software.description}</p>}
                </div>
                {software.can_maintain && (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button className="min-h-9" onClick={() => open({ kind: 'edit', id: software.id })}>编辑</Button>
                    {software.can_manage && (
                      <>
                        <Button className="min-h-9" onClick={() => open({ kind: 'permissions', id: software.id })}>维护授权</Button>
                        <Popconfirm
                          title={software.is_active ? '停用软件' : '启用软件'}
                          description={software.is_active ? '将停止所有项目对该软件的新使用。' : undefined}
                          okText="确认"
                          cancelText="取消"
                          onConfirm={() => { toggle.mutate(software); }}
                        >
                          <Button className="min-h-9" danger={software.is_active} disabled={toggle.isPending}>
                            {software.is_active ? '停用' : '启用'}
                          </Button>
                        </Popconfirm>
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Spin>
      {listing.data && listing.data.total > listing.data.page_size && (
        <Pagination
          current={page}
          total={listing.data.total}
          pageSize={listing.data.page_size}
          showSizeChanger={false}
          onChange={setPage}
        />
      )}
      {saving && (
        <Modal
          title={current ? '编辑软件' : '登记软件'}
          open
          footer={null}
          onCancel={() => setDialog(undefined)}
        >
          <Form<SoftwareForm>
            layout="vertical"
            initialValues={current}
            onFinish={(values) => writing.mutate({ values, editing: current })}
          >
            <Form.Item name="name" label="软件名称" rules={[{ required: true, whitespace: true, message: '请输入软件名称' }]}>
              <Input maxLength={200} />
            </Form.Item>
            {current ? (
              <p className="mb-4 text-sm text-slate-600">软件标识 <code>{current.slug}</code></p>
            ) : (
              <Form.Item
                name="slug"
                label="软件标识"
                extra="登记后固定，用于区分同一主仓库的多个软件。"
                rules={[{ required: true, pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, message: '使用小写字母、数字或分隔短横线' }]}
              >
                <Input maxLength={80} />
              </Form.Item>
            )}
            <Form.Item name="description" label="说明">
              <Input.TextArea rows={3} />
            </Form.Item>
            <PermissionAlert error={writing.error} errorTitle="保存失败" className="mb-3" />
            <div className="flex justify-end gap-2">
              <Button className="min-h-9" onClick={() => setDialog(undefined)}>取消</Button>
              <Button type="primary" htmlType="submit" className="min-h-9" loading={writing.isPending}>
                {current ? '保存' : '登记'}
              </Button>
            </div>
          </Form>
        </Modal>
      )}
      {dialog?.kind === 'permissions' && current?.can_manage && (
        <SoftwarePermissions software={current} onClose={() => setDialog(undefined)} refresh={refresh} />
      )}
    </div>
  );
}
