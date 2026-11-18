import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, Modal, Pagination, Popconfirm } from 'antd';
import { CirclePause, CirclePlay, Package, Pencil, Plus, Search } from 'lucide-react';
import { softwareApi, type Software } from '@/api/software';
import { PermissionAlert } from '@/components/PermissionAlert';
import { useAuthStore } from '@/stores/authStore';
import type { Repository } from '@/types';

interface SoftwareForm {
  name: string;
  slug: string;
  description: string;
}

type Dialog = { kind: 'register' } | { kind: 'edit'; software: Software };

function SoftwareStatus({ active }: { active: boolean }) {
  return (
    <span className={`shrink-0 whitespace-nowrap text-[12px] ${active ? 'text-emerald-700' : 'text-slate-500'}`}>
      {active ? '启用' : '已停用'}
    </span>
  );
}

export function SoftwareDirectory({ repository }: { repository: Repository }) {
  const userId = useAuthStore((state) => state.user?.id);
  const [dialog, setDialog] = useState<Dialog>();
  const [keyword, setKeyword] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const repositoryId = repository.id;
  const queryClient = useQueryClient();
  const listingKey = ['software-directory', userId, repositoryId, search, page] as const;
  const listing = useQuery({
    queryKey: listingKey,
    queryFn: () => softwareApi.list({ repository: repositoryId, search, page }),
  });
  const items = listing.data?.results ?? [];
  const current = dialog?.kind === 'edit' ? dialog.software : undefined;

  useEffect(() => {
    const value = keyword.trim();
    if (value === search) return;
    const timer = window.setTimeout(() => {
      setSearch(value);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [keyword, search]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['software-directory'] }),
      queryClient.invalidateQueries({ queryKey: ['project-software'] }),
      queryClient.invalidateQueries({ queryKey: ['project-software-release'] }),
      queryClient.invalidateQueries({ queryKey: ['package-configs-auto'] }),
      queryClient.invalidateQueries({ queryKey: ['project'] }),
    ]);
  };
  const writing = useMutation({
    mutationFn: ({ values, editing }: { values: SoftwareForm; editing?: Software }) =>
      editing
        ? softwareApi.update(editing.id, { name: values.name, description: values.description })
        : softwareApi.register({ ...values, repository: repositoryId }),
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

  const renderActions = (software: Software) => {
    if (!software.can_maintain) return null;
    const stateAction = software.is_active ? '停用' : '启用';
    const StateIcon = software.is_active ? CirclePause : CirclePlay;
    return (
      <div className="flex justify-end gap-1">
        <button
          type="button"
          title="编辑软件"
          aria-label="编辑"
          onClick={() => open({ kind: 'edit', software })}
          className="rounded-md p-2 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 max-md:min-h-9 max-md:px-3 max-md:text-[12px] max-md:text-slate-600"
        >
          <Pencil className="hidden h-3.5 w-3.5 md:block" aria-hidden />
          <span className="md:hidden">编辑</span>
        </button>
        <Popconfirm
          title={`${stateAction}软件`}
          description={software.is_active ? '停用后，项目不能发起该软件的新发布或打包。' : undefined}
          okText="确认"
          cancelText="取消"
          onConfirm={() => toggle.mutateAsync(software)}
        >
          <button
            type="button"
            title={`${stateAction}软件`}
            aria-label={stateAction}
            disabled={toggle.isPending}
            className={`rounded-md p-2 text-slate-400 disabled:opacity-50 max-md:min-h-9 max-md:px-3 max-md:text-[12px] ${software.is_active ? 'hover:bg-rose-50 hover:text-rose-600 max-md:text-rose-600' : 'hover:bg-indigo-50 hover:text-indigo-600 max-md:text-indigo-600'}`}
          >
            <StateIcon className="hidden h-3.5 w-3.5 md:block" aria-hidden />
            <span className="md:hidden">{stateAction}</span>
          </button>
        </Popconfirm>
      </div>
    );
  };

  const listStatus = listing.isPending ? (
    <div className="px-5 py-12 text-center text-[13px] text-slate-400">加载中…</div>
  ) : listing.isSuccess && items.length === 0 ? (
    <div className="flex flex-col items-center px-5 py-12 text-[13px] text-slate-400">
      <Package className="mb-2 h-8 w-8 text-slate-300" aria-hidden />
      {search ? '没有匹配的软件' : '暂无软件'}
    </div>
  ) : null;

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">软件</h2>
        {repository.can_register_software && (
          <button
            type="button"
            className="btn-glow inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white"
            onClick={() => open({ kind: 'register' })}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            登记软件
          </button>
        )}
      </div>
      <PermissionAlert error={listing.error || toggle.error} />
      <section className="tech-card overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center gap-2 border-b border-indigo-50 px-5 py-3">
          <div className="relative w-full sm:w-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              aria-label="搜索软件"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索软件名称 / 标识"
              className="w-full rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:w-[240px]"
            />
          </div>
          <span className="ml-auto text-[12px] text-slate-400">共 {listing.data?.total ?? 0} 个软件</span>
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table aria-label="仓库软件列表" className="w-full min-w-[560px] table-fixed text-left">
            <colgroup>
              <col className="w-[26%]" />
              <col className="w-[20%]" />
              <col className="w-[13%]" />
              <col />
              <col className="w-[100px]" />
              <col className="w-[100px]" />
            </colgroup>
            <thead className="border-b border-indigo-50 text-[11px] font-semibold tracking-wider text-slate-400">
              <tr className="[&>th]:px-1.5 [&>th]:py-2.5 [&>th:first-child]:pl-5 [&>th:last-child]:pr-5">
                <th scope="col">软件名称</th>
                <th scope="col">最近正式版</th>
                <th scope="col">打包配置</th>
                <th scope="col">仓库所有者</th>
                <th scope="col">状态</th>
                <th scope="col" className="text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-indigo-50/50">
              {listStatus && <tr><td colSpan={6}>{listStatus}</td></tr>}
              {items.map(software => (
                <tr key={software.id} className="hover:bg-indigo-50/30 [&>td]:px-1.5 [&>td]:py-3 [&>td:first-child]:pl-5 [&>td:last-child]:pr-5">
                  <td>
                    <div className="truncate text-[13px] font-semibold text-slate-900" title={software.name}>{software.name}</div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-slate-400" title={software.slug}>{software.slug}</div>
                    {software.description && <div className="mt-0.5 truncate text-[11px] text-slate-500" title={software.description}>{software.description}</div>}
                  </td>
                  <td>
                    <div className="truncate text-[12px] text-slate-700">{software.latest_release_version || '尚未发布'}</div>
                    {software.latest_release_tag && <div className="truncate font-mono text-[10px] text-slate-400" title={software.latest_release_tag}>{software.latest_release_tag}</div>}
                  </td>
                  <td className="text-[12px] text-slate-500">{software.package_config_count ?? 0} 项</td>
                  <td><div className="truncate text-[12px] text-slate-500" title={software.owner?.nickname || software.owner?.username}>{software.owner?.nickname || software.owner?.username || '—'}</div></td>
                  <td><SoftwareStatus active={software.is_active} /></td>
                  <td>{renderActions(software)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="space-y-3 p-3 md:hidden">
          {listStatus}
          {items.map(software => (
            <article key={software.id} className="rounded-xl border border-indigo-100 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-[15px] font-semibold text-slate-900" title={software.name}>{software.name}</h3>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-indigo-500" title={software.slug}>{software.slug}</div>
                </div>
                <SoftwareStatus active={software.is_active} />
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                <span>{software.latest_release_version || '尚未发布'}</span>
                <span>打包配置 {software.package_config_count ?? 0} 项</span>
              </div>
              {software.description && <p className="mt-2 break-words text-[12px] text-slate-500">{software.description}</p>}
              {software.can_maintain && <div className="mt-3 border-t border-indigo-50 pt-2">{renderActions(software)}</div>}
            </article>
          ))}
        </div>
        {listing.data && listing.data.total > listing.data.page_size && (
          <Pagination
            className="border-t border-indigo-50 px-4 py-3"
            current={page}
            total={listing.data.total}
            pageSize={listing.data.page_size}
            showSizeChanger={false}
            onChange={setPage}
          />
        )}
      </section>
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
    </div>
  );
}
