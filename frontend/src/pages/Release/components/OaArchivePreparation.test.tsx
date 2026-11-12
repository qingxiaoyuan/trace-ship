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

const adapter = request.defaults.adapter;
const user = useAuthStore.getState().user;
const requests: { url?: string; method?: string; data: unknown }[] = [];
let role = 'manager';
const release = { id: 'release', project: 'project', repository: 'repo', publisher: 'publisher', version: 'V1.2.3',
  release_type: 'formal', status: 'released', package_tasks: [] } as unknown as Release;
const initialForm = { docCreator: 'operator', applyCount: 1, soft_name: '项目内软件', soft_version: 'V1.2.3', developer: 'publisher',
  soft_source: '', git_svn: '', sn_code: '0123456789abcdef0123456789abcdef01234567',
  edit_content: 'A 人工编辑 | 字面管道\n\n  第二行\n' + '完整内容'.repeat(100) + '末尾完整', edit_reason: '', other_description: '', soft_number: '' };

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }) });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  role = 'manager';
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
    ] };
    else if (config.url?.endsWith('/oa-archive/prepare/')) data = { selection: { task_id: 'task', artifact_id: payload.artifact_id },
      form: payload.form || initialForm, configuration: { configured: false, reason: '尚未配置 OA 软件归档接口地址，请联系系统配置维护者' }, content_source: 'release_doc_changes' };
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
  fireEvent.click(await screen.findByRole('button', { name: '准备 OA 归档' }));
  const select = await screen.findByRole('combobox', { name: '归档产物' });
  await screen.findByRole('option', { name: '正式安装包 / 软件一.zip' });
  fireEvent.change(select, { target: { value: `task:${id}` } });
  fireEvent.click(screen.getByRole('button', { name: '填写申请资料' }));
  await screen.findByRole('table', { name: '软件归档申请资料' });
}

it('从发布打包区选择单个产物并在真实字段表格编辑完整资料，校验不发送 OA', async () => {
  mount();
  await selectArtifact();
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
  expect(prepared.at(-1)?.data).toMatchObject({ task_id: 'task', artifact_id: 'one', form: { soft_name: '修改后的软件', edit_content: '手填 | 资料\n完整第二行', applyCount: 1 } });
  expect(screen.queryByRole('button', { name: /发送|发起归档/ })).toBeNull();
  expect(screen.queryByLabelText(/项目编号|项目负责人|项目主管/)).toBeNull();
  expect(requests.every(entry => !entry.url?.includes('ticketscript'))).toBe(true);
});

it('关闭重开和切换产物保留各自草稿，离开页面后丢弃', async () => {
  const view = mount();
  await selectArtifact();
  fireEvent.change(screen.getByRole('textbox', { name: /软件名称/ }), { target: { value: '第一份草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '关闭并保留草稿' }));
  await selectArtifact('two');
  await waitFor(() => expect((screen.getByRole('textbox', { name: /软件名称/ }) as HTMLInputElement).value).toBe('项目内软件'));
  fireEvent.change(screen.getByRole('textbox', { name: /软件名称/ }), { target: { value: '第二份草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '关闭并保留草稿' }));
  await selectArtifact();
  await waitFor(() => expect((screen.getByRole('textbox', { name: /软件名称/ }) as HTMLInputElement).value).toBe('第一份草稿'));
  fireEvent.click(screen.getByRole('button', { name: '关闭并保留草稿' }));
  await selectArtifact('two');
  await waitFor(() => expect((screen.getByRole('textbox', { name: /软件名称/ }) as HTMLInputElement).value).toBe('第二份草稿'));
  view.unmount();
  mount();
  await selectArtifact('two');
  await waitFor(() => expect((screen.getByRole('textbox', { name: /软件名称/ }) as HTMLInputElement).value).toBe('项目内软件'));
});

it('四项必填有字段提示和焦点定位，可选资料留空仍能校验', async () => {
  mount();
  await selectArtifact();
  await waitFor(() => expect((screen.getByRole('textbox', { name: /软件名称/ }) as HTMLInputElement).value).toBe('项目内软件'));
  for (const label of ['申请人', '接收人']) fireEvent.change(screen.getByRole('combobox', { name: new RegExp(label) }), { target: { value: ' ' } });
  for (const label of ['软件名称', '软件版本']) fireEvent.change(screen.getByRole('textbox', { name: new RegExp(label) }), { target: { value: ' ' } });
  const count = requests.filter(entry => entry.url?.endsWith('/prepare/')).length;
  fireEvent.click(screen.getByRole('button', { name: '校验资料' }));
  for (const label of ['申请人', '接收人', '软件名称', '软件版本']) await screen.findByText(`请填写${label}`);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('combobox', { name: /申请人/ })));
  expect(requests.filter(entry => entry.url?.endsWith('/prepare/'))).toHaveLength(count);
  fireEvent.change(screen.getByRole('combobox', { name: /申请人/ }), { target: { value: 'creator.manual' } });
  fireEvent.change(screen.getByRole('combobox', { name: /接收人/ }), { target: { value: 'receiver.manual' } });
  fireEvent.change(screen.getByRole('textbox', { name: /软件名称/ }), { target: { value: '软件' } });
  fireEvent.change(screen.getByRole('textbox', { name: /软件版本/ }), { target: { value: 'V2' } });
  fireEvent.click(screen.getByRole('button', { name: '校验资料' }));
  await screen.findByText('资料校验通过，尚未向 OA 发送。');
});

it('人员选项使用系统登录名且仍可手填，来源提供内部自制和外购', async () => {
  mount();
  await selectArtifact();
  const creator = screen.getByRole('combobox', { name: /申请人/ });
  fireEvent.mouseDown(creator);
  fireEvent.change(creator, { target: { value: 'account' } });
  fireEvent.click(await screen.findByText('人员显示名（account.login）'));
  expect((creator as HTMLInputElement).value).toBe('account.login');
  fireEvent.change(screen.getByRole('combobox', { name: /接收人/ }), { target: { value: 'oa.manual.receiver' } });
  const source = screen.getByRole('combobox', { name: '软件来源' });
  expect(within(source).getByRole('option', { name: '内部自制' })).toBeTruthy();
  expect(within(source).getByRole('option', { name: '外购' })).toBeTruthy();
  fireEvent.change(source, { target: { value: '外购' } });
  fireEvent.click(screen.getByRole('button', { name: '校验资料' }));
  await screen.findByText('资料校验通过，尚未向 OA 发送。');
  expect(requests.filter(entry => entry.url?.endsWith('/prepare/')).at(-1)?.data).toMatchObject({ form: { docCreator: 'account.login', developer: 'oa.manual.receiver', soft_source: '外购' } });
});


it('详情切换发布说明标签再返回打包区仍恢复当前产物草稿', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ConfigProvider theme={{ token: { motion: false } }}><App>
    <MemoryRouter initialEntries={['/releases/release']}><Routes><Route path="/releases/:id" element={<ReleaseDetail />} /></Routes></MemoryRouter>
  </App></ConfigProvider></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button', { name: '打包任务' }));
  await selectArtifact();
  fireEvent.change(screen.getByRole('textbox', { name: /软件名称/ }), { target: { value: '切标签也保留' } });
  fireEvent.click(screen.getByRole('button', { name: '关闭并保留草稿' }));
  fireEvent.click(screen.getByRole('button', { name: '发布说明' }));
  fireEvent.click(screen.getByRole('button', { name: '打包任务' }));
  await selectArtifact();
  await waitFor(() => expect((screen.getByRole('textbox', { name: /软件名称/ }) as HTMLInputElement).value).toBe('切标签也保留'));
});
