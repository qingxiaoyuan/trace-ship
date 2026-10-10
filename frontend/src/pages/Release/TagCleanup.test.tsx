import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import request from '@/api/request';
import TagCleanup from './TagCleanup';

afterEach(cleanup);
it('批量确认仅清理远端 Tag，混合结果按项显示并只重试失败项', async () => {
  const batches: string[][] = [];
  request.defaults.adapter = async config => {
    let data: unknown = { total: 0, results: [] };
    if (config.url === '/projects/') data = { results: [{ id:'p', name:'测试项目' }] };
    if (config.url?.endsWith('/components/')) data = [{ repository:'r', is_active:true, repository_detail:{ name:'测试仓库' } }];
    if (config.url?.endsWith('/cleanup-candidates/')) data = { total:2, results:['rc1','rc2'].map(id => ({id,tag_name:id,allowed:true,protected_by:'formal1'})) };
    if (config.url?.endsWith('/cleanup-tags/')) {
      const ids = JSON.parse(config.data).items.map((item: {id: string}) => item.id);
      batches.push(ids);
      data = ids.map((id: string) => ({id,status:id==='rc2' && batches.length===1 ? 'failure' : 'success',reason:id==='rc2' ? '网络故障' : ''}));
    }
    return {config,status:200,statusText:'OK',headers:{},data:{code:0,data}};
  };
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><TagCleanup /></MemoryRouter></QueryClientProvider>);
  await screen.findByRole('option',{name:'测试项目'});
  fireEvent.change(screen.getByLabelText('项目'),{target:{value:'p'}});
  await screen.findByRole('option',{name:'测试仓库'});
  fireEvent.change(screen.getByLabelText('仓库'),{target:{value:'r'}});
  fireEvent.click(await screen.findByRole('checkbox',{name:'选择 rc1'}));
  fireEvent.click(screen.getByRole('checkbox',{name:'选择 rc2'}));
  fireEvent.click(screen.getByRole('button',{name:'预览清理 2 项'}));
  expect(screen.getByText(/仅删除远端 RC Tag/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'确认清理'}));
  await screen.findByText('网络故障');
  expect(screen.getByText('成功 1 项，失败或阻止 1 项')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'重试失败项'}));
  fireEvent.click(screen.getByRole('button',{name:'确认清理'}));
  await waitFor(()=>expect(batches).toEqual([['rc1','rc2'],['rc2']]));
});

it('预览后资格失效逐项显示阻止原因，不宣称已清理', async () => {
  request.defaults.adapter = async config => {
    let data: unknown = [];
    if (config.url === '/projects/') data = {results: []};
    if (config.url?.endsWith('/cleanup-candidates/')) data = {total: 1, results: [{id:'rc', tag_name:'rc-tag', allowed:true, protected_by:'formal-tag'}]};
    if (config.url?.endsWith('/cleanup-tags/')) data = [{id:'rc', status:'blocked', reason:'该引用仍被排队或运行中的打包任务使用'}];
    return {config,status:200,statusText:'OK',headers:{},data:{code:0,data}};
  };
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={['/?project=p&repository=r']}><TagCleanup /></MemoryRouter></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('checkbox', {name:'选择 rc-tag'}));
  fireEvent.click(screen.getByRole('button', {name:'预览清理 1 项'}));
  fireEvent.click(screen.getByRole('button', {name:'确认清理'}));
  expect(await screen.findByText('该引用仍被排队或运行中的打包任务使用')).toBeTruthy();
  expect(screen.getByText('成功 0 项，失败或阻止 1 项')).toBeTruthy();
  expect(screen.queryByText('清理成功')).toBeNull();
});
