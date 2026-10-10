import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import request from '@/api/request';
import ReleaseCreate from './Create';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(window, 'matchMedia', {
    writable: true, value: vi.fn().mockImplementation(() => ({
      matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
    })),
  });
  request.defaults.adapter = async (config) => ({
    config, status: 200, statusText: 'OK', headers: {},
    data: { code: 0, data: { results: [], total: 0 } },
  });
});
afterEach(cleanup);

it('正式发布选择 RC，切换 RC 或 Beta 后才出现分支字段', async () => {
  render(<App><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ReleaseCreate /></MemoryRouter>
  </QueryClientProvider></App>);
  expect(await screen.findByText('来源 RC')).toBeTruthy();
  expect(screen.queryByText('分支', { selector: 'label' })).toBeNull();
  fireEvent.click(screen.getByText('RC', { exact: true }));
  expect(await screen.findByText('分支', { selector: 'label' })).toBeTruthy();
  expect(screen.queryByText('来源 RC')).toBeNull();
});

it('选择 RC 后切换项目清空来源和版本，不能提交旧来源', async () => {
  request.defaults.adapter = async (config) => {
    let data: unknown = { results: [], total: 0 };
    if (config.url === '/projects/') data = { results: [{ id: 'p1', name: '项目一' }, { id: 'p2', name: '项目二' }] };
    if (config.url?.includes('/components/')) data = [{ repository: 'r1', is_active: true, repository_detail: { name: '仓库一' } }];
    if (config.url === '/releases/rc-candidates/') data = { total: 1, results: [{ id: 'rc1', version: 'VA.9.0.0', tag_name: 'VA.9.0.0-rc', branch: 'develop', git_hash: 'a'.repeat(40), available: true }] };
    if (config.url?.includes('next-version')) data = { next_tag_name: 'VA.1.0.0' };
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data } };
  };
  render(<App><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ReleaseCreate /></MemoryRouter>
  </QueryClientProvider></App>);
  fireEvent.mouseDown(screen.getByLabelText('项目'));
  fireEvent.click(await screen.findByText('项目一'));
  fireEvent.mouseDown(screen.getByLabelText('目标仓库'));
  fireEvent.click(await screen.findByText('仓库一'));
  fireEvent.click(await screen.findByRole('radio', { name: /VA.9.0.0/ }));
  expect(await screen.findByDisplayValue('VA.1.0.0')).toBeTruthy();
  fireEvent.mouseDown(screen.getByLabelText('项目'));
  fireEvent.click(await screen.findByText('项目二'));
  await waitFor(() => expect(screen.queryByRole('radio', { name: /VA.9.0.0/ })).toBeNull());
  expect(screen.queryByDisplayValue('VA.1.0.0')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '创建发布' }));
  expect(await screen.findByText('请选择已发布 RC')).toBeTruthy();
});

it('创建请求进行中锁定项目、仓库、类型和 RC，避免旧响应覆盖新来源', async () => {
  let finish: (() => void) | undefined;
  request.defaults.adapter = async (config) => {
    let data: unknown = { results: [], total: 0 };
    if (config.url === '/projects/') data = { results: [{ id: 'p', name: '项目' }] };
    if (config.url?.includes('/components/')) data = [{ repository: 'r', is_active: true, repository_detail: { name: '仓库' } }];
    if (config.url === '/releases/rc-candidates/') data = { total: 1, results: [{ id: 'rc', version: 'VA.9.0.0', tag_name: 'VA.9.0.0-rc', git_hash: 'a'.repeat(40), available: true }] };
    if (config.url?.includes('next-version')) data = { next_tag_name: 'VA.1.0.0' };
    if (config.url === '/releases/' && config.method === 'post') {
      expect(JSON.parse(config.data).source_rc).toBe('rc');
      return new Promise((resolve) => {
        finish = () => resolve({ config, status: 201, statusText: 'OK', headers: {}, data: { code: 0, data: { id: 'created', version: 'VA.1.0.0' } } });
      });
    }
    if (config.url?.endsWith('generate-doc/')) data = '| 项目 | 内容 |\n|---|---|\n| 当前发布版本号 | VA.1.0.0 |';
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data } };
  };
  render(<App><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ReleaseCreate /></MemoryRouter>
  </QueryClientProvider></App>);
  fireEvent.mouseDown(screen.getByLabelText('项目'));
  fireEvent.click(await screen.findByText('项目', { selector: '.ant-select-item-option-content' }));
  fireEvent.mouseDown(screen.getByLabelText('目标仓库'));
  fireEvent.click(await screen.findByText('仓库', { selector: '.ant-select-item-option-content' }));
  fireEvent.click(await screen.findByRole('radio', { name: /VA.9.0.0/ }));
  fireEvent.click(screen.getByRole('button', { name: '创建发布' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  await waitFor(() => expect((screen.getByRole('combobox', { name: '项目' }) as HTMLInputElement).disabled).toBe(true));
  expect((screen.getByLabelText('目标仓库') as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: /^RC / }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('radio', { name: /VA.9.0.0/ }) as HTMLInputElement).disabled).toBe(true);
  await act(async () => finish?.());
  expect(await screen.findByText('发布草稿创建成功')).toBeTruthy();
});

