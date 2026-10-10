import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import request from '@/api/request';
import type { Release } from '@/types';
import { ReleaseSource } from './ReleaseSource';

afterEach(cleanup);
it.each([true, false])('RC 详情展示替代引用可用性与中文清理审计（可用=%s）', async (available) => {
  request.defaults.adapter = async config => ({config, status:200, statusText:'OK', headers:{},
    data:{code:0,data:{available,reference:available?'VA.1.0.0':'',reason:available?'':'没有有效的关联正式引用'}}});
  const release = {id:'rc', project:'p', repository:'r', release_type:'rc', status:'released', tag_cleanup_status:'cleaned',
    cleanup_history:[{status:'success',created_at:'2026-10-10',message:'',actor_id:'u',actor_name:'测试管理员',protected_by:'VA.1.0.0'}]} as Release;
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><ReleaseSource release={release} /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByText(available?'当前源码引用：VA.1.0.0':'没有有效的关联正式引用')).toBeTruthy();
  expect(screen.getByText(/清理成功.*测试管理员/)).toBeTruthy();
  expect(screen.getByText('清理状态：平台已清理')).toBeTruthy();
});
