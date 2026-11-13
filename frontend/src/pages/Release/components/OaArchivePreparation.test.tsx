import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App, ConfigProvider } from 'antd';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ReleaseDetail from '../Detail';
import request from '@/api/request';
import { useAuthStore } from '@/stores/authStore';
import type { Release, UserInfo } from '@/types';
import { ReleasePackages } from './ReleasePackages';
import { MaintainerReleaseDetail } from './MaintainerReleaseDetail';

const adapter = request.defaults.adapter;
const user = useAuthStore.getState().user;
const requests: { url?: string; method?: string; data: unknown }[] = [];
let role = 'manager';
let configured = false;
let historyMode = false;
let sameTaskNames = false;
let savedRecords: unknown[] = [];
const release = { id: 'release', project: 'project', repository: 'repo', publisher: 'publisher', version: 'V1.2.3',
  release_type: 'formal', status: 'released', package_tasks: [] } as unknown as Release;
const initialForm = { docCreator: 'operator', applyCount: 1, soft_name: '项目内软件', soft_version: 'V1.2.3', developer: 'publisher',
  soft_source: '', git_svn: '', sn_code: '0123456789abcdef0123456789abcdef01234567',
  edit_content: 'A 人工编辑 | 字面管道\n\n  第二行\n' + '完整内容'.repeat(100) + '末尾完整', edit_reason: '', other_description: '', soft_number: '' };

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }) });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  role = 'manager';
  configured = false;
  historyMode = false;
  sameTaskNames = false;
  savedRecords = [];
  requests.length = 0;
  useAuthStore.setState({ user: { id: 'operator', username: 'operator', is_superuser: false, permissions: [] } as unknown as UserInfo });
  request.defaults.adapter = async config => {
    const payload = config.data ? JSON.parse(config.data) : undefined;
    requests.push({ url: config.url, method: config.method, data: payload });
    let data: unknown;
    if (config.url === '/projects/project/') data = { id: 'project', my_role: role };
    else if (config.url === '/packages/configs/') data = { results: [], total: 0 };
    else if (config.url === '/account/users/') data = { results: [{ id: 'receiver', username: 'account.login', nickname: '人员显示名' }], total: 1 };
    else if (config.url?.endsWith('/oa-archive/options/')) data = { artifacts: [
      { task_id: 'task', task_name: '正式安装包', artifact_id: 'one', name: '软件一.zip', path: '软件一.zip' },
      { task_id: 'task', task_name: '正式安装包', artifact_id: 'two', name: '软件二.zip', path: '软件二.zip' },
    ], directories: [
      { task_id: 'task', task_name: '正式安装包', created_at: '2026-11-13T08:00:00', scope: 'directory', path: '.', name: '完整产物目录', source_kind: 'local', artifact_count: 2 },
      { task_id: 'task-two', task_name: sameTaskNames ? '正式安装包' : '第二次打包', created_at: '2026-11-13T09:00:00', scope: 'directory', path: '.', name: '完整产物目录', source_kind: 'local', artifact_count: 1 },
      ...(historyMode ? [{ task_id: 'history', task_name: '无清单历史任务', scope: 'directory', path: '.', name: '完整产物目录', source_kind: 'svn' }] : []),
    ] };
    else if (config.url === '/packages/tasks/history/svn-artifacts/') data = { mode: 'browse', root_url: 'svn://example/task', entries: [{ path: '目录/补录.zip', name: '补录.zip', source: 'svn_supplement', state: 'available', original: { size: null }, current: { kind: 'file', size: 7, revision: '2' } }], total: 1, page: 1, page_size: 50 };
    else if (config.url?.endsWith('/oa-archive/prepare/')) data = { selection: { task_id: payload.task_id, scope: payload.scope, path: payload.path, source_kind: payload.source_kind }, source: historyMode ? { kind: 'svn', scope: 'directory', supplemented: true, path: '.', original: {}, current: { kind: 'dir', revision: '2' } } : undefined,
      form: payload.form || initialForm, configuration: { configured, reason: '尚未配置 OA 软件归档接口地址，请联系系统配置维护者' }, content_source: 'release_doc_changes' };
    else if (config.url?.endsWith('/oa-archive/records/')) data = savedRecords;
    else if (config.url?.endsWith('/oa-archive/confirm-no-order/')) data = savedRecords[0];
    else if (config.url?.endsWith('/oa-archive/submit/')) {
      data = { id: `application-${savedRecords.length + 1}`, previous_id: payload.previous_id || null, confirmation: payload.confirmation || '', submission_id: payload.submission_id, status: 'success', form: payload.form,
        operator: { username: 'operator' }, source: { task_id: 'task', scope: 'directory', path: '.' }, created_at: '2026-11-12T00:00:00Z',
        software_archive_id: { opaque: ['单据', 7] }, soft_number: 'SOFT-001', number_apply_id: null, message: '已发起归档' };
      savedRecords = [data, ...savedRecords];
    }
    else if (config.url === '/releases/release/') data = { ...release, git_hash: initialForm.sn_code, release_doc: '已保存的发布说明', tag_name: 'V1.2.3', branch: 'main', created_at: '' };
    else if (config.url?.endsWith('/source-reference/')) data = { available: true, reference: 'V1.2.3', reason: '' };
    else if (config.url?.endsWith('/review-issues/')) data = [];
    else throw new Error(`未预期的请求 ${config.url}`);
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data } };
  };
});
afterEach(() => { cleanup(); request.defaults.adapter = adapter; useAuthStore.setState({ user }); });
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ConfigProvider theme={{ token: { motion: false } }}><App><MemoryRouter><ReleasePackages release={release} /></MemoryRouter></App></ConfigProvider></QueryClientProvider>);
}
async function selectArtifact(id = 'one') {
  fireEvent.click(await screen.findByRole('button', { name: '发起 OA 归档' }));
  const select = await screen.findByLabelText('归档目录');
  await waitFor(() => expect((select as HTMLInputElement).disabled).toBe(false));
  fireEvent.mouseDown(select);
  await screen.findByRole('option', { name: /正式安装包/ });
  expect(screen.getAllByRole('option')).toHaveLength(2);
  expect(screen.queryByText('软件一.zip')).toBeNull();
  fireEvent.click(screen.getByRole('option', { name: id === 'one' ? /正式安装包/ : /第二次打包/ }));
  fireEvent.click(screen.getByRole('button', { name: '填写申请资料' }));
  await screen.findByRole('table', { name: '软件归档申请资料' });
}

