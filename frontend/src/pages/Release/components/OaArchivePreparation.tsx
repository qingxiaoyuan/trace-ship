import { Fragment, useDeferredValue, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Alert, AutoComplete, Button, Checkbox, Form, Input, Modal, Select } from 'antd';
import { Archive, FolderArchive } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { accountApi } from '@/api/account';
import { projectApi } from '@/api/project';
import { oaArchiveApi, type ArchiveApplication, type ArchiveConfirmation, type ArchiveSelection, type ArchiveForm, type ArchivePreparation } from '@/api/oaArchive';
import { PermissionAlert } from '@/components/PermissionAlert';
import { useAuthStore } from '@/stores/authStore';
import { useModalDraft } from '@/hooks/useModalDraft';
import type { Release } from '@/types';
import { OaArchiveDirectoryPicker } from './OaArchiveDirectoryPicker';

const fields: { key: Exclude<keyof ArchiveForm, 'applyCount' | 'soft_number'>; label: string; group?: string; required?: boolean; multiline?: boolean; note?: string }[] = [
  { key: 'docCreator', label: '申请人', group: '申请信息', required: true, note: '选择系统用户或填写 OA 登录名' },
  { key: 'soft_name', label: '软件名称', required: true },
  { key: 'soft_version', label: '软件版本', required: true },
  { key: 'developer', label: '接收人', required: true, note: '选择系统用户或填写 OA 登录名' },
  { key: 'soft_source', label: '软件来源' },
  { key: 'git_svn', label: '产物 SVN 地址', group: '产物信息', note: '预填整个产物目录地址，可手填；不会上传文件本体' },
  { key: 'sn_code', label: 'SN', note: '发布时保存的完整源码提交 SHA；旧记录缺失时可补填' },
  { key: 'edit_content', label: '变更内容', group: '变更与补充', multiline: true },
  { key: 'edit_reason', label: '变更原因', multiline: true },
  { key: 'other_description', label: '其他说明', multiline: true },
];
const historyFields = [...fields, { key: 'soft_number' as const, label: '软件编号' }];

const confirmationText = { '': '首次申请', reapply: '显式再次申请', retry: '失败后主动重试', checked_no_order: '已核对 OA 未建单后重试' };
const statusText = { sending: '发送中', success: '已发起归档', failure: 'OA 返回失败', unknown: '结果未确认' };

