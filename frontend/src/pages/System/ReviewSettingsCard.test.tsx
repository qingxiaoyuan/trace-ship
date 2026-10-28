import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import request from '@/api/request';
import { ReviewSettingsCard } from './ReviewSettingsCard';

afterEach(cleanup);

it('审查配置保存后可重新读取，未修改的密钥不会被覆盖', async () => {
  const saves: Record<string, string>[] = [];
  let current = { version_id: 'v1', endpoint: 'https://review.example/v1', model: 'old', protocol: 'openai', has_api_key: true, skill: { name: 'code-review-expert', revision: 'abc', source: 'https://example.com', license: 'MIT', files: [] } };
  request.defaults.adapter = async config => {
    if (config.method === 'put') {
      const payload = JSON.parse(config.data);
      saves.push(payload);
      current = { ...current, ...payload, version_id: 'v2' };
    }
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: current } };
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><App><ReviewSettingsCard /></App></QueryClientProvider>);
  await screen.findByDisplayValue('old');
  fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'new' } });
  fireEvent.click(screen.getByRole('button', { name: '保存审查配置' }));
  await waitFor(() => expect(saves).toHaveLength(1));
  expect(saves[0]).toMatchObject({ model: 'new', skill: 'code-review-expert' });
  expect(saves[0]).not.toHaveProperty('api_key');
  await screen.findByDisplayValue('new');
  fireEvent.click(screen.getByRole('button', { name: '清除已保存密钥' }));
  fireEvent.click(screen.getByRole('button', { name: '保存审查配置' }));
  await waitFor(() => expect(saves).toHaveLength(2));
  expect(saves[1].api_key).toBe('');
});