it('选择一次打包的完整目录并编辑完整资料，多个文件仅提供一个目录选项', async () => {
  mount();
  await selectArtifact();
  expect(requests.find(entry => entry.url?.endsWith('/prepare/'))?.data).not.toHaveProperty('artifact_id');
  await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
  const dialog = screen.getByRole('dialog');
  const content = within(dialog).getByRole('textbox', { name: '变更内容' }) as HTMLTextAreaElement;
  await waitFor(() => expect(content.value).toBe(initialForm.edit_content));
  expect(within(dialog).getByRole('textbox', { name: 'SN' }).getAttribute('value')).toBe(initialForm.sn_code);
  fireEvent.change(within(dialog).getByRole('textbox', { name: /软件名称/ }), { target: { value: '修改后的软件' } });
  fireEvent.change(content, { target: { value: '手填 | 资料\n完整第二行' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '校验资料' }));
  await screen.findByText('资料校验通过，尚未向 OA 发送。');
  const prepared = requests.filter(entry => entry.url?.endsWith('/prepare/'));
  expect(prepared.at(-1)?.data).toMatchObject({ task_id: 'task', scope: 'directory', path: '.', source_kind: 'local', form: { soft_name: '修改后的软件', edit_content: '手填 | 资料\n完整第二行', applyCount: 1, soft_number: '' } });
  expect((screen.getByRole('button', { name: '提交 OA 归档' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByLabelText(/项目编号|项目负责人|项目主管|软件编号/)).toBeNull();
  expect(within(dialog).queryByRole('rowheader', { name: '申请数量' })).toBeNull();
  expect(within(dialog).queryByText(/仅影响本次申请/)).toBeNull();
  expect(requests.every(entry => !entry.url?.includes('ticketscript'))).toBe(true);
});

it('实际发送修改后的资料并重新读取历史，成功后展示完整对象且禁止静默再次发送', async () => {
  configured = true;
  mount();
  await selectArtifact();
  fireEvent.change(screen.getByLabelText(/申请人/), { target: { value: 'oa.manual' } });
  const submitButton = screen.getByRole('button', { name: '提交 OA 归档' });
  fireEvent.click(submitButton);
  fireEvent.click(submitButton);
  await screen.findByText('软件编号：SOFT-001');
  expect(requests.filter(entry => entry.url?.endsWith('/submit/'))).toHaveLength(1);
  expect(requests.find(entry => entry.url?.endsWith('/submit/'))?.data).toMatchObject({ form: { docCreator: 'oa.manual', applyCount: 1 } });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '查看申请资料' }));
  const history = (await screen.findByRole('table', { name: '已提交归档资料' })).closest('[role="dialog"]') as HTMLElement;
  expect(within(history).getByText('oa.manual')).toBeTruthy();
  expect(within(history).getByText(/"opaque"/)).toBeTruthy();
});

