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
