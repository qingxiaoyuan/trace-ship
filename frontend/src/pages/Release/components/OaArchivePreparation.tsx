import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { Alert, AutoComplete, Button, Checkbox, Form, Input, Modal } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { accountApi } from '@/api/account';
import { projectApi } from '@/api/project';
import { oaArchiveApi, type ArchiveApplication, type ArchiveConfirmation, type ArchiveArtifact, type ArchiveForm, type ArchivePreparation } from '@/api/oaArchive';
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

const confirmationText = { '': '首次申请', reapply: '显式再次申请', retry: '失败后主动重试', checked_no_order: '已核对 OA 未建单后重试' };
const statusText = { sending: '发送中', success: '已发起归档', failure: 'OA 返回失败', unknown: '结果未确认' };

/** 单产物申请和项目内历史共用发布详情，未提交草稿仅在本页内保存。 */
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
  const [viewing, setViewing] = useState<ArchiveApplication>();
  const inFlight = useRef(false);
  const [checking, setChecking] = useState(false);
  const [confirmation, setConfirmation] = useState<{ previous: ArchiveApplication; values: ArchiveForm; count: number }>();
  const [checkedNoOrder, setCheckedNoOrder] = useState(false);
  const [uncertain, setUncertain] = useState<Record<string, string>>({});
  const identity = `${release.id}:${prepared?.selection.task_id}:${prepared?.selection.path || prepared?.selection.artifact_id}`;

  const records = useQuery({ queryKey: ['oa-archive-records', release.id], queryFn: () => oaArchiveApi.records(release.id), enabled: active,
    refetchInterval: query => query.state.data?.some(item => item.status === 'sending') ? 2000 : false });
  const existing = records.data?.filter(item => item.source.task_id === prepared?.selection.task_id && item.source.path === prepared?.selection.path) || [];
  const latest = existing[0];
  const uncertainKey = uncertain[identity] && !existing.some(item => item.submission_id === uncertain[identity]);
  const draft = useModalDraft(formOpen && !!prepared, identity,
    () => latest && ['failure', 'unknown'].includes(latest.status) ? latest.form : prepared!.form);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const options = useQuery({ queryKey: ['oa-archive-options', release.id], queryFn: () => oaArchiveApi.options(release.id), enabled: active && selectOpen && !!allowed, retry: false });
  const users = useQuery({ queryKey: ['oa-archive-users', deferredSearch], queryFn: () => accountApi.getUsers({ keyword: deferredSearch || undefined, is_active: true, page_size: 50 }), enabled: active && formOpen, retry: false });
  const prepare = useMutation({
    mutationFn: (artifact: ArchiveArtifact) => oaArchiveApi.prepare(release.id, artifact),
    onSuccess: async (data, artifact) => { await records.refetch(); setPrepared({ ...data, selection: { ...data.selection, path: artifact.path } }); setSelectOpen(false); setFormOpen(true); },
  });
  const validate = useMutation({
    mutationFn: (values: ArchiveForm) => oaArchiveApi.prepare(release.id, prepared!.selection, { ...values, applyCount: 1 }),
  });
  const submit = useMutation({
    mutationFn: ({ values, previous, submissionId }: { values: ArchiveForm; previous?: ArchiveApplication; submissionId: string }) => {
      const reason: ArchiveConfirmation = previous?.status === 'unknown' ? 'checked_no_order' : previous?.status === 'failure' ? 'retry' : 'reapply';
      return oaArchiveApi.submit(release.id, prepared!.selection, { ...values, applyCount: 1 }, submissionId,
        previous ? { previous_id: previous.id, confirmation: reason } : undefined);
    },
    onSuccess: result => {
      if (result.status === 'success') { draft.clear(); setFormOpen(false); }
      void records.refetch();
    },
    onError: (error, variables) => {
      const status = (error as { status?: number }).status;
      if (!status || status >= 500) setUncertain(current => ({ ...current, [identity]: variables.submissionId }));
      void records.refetch();
    },
    onSettled: () => { inFlight.current = false; },
  });
  function dispatch(values: ArchiveForm, previous?: ArchiveApplication) {
    inFlight.current = true;
    submit.mutate({ values, previous, submissionId: crypto.randomUUID() });
    setConfirmation(undefined);
  }
  async function send() {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    let dispatched = false;
    try {
      const values = await form.validateFields();
      const current = await records.refetch();
      if (current.error) return;
      const history = current.data?.filter(item => item.source.task_id === prepared?.selection.task_id && item.source.path === prepared?.selection.path) || [];
      if (history[0]?.status === 'sending' || (uncertain[identity] && !history.some(item => item.submission_id === uncertain[identity]))) return;
      if (history[0]) { setCheckedNoOrder(false); setConfirmation({ previous: history[0], values, count: history.length }); }
      else { dispatched = true; dispatch(values); }
    } catch { form.submit(); }
    finally { if (!dispatched) inFlight.current = false; setChecking(false); }
  }
  useEffect(() => {
    if (formOpen && draft.value) { form.resetFields(); form.setFieldsValue(draft.value); }
  }, [formOpen, draft.value, form]);
  const artifact = options.data?.artifacts.find(item => `${item.task_id}:${item.artifact_id}` === selected);
  const userOptions = (users.data?.results || []).map(item => ({ value: item.username, label: `${item.nickname || item.username}（${item.username}）` }));
  return <section aria-label="OA 软件归档准备" className="space-y-2 rounded-lg border border-indigo-100 bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-[13px] font-medium">OA 软件归档</h3>
      {allowed && <Button className="min-h-11" disabled={submit.isPending || checking} onClick={() => { prepare.reset(); validate.reset(); submit.reset(); setSelectOpen(true); }}>准备 OA 归档</Button>}
    </div>
    <p className="text-[12px] text-slate-500">选择一个现存产物，核对后手动提交 OA。已发起归档表示流程创建成功，不表示 OA 审批通过。</p>
    {records.error && <><PermissionAlert error={records.error} errorTitle="归档记录加载失败" /><Button onClick={() => void records.refetch()}>重新读取归档记录</Button></>}
    <div className="space-y-2" aria-label="归档申请历史">{records.data?.map(item => <article key={item.id} className="rounded border border-slate-200 p-3 text-[12px]">
      <p className="break-words font-medium">{statusText[item.status]} · {item.source.path}</p>
      <p>{confirmationText[item.confirmation || '']}{item.previous_id && ` · 前次申请：${item.previous_id}`}</p>
      <p>实际操作者：{item.operator.username} · {new Date(item.created_at).toLocaleString()}</p>
      {item.soft_number && <p>软件编号：{item.soft_number}</p>}
      <p className="whitespace-pre-wrap break-words">{item.message}</p>
      <Button onClick={() => setViewing(item)}>查看申请资料</Button>
    </article>)}</div>
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
    <Modal title="软件归档申请资料" open={formOpen && active} onCancel={() => { if (!submit.isPending && !checking) setFormOpen(false); }} width={800}
      styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      footer={<div className="flex flex-wrap justify-end gap-2"><Button className="min-h-11" disabled={submit.isPending || checking} onClick={() => setFormOpen(false)}>关闭并保留草稿</Button><Button className="min-h-11" loading={validate.isPending} disabled={submit.isPending || checking} onClick={() => form.submit()}>校验资料</Button><Button className="min-h-11" type="primary" loading={submit.isPending || checking} disabled={!prepared?.configuration.configured || records.isPending || !!records.error || latest?.status === 'sending' || !!uncertainKey} onClick={() => void send()}>提交 OA 归档</Button></div>}>
      {prepared && <Form form={form} disabled={submit.isPending || checking} onFinish={values => validate.mutate(values)} onValuesChange={(_, values) => { draft.save({ ...values, applyCount: 1 }); validate.reset(); }}
        onFinishFailed={({ errorFields }) => { if (errorFields[0]) form.scrollToField(errorFields[0].name, { focus: true, block: 'center' }); }}>
        <div className="mb-3 space-y-2">
          {!prepared.configuration.configured && <Alert showIcon type="warning" title={prepared.configuration.reason} />}
          {existing.length > 0 && <Alert type="info" title={`该产物已有 ${existing.length} 次申请，最新结果：${statusText[latest.status]}。提交前需确认已有记录。`} />}
          {uncertainKey && <Alert type="warning" title="浏览器未可靠取得提交结果，请重新读取归档记录并核对 OA，系统不会自动重发。" action={<Button onClick={() => void records.refetch()}>重新读取归档记录</Button>} />}
          {submit.data && submit.data.status !== 'success' && <Alert type="warning" title={`${statusText[submit.data.status]}：${submit.data.message}`} />}
          {submit.error && <PermissionAlert error={submit.error} errorTitle="提交结果需要核对" />}
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
    <Modal title={confirmation?.previous.status === 'success' ? '确认再次申请' : '确认主动重试'} open={!!confirmation && active}
      onCancel={() => setConfirmation(undefined)} onOk={() => { if (confirmation && !inFlight.current) dispatch(confirmation.values, confirmation.previous); }}
      okText={confirmation?.previous.status === 'success' ? '确认再次申请' : '确认重试'}
      okButtonProps={{ disabled: confirmation?.previous.status === 'unknown' && !checkedNoOrder }} cancelText="取消">
      {confirmation && <div className="space-y-3 text-[13px]">
        <p>该产物已有 {confirmation.count} 次申请。最新结果：{statusText[confirmation.previous.status]}；实际操作者：{confirmation.previous.operator.username}；提交时间：{new Date(confirmation.previous.created_at).toLocaleString()}。</p>
        <p className="whitespace-pre-wrap break-words">{confirmation.previous.message}</p>
        <p>本次会重新向 OA 发送并新增一条记录，所有历史保留。软件编号不会自动沿用此前生成的编号，需复用时请在表单中手填。</p>
        {confirmation.previous.status === 'unknown' ? <><Alert type="warning" showIcon title="OA 可能已经建单，请先人工核对；重复提交可能产生重复单据。系统不会自动查询或重发。" /><Checkbox checked={checkedNoOrder} onChange={event => setCheckedNoOrder(event.target.checked)}>我已核对 OA，确认此前申请未建单</Checkbox></>
          : confirmation.previous.status === 'failure' ? <Alert type="warning" title="OA 返回失败不保证没有外部副作用，请核对后主动重试。" /> : <Alert type="warning" title="该产物已有已发起归档的记录，请确认仍需再次办理。" />}
      </div>}
    </Modal>
    <Modal title="归档申请记录" open={!!viewing && active} onCancel={() => setViewing(undefined)} footer={null} width={800} styles={{ body: { maxHeight: '75vh', overflowY: 'auto' } }}>
      {viewing && <div className="space-y-3 text-[13px]">
        <p>{statusText[viewing.status]} · 实际操作者：{viewing.operator.username}</p>
        <p>{confirmationText[viewing.confirmation || '']}{viewing.previous_id && ` · 前次申请：${viewing.previous_id}`}</p>
        <p>发送时间：{new Date(viewing.created_at).toLocaleString()}</p>
        <table aria-label="已提交归档资料" className="w-full table-fixed border-collapse"><tbody>{fields.map(field => <tr key={field.key} className="border-b border-slate-200"><th scope="row" className="w-24 bg-slate-50 p-2 text-left align-top">{field.label}</th><td className="whitespace-pre-wrap break-words p-2">{viewing.form[field.key] || '—'}</td></tr>)}</tbody></table>
        <h4>原发布与产物依据</h4><pre className="whitespace-pre-wrap break-all">{JSON.stringify(viewing.source, null, 2)}</pre>
        <h4>软件归档返回对象</h4><pre className="whitespace-pre-wrap break-all">{JSON.stringify(viewing.software_archive_id, null, 2)}</pre>
        <h4>编号申请单 ID</h4><pre className="whitespace-pre-wrap break-all">{JSON.stringify(viewing.number_apply_id, null, 2)}</pre>
      </div>}
    </Modal>
  </section>;
}