it('关闭重开和切换打包目录保留各自草稿，离开页面后丢弃', async () => {
  const view = mount();
  await selectArtifact();
  fireEvent.change(screen.getByLabelText(/软件名称/), { target: { value: '第一份草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '关闭并保留草稿' }));
  await selectArtifact('two');
  await waitFor(() => expect((screen.getByLabelText(/软件名称/) as HTMLInputElement).value).toBe('项目内软件'));
  fireEvent.change(screen.getByLabelText(/软件名称/), { target: { value: '第二份草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '关闭并保留草稿' }));
  await selectArtifact();
  await waitFor(() => expect((screen.getByLabelText(/软件名称/) as HTMLInputElement).value).toBe('第一份草稿'));
  fireEvent.click(screen.getByRole('button', { name: '关闭并保留草稿' }));
  await selectArtifact('two');
  await waitFor(() => expect((screen.getByLabelText(/软件名称/) as HTMLInputElement).value).toBe('第二份草稿'));
  view.unmount();
  mount();
  await selectArtifact('two');
  await waitFor(() => expect((screen.getByLabelText(/软件名称/) as HTMLInputElement).value).toBe('项目内软件'));
});

it('四项必填有字段提示和焦点定位，可选资料留空仍能校验', async () => {
  mount();
  await selectArtifact();
  await waitFor(() => expect((screen.getByLabelText(/软件名称/) as HTMLInputElement).value).toBe('项目内软件'));
  for (const label of ['申请人', '接收人']) fireEvent.change(screen.getByLabelText(new RegExp(label)), { target: { value: ' ' } });
  for (const label of ['软件名称', '软件版本']) fireEvent.change(screen.getByLabelText(new RegExp(label)), { target: { value: ' ' } });
  const count = requests.filter(entry => entry.url?.endsWith('/prepare/')).length;
  fireEvent.click(screen.getByRole('button', { name: '校验资料' }));
  for (const label of ['申请人', '接收人', '软件名称', '软件版本']) await screen.findByText(`请填写${label}`);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/申请人/)));
  expect(requests.filter(entry => entry.url?.endsWith('/prepare/'))).toHaveLength(count);
  fireEvent.change(screen.getByLabelText(/申请人/), { target: { value: 'creator.manual' } });
  fireEvent.change(screen.getByLabelText(/接收人/), { target: { value: 'receiver.manual' } });
  fireEvent.change(screen.getByLabelText(/软件名称/), { target: { value: '软件' } });
  fireEvent.change(screen.getByLabelText(/软件版本/), { target: { value: 'V2' } });
  fireEvent.click(screen.getByRole('button', { name: '校验资料' }));
  await screen.findByText('资料校验通过，尚未向 OA 发送。');
});

it('人员选项使用系统登录名且仍可手填，来源提供内部自制和外购', async () => {
  mount();
  await selectArtifact();
  const creator = screen.getByLabelText(/申请人/);
  fireEvent.mouseDown(creator);
  fireEvent.change(creator, { target: { value: 'account' } });
  fireEvent.click(await screen.findByText('人员显示名（account.login）'));
  expect((creator as HTMLInputElement).value).toBe('account.login');
  fireEvent.change(screen.getByLabelText(/接收人/), { target: { value: 'oa.manual.receiver' } });
  const source = screen.getByLabelText('软件来源');
  fireEvent.mouseDown(source);
  expect(await screen.findByRole('option', { name: '内部自制' })).toBeTruthy();
  fireEvent.click(screen.getByRole('option', { name: '外购' }));
  fireEvent.click(screen.getByRole('button', { name: '校验资料' }));
  await screen.findByText('资料校验通过，尚未向 OA 发送。');
  expect(requests.filter(entry => entry.url?.endsWith('/prepare/')).at(-1)?.data).toMatchObject({ form: { docCreator: 'account.login', developer: 'oa.manual.receiver', soft_source: '外购' } });
});


it('详情切换发布说明标签再返回打包区仍恢复当前目录草稿', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ConfigProvider theme={{ token: { motion: false } }}><App>
    <MemoryRouter initialEntries={['/releases/release']}><Routes><Route path="/releases/:id" element={<ReleaseDetail />} /></Routes></MemoryRouter>
  </App></ConfigProvider></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button', { name: '打包任务' }));
  await selectArtifact();
  fireEvent.change(screen.getByLabelText(/软件名称/), { target: { value: '切标签也保留' } });
  fireEvent.click(screen.getByRole('button', { name: '关闭并保留草稿' }));
  fireEvent.click(screen.getByRole('button', { name: '发布说明' }));
  fireEvent.click(screen.getByRole('button', { name: '打包任务' }));
  await selectArtifact();
  await waitFor(() => expect((screen.getByLabelText(/软件名称/) as HTMLInputElement).value).toBe('切标签也保留'));
});


it('成功后再次申请先提醒，取消不派发，确认生成新申请且不继承自动编号', async () => {
  configured = true;
  mount();
  await selectArtifact();
  fireEvent.click(screen.getByRole('button', { name: '提交 OA 归档' }));
  await screen.findByText('软件编号：SOFT-001');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await selectArtifact();
  expect(screen.queryByLabelText('软件编号')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '提交 OA 归档' }));
  const confirmation = (await screen.findByText('该目录已有已发起归档的记录，请确认仍需再次办理。')).closest('[role="dialog"]') as HTMLElement;
  fireEvent.click(within(confirmation).getByRole('button', { name: /取\s*消/ }));
  expect(requests.filter(entry => entry.url?.endsWith('/submit/'))).toHaveLength(1);
  await waitFor(() => expect(screen.queryByRole('button', { name: '确认再次申请' })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '提交 OA 归档' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认再次申请' }));
  await waitFor(() => expect(requests.filter(entry => entry.url?.endsWith('/submit/'))).toHaveLength(2));
  const sends = requests.filter(entry => entry.url?.endsWith('/submit/')).map(entry => entry.data as Record<string, unknown>);
  expect(sends[1]).toMatchObject({ previous_id: 'application-1', confirmation: 'reapply', form: { soft_number: '' } });
  expect(sends[1].submission_id).not.toBe(sends[0].submission_id);
  await waitFor(() => expect(screen.getAllByRole('button', { name: '查看申请资料' })).toHaveLength(2));
});


it('刷新后的未知申请恢复已发送资料，核对未建单后才能主动重试并保留历史', async () => {
  configured = true;
  savedRecords = [{ id: 'unknown-first', submission_id: 'old-operation', status: 'unknown',
    form: { ...initialForm, soft_number: 'LEGACY-NUMBER', other_description: '已经发送的完整资料\n末行' },
    operator: { username: 'first-actor' }, source: { task_id: 'task', scope: 'directory', path: '.' },
    created_at: '2026-11-12T00:00:00Z', message: '结果未确认', soft_number: '' }];
  mount();
  await selectArtifact();
  await waitFor(() => expect((screen.getByLabelText('其他说明') as HTMLTextAreaElement).value).toBe('已经发送的完整资料\n末行'));
  fireEvent.change(screen.getByLabelText('变更原因'), { target: { value: '人工核对后的修改' } });
  fireEvent.click(screen.getByRole('button', { name: '提交 OA 归档' }));
  const check = await screen.findByRole('checkbox', { name: '我已核对 OA，确认此前申请未建单' });
  const dialog = check.closest('[role="dialog"]') as HTMLElement;
  const retry = within(dialog).getByRole('button', { name: '确认重试' }) as HTMLButtonElement;
  expect(retry.disabled).toBe(true);
  expect(requests.filter(entry => entry.url?.endsWith('/submit/'))).toHaveLength(0);
  fireEvent.click(check);
  expect(retry.disabled).toBe(false);
  fireEvent.click(retry);
  await waitFor(() => expect(requests.filter(entry => entry.url?.endsWith('/submit/'))).toHaveLength(1));
  expect(requests.find(entry => entry.url?.endsWith('/submit/'))?.data).toMatchObject({ previous_id: 'unknown-first', confirmation: 'checked_no_order', form: { edit_reason: '人工核对后的修改', soft_number: '', applyCount: 1 } });
  await waitFor(() => expect(screen.getAllByRole('button', { name: '查看申请资料' })).toHaveLength(2));
});

it('无清单任务只选原 SVN 整个目录，表单明确补录和当前目录依据', async () => {
  historyMode = true;
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '发起 OA 归档' }));
  const tasks = await screen.findByRole('combobox', { name: '归档目录' });
  await waitFor(() => expect((tasks as HTMLInputElement).disabled).toBe(false));
  fireEvent.mouseDown(tasks);
  fireEvent.click(await screen.findByRole('option', { name: /无清单历史任务/ }));
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.queryByRole('button', { name: /进入目录/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '填写申请资料' }));
  await screen.findByRole('table', { name: '软件归档申请资料' });
  await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
  expect(screen.getByText('从 SVN 补录 · 整个产物目录')).toBeTruthy();
  expect(requests.find(item => item.url?.endsWith('/prepare/'))?.data).toEqual({ task_id: 'history', scope: 'directory', path: '.', source_kind: 'svn' });
  expect(requests.some(item => item.url?.includes('svn-artifacts'))).toBe(false);
});


