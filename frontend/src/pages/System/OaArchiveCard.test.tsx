import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import request from '@/api/request';
import { OaArchiveCard } from './OaArchiveCard';

const originalAdapter = request.defaults.adapter;
afterEach(() => { cleanup(); request.defaults.adapter = originalAdapter; });

it('独立配置卡片维护完整归档地址并清楚提示未配置状态', async () => {
  const saves: unknown[] = [];
  let url = '';
  request.defaults.adapter = async config => {
    if (config.method === 'put') { saves.push(JSON.parse(config.data)); url = JSON.parse(config.data).url; }
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: { url } } };
  };
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App><OaArchiveCard /></App></QueryClientProvider>);
  await screen.findByText('尚未配置归档接口，申请资料可先准备，不能发送 OA。');
  const input = screen.getByRole('textbox', { name: '归档接口完整地址' });
  fireEvent.change(input, { target: { value: 'https://oa.example.com/api/v1/ticketscript/create_software_archive_with_number' } });
  fireEvent.click(screen.getByRole('button', { name: '保存归档配置' }));
  await waitFor(() => expect(saves).toEqual([{ url: 'https://oa.example.com/api/v1/ticketscript/create_software_archive_with_number' }]));
  expect(screen.queryByLabelText(/token|令牌|密钥/i)).toBeNull();
});
