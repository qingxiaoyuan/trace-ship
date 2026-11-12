import { useDeferredValue, useEffect, useState } from 'react';
import { Alert, AutoComplete, Button, Form, Input, Modal } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { accountApi } from '@/api/account';
import { projectApi } from '@/api/project';
import { oaArchiveApi, type ArchiveArtifact, type ArchiveForm, type ArchivePreparation } from '@/api/oaArchive';
import { PermissionAlert } from '@/components/PermissionAlert';
import { useAuthStore } from '@/stores/authStore';
import { useModalDraft } from '@/hooks/useModalDraft';
import type { Release } from '@/types';

const fields: { key: Exclude<keyof ArchiveForm, 'applyCount'>; label: string; required?: boolean; multiline?: boolean; note?: string }[] = [
  { key: 'docCreator', label: '申请人', required: true, note: '选择系统用户或填写 OA 登录名' },
  { key: 'soft_name', label: '软件名称', required: true },
  { key: 'soft_version', label: '软件版本', required: true },
  { key: 'developer', label: '接收人', required: true, note: '选择系统用户或填写 OA 登录名' },
  { key: 'soft_source', label: '软件来源' },
  { key: 'git_svn', label: '产物 SVN 地址', note: '只提交地址，可手填；不会上传文件本体' },
  { key: 'sn_code', label: 'SN', note: '发布时保存的完整源码提交 SHA；旧记录缺失时可补填' },
  { key: 'edit_content', label: '变更内容', multiline: true },
  { key: 'edit_reason', label: '变更原因', multiline: true },
  { key: 'other_description', label: '其他说明', multiline: true },
  { key: 'soft_number', label: '软件编号', note: '可留空；指定已有编号时使用该编号' },
];