it('维保手机实际详情展示只读归档资料且不提供确认或发送操作', async () => {
  role = 'maintainer';
  savedRecords = [{ id: 'failed-record', status: 'failure', form: initialForm, operator: { username: '归档操作者' }, source: { path: '软件一.zip' }, created_at: '2026-11-12T00:00:00Z', message: 'OA 返回失败', software_archive_id: { opaque: '返回对象' } }];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ConfigProvider theme={{ token: { motion: false } }}><App><MemoryRouter><MaintainerReleaseDetail release={release} /></MemoryRouter></App></ConfigProvider></QueryClientProvider>);
  fireEvent.click(screen.getByRole('tab', { name: '打包任务' }));
  fireEvent.click(await screen.findByRole('button', { name: '查看申请资料' }));
  expect((await screen.findByRole('table', { name: '已提交归档资料' })).textContent).toContain('末尾完整');
  expect(screen.getAllByText(/实际操作者：归档操作者/).length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: '发起 OA 归档' })).toBeNull();
  expect(screen.queryByRole('button', { name: '确认未建单' })).toBeNull();
  expect(requests.filter(item => item.method === 'post')).toEqual([]);
});

it('失败历史可独立核对未建单并保存依据而不重试', async () => {
  savedRecords = [{ id: 'failed-record', status: 'failure', form: initialForm, operator: { username: 'operator' }, source: { path: '软件一.zip' }, created_at: '2026-11-12T00:00:00Z', message: '资料错误' }];
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '确认未建单' }));
  const dialog = screen.getByRole('dialog', { name: '核对失败申请' });
  expect((within(dialog).getByRole('button', { name: '保存核对结果' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(within(dialog).getByLabelText('核对依据'), { target: { value: '已按提交时间核对 OA，未建单' } });
  fireEvent.click(within(dialog).getByRole('checkbox', { name: '我已核对 OA，确认这条失败申请未建单' }));
  fireEvent.click(within(dialog).getByRole('button', { name: '保存核对结果' }));
  await waitFor(() => expect(requests.some(item => item.url?.endsWith('/confirm-no-order/'))).toBe(true));
  expect(requests.find(item => item.url?.endsWith('/confirm-no-order/'))?.data).toMatchObject({ application_id: 'failed-record', confirmation: 'checked_no_order', evidence: '已按提交时间核对 OA，未建单' });
  expect(requests.filter(item => item.url?.endsWith('/submit/'))).toEqual([]);
});


it('默认发布说明页在删除版本旁直接发起完整目录归档', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ConfigProvider theme={{ token: { motion: false } }}><App>
    <MemoryRouter initialEntries={['/releases/release']}><Routes><Route path="/releases/:id" element={<ReleaseDetail />} /></Routes></MemoryRouter>
  </App></ConfigProvider></QueryClientProvider>);
  const action = await screen.findByRole('button', { name: '发起 OA 归档' });
  expect(within(action.closest('[aria-label="发布版本操作"]') as HTMLElement).getByRole('button', { name: '删除版本' })).toBeTruthy();
  fireEvent.click(action);
  await screen.findByRole('dialog', { name: '选择归档目录' });
});