it('正式累计说明保留第十二条更新，身份只读，允许补充人工说明', async () => {
  const release = { id: 'formal', release_type: 'formal', source_rc: 'rc', version: 'VA.1.0.0', changes_initialized: true };
  const doc = '| 字段 | 内容 |\n|---|---|\n| 当前发布版本号 | VA.1.0.0 |\n| Git提交hash | 固定来源SHA |\n| 正式基线 | VA.0.9.0 |\n| 变更内容 | ' + Array.from({ length: 12 }, (_, i) => `A 累计功能${i + 1}`).join('\n') + ' |';
  let saved = '';
  let submissions = 0;
  request.defaults.adapter = async (config) => {
    let data: unknown = { results: [], total: 0 };
    if (config.url === '/projects/') data = { results: [{ id: 'p', name: '项目' }] };
    if (config.url?.includes('/components/')) data = [{ repository: 'r', is_active: true, repository_detail: { name: '仓库' } }];
    if (config.url === '/releases/rc-candidates/') data = { total: 1, results: [{ id: 'rc', version: 'VA.9.0.0', tag_name: 'VA.9.0.0-rc', available: true }] };
    if (config.url?.includes('next-version')) data = { next_tag_name: 'VA.1.0.0' };
    if (config.url === '/releases/' || config.url === '/releases/formal/') data = release;
    if (config.url?.endsWith('generate-doc/')) data = doc;
    if (config.url?.endsWith('changes-preview/')) data = { base_tag: 'VA.0.9.0', commits: [], merge_requests: [], warnings: [] };
    if (config.url?.endsWith('submit-audit/')) {
      submissions += 1;
      return {config, status: 200, statusText: 'OK', headers: {}, data: {code: 40002, message: submissions === 1 ? '已有同版本在发布' : '正式流程没有有效审批人'}};
    }
    if (config.url?.endsWith('update-doc/')) { saved = JSON.parse(config.data).release_doc; data = release; }
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data } };
  };
  render(<App><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ReleaseCreate /></MemoryRouter>
  </QueryClientProvider></App>);
  fireEvent.mouseDown(screen.getByLabelText('项目'));
  fireEvent.click(await screen.findByText('项目', { selector: '.ant-select-item-option-content' }));
  fireEvent.mouseDown(screen.getByLabelText('目标仓库'));
  fireEvent.click(await screen.findByText('仓库', { selector: '.ant-select-item-option-content' }));
  fireEvent.click(await screen.findByRole('radio', { name: /VA.9.0.0/ }));
  fireEvent.click(screen.getByRole('button', { name: '创建发布' }));
  const notes = await screen.findByRole('textbox') as HTMLTextAreaElement;
  expect(notes.value).toContain('累计功能12');
  expect(screen.queryByDisplayValue('固定来源SHA')).toBeNull();
  expect(screen.getByText('固定来源SHA')).toBeTruthy();
  fireEvent.change(notes, { target: { value: notes.value + '\n人工补充' } });
  fireEvent.click(screen.getByRole('button', { name: '保存编辑' }));
  await waitFor(() => expect(saved).toContain('人工补充'));
  expect(saved).toContain('累计功能12');
  expect(saved).toContain('| Git提交hash | 固定来源SHA |');
  fireEvent.click(screen.getByRole('button', {name: '提交审批'}));
  expect(await screen.findByText('已有同版本在发布', {selector: 'p[role=alert]'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name: '提交审批'}));
  expect(await screen.findByText('正式流程没有有效审批人', {selector: '[role=alert]'})).toBeTruthy();
  expect(submissions).toBe(2);
});