/** 目录申请和项目内历史共用发布详情，未提交草稿仅在本页内保存。 */
export function OaArchivePreparationPanel({ release, active = true, actionTarget }: { release: Release; active?: boolean; actionTarget?: HTMLElement | null }) {
  const user = useAuthStore(state => state.user);
  const project = useQuery({ queryKey: ['project', release.project], queryFn: () => projectApi.getProject(release.project), enabled: active });
  const role = project.data?.my_role || '';
  const allowed = user?.is_superuser || ['manager', 'software_admin'].includes(role)
    || (release.publisher === user?.id && ['developer', 'tester'].includes(role));
  const [selectOpen, setSelectOpen] = useState(false);
  const [prepared, setPrepared] = useState<ArchivePreparation>();
  const [formOpen, setFormOpen] = useState(false);
  const [form] = Form.useForm<ArchiveForm>();
  const [viewing, setViewing] = useState<ArchiveApplication>();
  const [confirmingFailure, setConfirmingFailure] = useState<ArchiveApplication>();
  const [noOrderChecked, setNoOrderChecked] = useState(false);
  const [confirmationEvidence, setConfirmationEvidence] = useState<Record<string, string>>({});
  const inFlight = useRef(false);
  const [checking, setChecking] = useState(false);
  const [confirmation, setConfirmation] = useState<{ previous: ArchiveApplication; values: ArchiveForm; count: number }>();
  const [checkedNoOrder, setCheckedNoOrder] = useState(false);
  const [uncertain, setUncertain] = useState<Record<string, string>>({});
  const identity = `${release.id}:${prepared?.selection.scope || 'file'}:${prepared?.selection.task_id}:${prepared?.selection.path || prepared?.selection.artifact_id}`;

  const records = useQuery({ queryKey: ['oa-archive-records', release.id], queryFn: () => oaArchiveApi.records(release.id), enabled: active,
    refetchInterval: query => query.state.data?.some(item => item.status === 'sending') ? 2000 : false });
  const confirmFailure = useMutation({
    mutationFn: () => oaArchiveApi.confirmNoOrder(release.id, confirmingFailure!.id, confirmationEvidence[confirmingFailure!.id] || ''),
    onSuccess: result => {
      setConfirmationEvidence(current => { const remaining = { ...current }; delete remaining[result.id]; return remaining; });
      setConfirmingFailure(undefined);
      void records.refetch();
    },
  });
  const existing = records.data?.filter(item => item.source.task_id === prepared?.selection.task_id && item.source.path === prepared?.selection.path && (item.source.scope || 'file') === (prepared?.selection.scope || 'file')) || [];
  const latest = existing[0];
  const uncertainKey = uncertain[identity] && !existing.some(item => item.submission_id === uncertain[identity]);
  const draft = useModalDraft(formOpen && !!prepared, identity,
    () => latest && ['failure', 'unknown'].includes(latest.status) ? latest.form : prepared!.form);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const users = useQuery({ queryKey: ['oa-archive-users', deferredSearch], queryFn: () => accountApi.getUsers({ keyword: deferredSearch || undefined, is_active: true, page_size: 50 }), enabled: active && formOpen, retry: false });
  const prepare = useMutation({
    mutationFn: (selection: ArchiveSelection) => oaArchiveApi.prepare(release.id, selection),
    onSuccess: async data => { await records.refetch(); setPrepared(data); setSelectOpen(false); setFormOpen(true); },
  });
  const validate = useMutation({
    mutationFn: (values: ArchiveForm) => oaArchiveApi.prepare(release.id, prepared!.selection, { ...values, applyCount: 1, soft_number: '' }),
  });
  const submit = useMutation({
    mutationFn: ({ values, previous, submissionId }: { values: ArchiveForm; previous?: ArchiveApplication; submissionId: string }) => {
      const reason: ArchiveConfirmation = previous?.status === 'unknown' ? 'checked_no_order' : previous?.status === 'failure' ? 'retry' : 'reapply';
      return oaArchiveApi.submit(release.id, prepared!.selection, { ...values, applyCount: 1, soft_number: '' }, submissionId,
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
      const history = current.data?.filter(item => item.source.task_id === prepared?.selection.task_id && item.source.path === prepared?.selection.path && (item.source.scope || 'file') === (prepared?.selection.scope || 'file')) || [];
      if (history[0]?.status === 'sending' || (uncertain[identity] && !history.some(item => item.submission_id === uncertain[identity]))) return;
      if (history[0]) { setCheckedNoOrder(false); setConfirmation({ previous: history[0], values, count: history.length }); }
      else { dispatched = true; dispatch(values); }
    } catch { form.submit(); }
    finally { if (!dispatched) inFlight.current = false; setChecking(false); }
  }
  useEffect(() => {
    if (formOpen && draft.value) { form.resetFields(); form.setFieldsValue(draft.value); }
  }, [formOpen, draft.value, form]);
  const userOptions = (users.data?.results || []).map(item => ({ value: item.username, label: `${item.nickname || item.username}（${item.username}）` }));
  const action = allowed ? <Button className="shrink-0 max-md:min-h-11" icon={<Archive className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />} disabled={submit.isPending || checking} onClick={() => { prepare.reset(); validate.reset(); submit.reset(); setSelectOpen(true); }}>发起 OA 归档</Button> : null;
  return <section aria-label="OA 软件归档准备" className="space-y-2 rounded-lg border border-indigo-100 bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-[13px] font-medium">OA 软件归档</h3>
      {actionTarget ? createPortal(action, actionTarget) : action}
    </div>
    <p className="text-[12px] text-slate-500">{allowed ? '选择一次成功打包的整个产物目录，核对后手动提交 OA。' : '查看本项目的归档申请资料、实际操作者与结果。'}已发起归档表示流程创建成功，不表示 OA 审批通过。</p>
    {records.error && <><PermissionAlert error={records.error} errorTitle="归档记录加载失败" /><Button onClick={() => void records.refetch()}>重新读取归档记录</Button></>}
    <div className="space-y-2" aria-label="归档申请历史">{records.data?.map(item => <article key={item.id} className="rounded border border-slate-200 p-3 text-[12px]">
      <p className="break-words font-medium">{statusText[item.status]} · {item.source.scope === 'directory' ? `${item.source.task_name} / 整个产物目录` : item.source.path}</p>
      <p>{confirmationText[item.confirmation || '']}{item.previous_id && ` · 前次申请：${item.previous_id}`}</p>
      {item.source.kind === 'svn' && <p>{item.source.supplemented ? '从 SVN 补录' : item.source.scope === 'directory' ? '当前 SVN 目录' : 'SVN 当前文件'} · {item.source.task_name}</p>}
      <p>实际操作者：{item.operator.username} · {new Date(item.created_at).toLocaleString()}</p>
      {item.soft_number && <p>软件编号：{item.soft_number}</p>}
      <p className="whitespace-pre-wrap break-words">{item.message}</p>
      {item.no_order_confirmation && <p className="whitespace-pre-wrap break-words">已核对未建单 · {item.no_order_confirmation.operator.username} · {new Date(item.no_order_confirmation.confirmed_at).toLocaleString()}<br />核对依据：{item.no_order_confirmation.evidence}</p>}
      {item.status === 'failure' && !item.no_order_confirmation && <p>尚未核对未建单，来源仍受删除保护。</p>}
      <div className="flex flex-wrap gap-2"><Button onClick={() => setViewing(item)}>查看申请资料</Button>
        {allowed && item.status === 'failure' && !item.no_order_confirmation && <Button onClick={() => { confirmFailure.reset(); setNoOrderChecked(false); setConfirmingFailure(item); }}>确认未建单</Button>}
      </div>
    </article>)}</div>
    <OaArchiveDirectoryPicker releaseId={release.id} open={selectOpen && active && !!allowed} onClose={() => setSelectOpen(false)} onSelect={selection => prepare.mutate(selection)} pending={prepare.isPending} error={prepare.error} />
    <Modal title="软件归档申请资料" open={formOpen && active} onCancel={() => { if (!submit.isPending && !checking) setFormOpen(false); }} width={800}
      styles={{ body: { maxHeight: '70vh', overflowY: 'auto', paddingRight: 8, paddingTop: 4 } }}
      footer={<div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4"><Button className="max-md:min-h-11" disabled={submit.isPending || checking} onClick={() => setFormOpen(false)}>关闭并保留草稿</Button><Button className="max-md:min-h-11" loading={validate.isPending} disabled={submit.isPending || checking} onClick={() => form.submit()}>校验资料</Button><Button aria-label="提交 OA 归档" aria-busy={submit.isPending || checking} className="max-md:min-h-11" type="primary" loading={submit.isPending || checking} disabled={!prepared?.configuration.configured || records.isPending || !!records.error || latest?.status === 'sending' || !!uncertainKey} onClick={() => void send()}>提交 OA 归档</Button></div>}>
      {prepared && <Form form={form} disabled={submit.isPending || checking} onFinish={values => validate.mutate(values)} onValuesChange={(_, values) => { draft.save({ ...values, applyCount: 1 }); validate.reset(); }}
        onFinishFailed={({ errorFields }) => { if (errorFields[0]) form.scrollToField(errorFields[0].name, { focus: true, block: 'center' }); }}>
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex items-start gap-3 rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
            <FolderArchive className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" strokeWidth={1.5} aria-hidden="true" />
            <div className="min-w-0"><p className="text-[13px] font-medium text-slate-700">{`${prepared.source?.kind === 'svn' ? prepared.source.supplemented ? '从 SVN 补录' : '当前 SVN 目录' : '本地产物'} · 整个产物目录`}</p>
              <p className="mt-1 text-[12px] leading-5 text-slate-500">{prepared.source?.kind === 'svn' ? '提交时重新核验目录及交付文件，手改地址不改变来源。当前内容可能已覆盖，原始与当前依据分别保留。' : '包含所选打包目录中的全部产物，多个文件只办理一份归档，提交时重新核验。'}</p></div>
          </div>
          {!prepared.configuration.configured && <Alert showIcon type="warning" title={prepared.configuration.reason} />}
          {existing.length > 0 && <Alert type="info" title={`该目录已有 ${existing.length} 次申请，最新结果：${statusText[latest.status]}。提交前需确认已有记录。`} />}
          {uncertainKey && <Alert type="warning" title="浏览器未可靠取得提交结果，请重新读取归档记录并核对 OA，系统不会自动重发。" action={<Button onClick={() => void records.refetch()}>重新读取归档记录</Button>} />}
          {submit.data && submit.data.status !== 'success' && <Alert type="warning" title={`${statusText[submit.data.status]}：${submit.data.message}`} />}
          {submit.error && <PermissionAlert error={submit.error} errorTitle="提交结果需要核对" />}
          {prepared.content_source === 'release_doc_original' && <Alert type="warning" title="无法可靠识别更新内容，已保留发布说明原文，请人工核对补填。" />}
          {users.error && <p className="text-[12px] text-amber-700">系统用户暂时无法加载，可直接填写 OA 登录名。</p>}
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table aria-label="软件归档申请资料" className="w-full table-fixed border-collapse text-[13px]">
          <colgroup><col className="w-24 sm:w-32" /><col /></colgroup>
          <tbody>{fields.map(field => <Fragment key={field.key}>
            {field.group && <tr className="border-b border-slate-200 bg-indigo-50/50"><td colSpan={2} className="px-3 py-2 sm:px-4"><h4 className="text-[12px] font-medium text-indigo-600">{field.group}</h4></td></tr>}
            <tr className="border-b border-slate-100">
            <th scope="row" className="break-words bg-slate-50/70 px-3 py-3 text-left align-top font-medium text-slate-600 sm:px-4">
              <label htmlFor={`archive-${field.key}`} className="block pt-1.5 leading-5">{field.label}{field.required && <span aria-hidden="true" className="text-rose-500"> *</span>}</label>
            </th>
            <td className="min-w-0 px-3 py-3 align-top sm:px-4">
              <Form.Item name={field.key} style={{ marginBottom: 0 }} rules={field.required ? [{ required: true, whitespace: true, message: `请填写${field.label}` }] : []}>
                {field.key === 'docCreator' || field.key === 'developer' ? <AutoComplete id={`archive-${field.key}`} className="w-full" options={userOptions} onSearch={setSearch} virtual={false} />
                  : field.key === 'soft_source' ? <Select id={`archive-${field.key}`} className="w-full" virtual={false} options={[{ value: '', label: '请选择（可留空）' }, { value: '内部自制', label: '内部自制' }, { value: '外购', label: '外购' }]} />
                    : field.multiline ? <Input.TextArea id={`archive-${field.key}`} autoSize={{ minRows: 3, maxRows: 12 }} />
                      : <Input id={`archive-${field.key}`} />}
              </Form.Item>
              {field.note && <p className="mt-1.5 break-words text-[12px] leading-5 text-slate-500">{field.note}</p>}
            </td>
          </tr></Fragment>)}</tbody>
        </table>
        </div>
        {validate.error && <div className="mt-3"><PermissionAlert error={validate.error} errorTitle="资料校验失败" /></div>}
        {validate.isSuccess && <div className="mt-3"><Alert type="success" showIcon title="资料校验通过，尚未向 OA 发送。" /></div>}
      </Form>}
    </Modal>
    <Modal title={confirmation?.previous.status === 'success' ? '确认再次申请' : '确认主动重试'} open={!!confirmation && active}
      onCancel={() => setConfirmation(undefined)} onOk={() => { if (confirmation && !inFlight.current) dispatch(confirmation.values, confirmation.previous); }}
      okText={confirmation?.previous.status === 'success' ? '确认再次申请' : '确认重试'}
      okButtonProps={{ disabled: confirmation?.previous.status === 'unknown' && !checkedNoOrder }} cancelText="取消">
      {confirmation && <div className="space-y-3 text-[13px]">
        <p>该目录已有 {confirmation.count} 次申请。最新结果：{statusText[confirmation.previous.status]}；实际操作者：{confirmation.previous.operator.username}；提交时间：{new Date(confirmation.previous.created_at).toLocaleString()}。</p>
        <p className="whitespace-pre-wrap break-words">{confirmation.previous.message}</p>
        <p>本次会重新向 OA 发送并新增一条记录，所有历史保留。软件编号由 OA 重新申请，不沿用此前生成的编号。</p>
        {confirmation.previous.status === 'unknown' ? <><Alert type="warning" showIcon title="OA 可能已经建单，请先人工核对；重复提交可能产生重复单据。系统不会自动查询或重发。" /><Checkbox checked={checkedNoOrder} onChange={event => setCheckedNoOrder(event.target.checked)}>我已核对 OA，确认此前申请未建单</Checkbox></>
          : confirmation.previous.status === 'failure' ? <Alert type="warning" title="OA 返回失败不保证没有外部副作用，请核对后主动重试。" /> : <Alert type="warning" title="该目录已有已发起归档的记录，请确认仍需再次办理。" />}
      </div>}
    </Modal>
    <Modal title="核对失败申请" open={!!confirmingFailure && active}
      onCancel={() => { if (!confirmFailure.isPending) setConfirmingFailure(undefined); }}
      onOk={() => confirmFailure.mutate()} okText="保存核对结果" cancelText="取消"
      confirmLoading={confirmFailure.isPending} cancelButtonProps={{ disabled: confirmFailure.isPending }}
      okButtonProps={{ disabled: !noOrderChecked || !confirmationEvidence[confirmingFailure?.id || '']?.trim() }}>
      {confirmingFailure && <div className="space-y-3">
        <Alert type="warning" showIcon title="请先在 OA 核对这条失败申请是否建单。系统不会查询或重试。只解除本条失败申请的保护，其他归档记录仍独立保护来源。" />
        <p className="break-words">{confirmingFailure.source.scope === 'directory' ? `${confirmingFailure.source.task_name} / 整个产物目录` : confirmingFailure.source.path} · {confirmingFailure.operator.username} · {new Date(confirmingFailure.created_at).toLocaleString()}</p>
        <label htmlFor="oa-no-order-evidence">核对依据</label>
        <Input.TextArea id="oa-no-order-evidence" maxLength={2000} value={confirmationEvidence[confirmingFailure.id] || ''} disabled={confirmFailure.isPending}
          onChange={event => setConfirmationEvidence(current => ({ ...current, [confirmingFailure.id]: event.target.value }))} />
        <Checkbox checked={noOrderChecked} disabled={confirmFailure.isPending} onChange={event => setNoOrderChecked(event.target.checked)}>我已核对 OA，确认这条失败申请未建单</Checkbox>
        {confirmFailure.error && <PermissionAlert error={confirmFailure.error} errorTitle="核对结果保存失败" />}
      </div>}
    </Modal>
    <Modal title="归档申请记录" open={!!viewing && active} onCancel={() => setViewing(undefined)} footer={null} width={800} styles={{ body: { maxHeight: '75vh', overflowY: 'auto' } }}>
      {viewing && <div className="space-y-3 text-[13px]">
        <p>{statusText[viewing.status]} · 实际操作者：{viewing.operator.username}</p>
        <p>{confirmationText[viewing.confirmation || '']}{viewing.previous_id && ` · 前次申请：${viewing.previous_id}`}</p>
        {viewing.no_order_confirmation && <p className="whitespace-pre-wrap break-words">已核对未建单 · {viewing.no_order_confirmation.operator.username} · {new Date(viewing.no_order_confirmation.confirmed_at).toLocaleString()}<br />核对依据：{viewing.no_order_confirmation.evidence}</p>}
        <p>发送时间：{new Date(viewing.created_at).toLocaleString()}</p>
        <table aria-label="已提交归档资料" className="w-full table-fixed border-collapse"><tbody>{historyFields.map(field => <tr key={field.key} className="border-b border-slate-200"><th scope="row" className="w-24 bg-slate-50 p-2 text-left align-top">{field.label}</th><td className="whitespace-pre-wrap break-words p-2">{viewing.form[field.key] || '—'}</td></tr>)}</tbody></table>
        {viewing.source.kind === 'svn' && <p>{viewing.source.supplemented ? '从 SVN 补录' : viewing.source.scope === 'directory' ? '当前 SVN 目录' : 'SVN 当前文件'} · {viewing.source.scope === 'directory' ? '整个产物目录' : viewing.source.path}</p>}
        <h4>原发布与产物依据</h4><pre className="whitespace-pre-wrap break-all">{JSON.stringify(viewing.source, null, 2)}</pre>
        <h4>软件归档返回对象</h4><pre className="whitespace-pre-wrap break-all">{JSON.stringify(viewing.software_archive_id, null, 2)}</pre>
        <h4>编号申请单 ID</h4><pre className="whitespace-pre-wrap break-all">{JSON.stringify(viewing.number_apply_id, null, 2)}</pre>
      </div>}
    </Modal>
  </section>;
}