it('旧单文件历史保持文件身份，不继承为整目录的重试或草稿', async () => {
  configured = true;
  savedRecords = [{ id: 'legacy-file', submission_id: 'legacy', status: 'unknown',
    form: { ...initialForm, other_description: '旧单文件资料' }, operator: { username: 'operator' },
    source: { task_id: 'task', path: '软件一.zip', kind: 'svn' }, created_at: '2026-11-12T00:00:00Z' }];
  mount();
  expect(await screen.findByText('结果未确认 · 软件一.zip')).toBeTruthy();
  await selectArtifact();
  await waitFor(() => expect((screen.getByLabelText('其他说明') as HTMLTextAreaElement).value).toBe(''));
  fireEvent.click(screen.getByRole('button', { name: '提交 OA 归档' }));
  await waitFor(() => expect(requests.filter(item => item.url?.endsWith('/submit/'))).toHaveLength(1));
  const submitted = requests.find(item => item.url?.endsWith('/submit/'))?.data;
  expect(submitted).toMatchObject({ task_id: 'task', scope: 'directory', path: '.' });
  expect(submitted).not.toHaveProperty('previous_id');
  await waitFor(() => expect(screen.getAllByRole('button', { name: '查看申请资料' })).toHaveLength(2));
});


it('同名成功打包在目录选项中显示各自时间，选择对应那一次任务', async () => {
  sameTaskNames = true;
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '发起 OA 归档' }));
  const choice = await screen.findByLabelText('归档目录');
  await waitFor(() => expect((choice as HTMLInputElement).disabled).toBe(false));
  fireEvent.mouseDown(choice);
  expect(await screen.findByRole('option', { name: /2026-11-13 08:00:00/ })).toBeTruthy();
  expect(screen.getByRole('option', { name: /2026-11-13 09:00:00/ })).toBeTruthy();
  fireEvent.change(choice, { target: { value: '09:00:00' } });
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
  fireEvent.click(screen.getByRole('option', { name: /2026-11-13 09:00:00/ }));
  fireEvent.click(screen.getByRole('button', { name: '填写申请资料' }));
  await screen.findByRole('table', { name: '软件归档申请资料' });
  expect(requests.find(item => item.url?.endsWith('/prepare/'))?.data).toMatchObject({ task_id: 'task-two', scope: 'directory', path: '.' });
});