/** 本页内准备单产物归档资料，所有外部建单由后续提交能力接入。 */
export function OaArchivePreparationPanel({ release, active = true }: { release: Release; active?: boolean }) {
  const user = useAuthStore(state => state.user);
  const project = useQuery({ queryKey: ['project', release.project], queryFn: () => projectApi.getProject(release.project), enabled: active });
  const role = project.data?.my_role || '';
  const allowed = user?.is_superuser || ['manager', 'software_admin'].includes(role)
    || (release.publisher === user?.id && ['developer', 'tester'].includes(role));
  const [selectOpen, setSelectOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [prepared, setPrepared] = useState<ArchivePreparation>();
  const [formOpen, setFormOpen] = useState(false);
  const [form] = Form.useForm<ArchiveForm>();
  const draft = useModalDraft(formOpen && !!prepared,
    `${release.id}:${prepared?.selection.task_id}:${prepared?.selection.artifact_id}`, () => prepared!.form);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const options = useQuery({ queryKey: ['oa-archive-options', release.id], queryFn: () => oaArchiveApi.options(release.id), enabled: active && selectOpen && !!allowed, retry: false });
  const users = useQuery({ queryKey: ['oa-archive-users', deferredSearch], queryFn: () => accountApi.getUsers({ keyword: deferredSearch || undefined, is_active: true, page_size: 50 }), enabled: active && formOpen, retry: false });
  const prepare = useMutation({
    mutationFn: (artifact: ArchiveArtifact) => oaArchiveApi.prepare(release.id, artifact),
    onSuccess: (data) => { setPrepared(data); setSelectOpen(false); setFormOpen(true); },
  });
  const validate = useMutation({
    mutationFn: (values: ArchiveForm) => oaArchiveApi.prepare(release.id, prepared!.selection, { ...values, applyCount: 1 }),
  });
  useEffect(() => {
    if (formOpen && draft.value) { form.resetFields(); form.setFieldsValue(draft.value); }
  }, [formOpen, draft.value, form]);
  if (!allowed) return null;
  const artifact = options.data?.artifacts.find(item => `${item.task_id}:${item.artifact_id}` === selected);
  const userOptions = (users.data?.results || []).map(item => ({ value: item.username, label: `${item.nickname || item.username}（${item.username}）` }));
  return <section aria-label="OA 软件归档准备" className="space-y-2 rounded-lg border border-indigo-100 bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-[13px] font-medium">OA 软件归档</h3>
      <Button className="min-h-11" onClick={() => { prepare.reset(); validate.reset(); setSelectOpen(true); }}>准备 OA 归档</Button>
    </div>
    <p className="text-[12px] text-slate-500">选择一个现存产物，填写本次申请资料。当前仅准备和校验，尚未接入 OA 发送。</p>
    <Modal title="选择归档产物" open={selectOpen && active} onCancel={() => setSelectOpen(false)} footer={null} width={600}>
      <div className="space-y-3">
        <label htmlFor="archive-artifact" className="block">归档产物</label>
        <select id="archive-artifact" value={selected} onChange={event => setSelected(event.target.value)}
          className="min-h-11 w-full min-w-0 rounded border border-slate-300 bg-white p-2" disabled={options.isPending || prepare.isPending}>
          <option value="">选择一个产物</option>
          {(options.data?.artifacts || []).map(item => <option key={`${item.task_id}:${item.artifact_id}`} value={`${item.task_id}:${item.artifact_id}`}>{item.task_name} / {item.name}</option>)}
        </select>
        {!options.isPending && !options.error && !options.data?.artifacts.length && <Alert type="info" title="没有可准备归档的现存产物，请确认任务成功及 SVN 推送结果。" />}
        {options.error && <><PermissionAlert error={options.error} /><Button onClick={() => void options.refetch()}>重新加载产物</Button></>}
        {prepare.error && <PermissionAlert error={prepare.error} errorTitle="无法准备该产物" />}
        <div className="flex justify-end"><Button className="min-h-11" type="primary" loading={prepare.isPending} disabled={!artifact} onClick={() => artifact && prepare.mutate(artifact)}>填写申请资料</Button></div>
      </div>
    </Modal>
    <Modal title="软件归档申请资料" open={formOpen && active} onCancel={() => setFormOpen(false)} width={800}
      styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      footer={<div className="flex flex-wrap justify-end gap-2"><Button className="min-h-11" onClick={() => setFormOpen(false)}>关闭并保留草稿</Button><Button className="min-h-11" type="primary" loading={validate.isPending} onClick={() => form.submit()}>校验资料</Button></div>}>
      {prepared && <Form form={form} onFinish={values => validate.mutate(values)} onValuesChange={(_, values) => { draft.save({ ...values, applyCount: 1 }); validate.reset(); }}
        onFinishFailed={({ errorFields }) => { if (errorFields[0]) form.scrollToField(errorFields[0].name, { focus: true, block: 'center' }); }}>
        <div className="mb-3 space-y-2">
          {!prepared.configuration.configured && <Alert showIcon type="warning" title={prepared.configuration.reason} />}
          {prepared.content_source === 'release_doc_original' && <Alert type="warning" title="无法可靠识别更新内容，已保留发布说明原文，请人工核对补填。" />}
          <p className="text-[12px] text-slate-500">仅影响本次申请，数量固定为 1。关闭后保留本页草稿，离开页面或刷新后消失。</p>
          {users.error && <p className="text-[12px] text-amber-700">系统用户暂时无法加载，可直接填写 OA 登录名。</p>}
        </div>
        <table aria-label="软件归档申请资料" className="w-full table-fixed border-collapse text-[13px]">
          <tbody>{fields.map(field => <tr key={field.key} className="border-b border-slate-200">
            <th scope="row" className="w-24 break-words bg-slate-50 p-2 text-left align-top font-medium sm:w-32">
              <label htmlFor={`archive-${field.key}`}>{field.label}{field.required && <span aria-hidden="true" className="text-rose-500"> *</span>}</label>
            </th>
            <td className="min-w-0 p-2 align-top">
              <Form.Item name={field.key} style={{ marginBottom: 0 }} rules={field.required ? [{ required: true, whitespace: true, message: `请填写${field.label}` }] : []}>
                {field.key === 'docCreator' || field.key === 'developer' ? <AutoComplete id={`archive-${field.key}`} className="w-full" options={userOptions} onSearch={setSearch} virtual={false} />
                  : field.key === 'soft_source' ? <select id={`archive-${field.key}`} className="w-full rounded border border-slate-300 bg-white p-2"><option value="">请选择（可留空）</option><option value="内部自制">内部自制</option><option value="外购">外购</option></select>
                    : field.multiline ? <Input.TextArea id={`archive-${field.key}`} autoSize={{ minRows: 3, maxRows: 12 }} />
                      : <Input id={`archive-${field.key}`} />}
              </Form.Item>
              {field.note && <p className="mt-1 break-words text-[11px] text-slate-500">{field.note}</p>}
            </td>
          </tr>)}<tr><th scope="row" className="bg-slate-50 p-2 text-left font-medium">申请数量</th><td className="p-2">1</td></tr></tbody>
        </table>
        {validate.error && <div className="mt-3"><PermissionAlert error={validate.error} errorTitle="资料校验失败" /></div>}
        {validate.isSuccess && <div className="mt-3"><Alert type="success" showIcon title="资料校验通过，尚未向 OA 发送。" /></div>}
      </Form>}
    </Modal>
  </section>;
}
