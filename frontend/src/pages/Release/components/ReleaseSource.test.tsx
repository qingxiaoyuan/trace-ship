import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import request from '@/api/request';
import type { Release } from '@/types';
import { ReleaseSource } from './ReleaseSource';

const originalAdapter = request.defaults.adapter;

afterEach(() => { cleanup(); request.defaults.adapter = originalAdapter; });
it.each([true, false])('正式版详情保留来源 RC 与源码引用可用性（可用=%s）', async (available) => {
  request.defaults.adapter = async config => ({config, status:200, statusText:'OK', headers:{},
    data:{code:0,data:{available,reference:available?'VA.1.0.0':'',reason:available?'':'没有有效的关联正式引用'}}});
  const release = {id:'formal', project:'p', repository:'r', release_type:'formal', status:'released',
    source_rc:'rc', source_rc_version:'VA.1.0.0-rc', source_rc_tag:'VA.1.0.0-rc_20261021'} as Release;
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><ReleaseSource release={release} /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByText(available?'当前源码引用：VA.1.0.0':'没有有效的关联正式引用')).toBeTruthy();
  expect(screen.getByRole('link', {name:'VA.1.0.0-rc · VA.1.0.0-rc_20261021'}).getAttribute('href')).toBe('/releases/rc');
});

it('按分支创建的正式草稿展示分支和提交，不引导补选 RC', () => {
  const release = { id: 'formal', release_type: 'formal', status: 'draft', branch: 'develop', git_hash: 'a'.repeat(40) } as Release;
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ReleaseSource release={release} /></MemoryRouter></QueryClientProvider>);
  expect(screen.getByText('分支：develop')).toBeTruthy();
  expect(screen.getByText('a'.repeat(40))).toBeTruthy();
  expect(screen.queryByText('来源 RC')).toBeNull();
  expect(screen.queryByRole('button', { name: '重选来源 RC' })).toBeNull();
});

it('发布人预览新旧提交与代码差异并确认更新草稿', async () => {
  const oldHash = 'a'.repeat(40), newHash = 'b'.repeat(40);
  let confirmed: unknown;
  request.defaults.adapter = async config => {
    if (config.method === 'post') confirmed = JSON.parse(config.data);
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: config.method === 'post'
      ? { id: 'r', git_hash: newHash, release_doc: '' }
      : { old_hash: oldHash, new_hash: newHash, commits: [{ hash: newHash, message: '修复问题', author: '开发' }],
          diffs: [{ old_path: 'app.py', new_path: 'app.py', diff: '-旧代码\n+新代码' }] } } };
  };
  const release = { id: 'r', release_type: 'rc', status: 'draft', branch: 'develop', git_hash: oldHash } as Release;
  const { fireEvent, waitFor } = await import('@testing-library/react');
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><ReleaseSource release={release} canRefresh /></MemoryRouter></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: '更新到分支最新提交' }));
  expect(await screen.findByText(`最新提交：${newHash}`)).toBeTruthy();
  expect(screen.getByText('-旧代码 +新代码').textContent).toBe('-旧代码\n+新代码');
  fireEvent.click(screen.getByRole('button', { name: '确认更新' }));
  await waitFor(() => expect(confirmed).toEqual({ old_hash: oldHash, new_hash: newHash }));
});
