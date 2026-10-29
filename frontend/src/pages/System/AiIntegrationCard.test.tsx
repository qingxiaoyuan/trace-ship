import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import request from '@/api/request';
import { AiIntegrationCard } from './AiIntegrationCard';

afterEach(cleanup);

it.each([undefined, 'replacement-key', ''])('切换共享模型以一次请求保存完整配置，密钥编辑值为 %s', async (key) => {
  const writes: { method?: string; url?: string; data: Record<string, string> }[] = [];
  request.defaults.adapter = async config => {
    if (config.method !== 'get') writes.push({ method: config.method, url: config.url, data: JSON.parse(config.data || '{}') });
    const data = config.method === 'get' ? { count: 4, results: Object.entries({ endpoint: 'https://old.example/v1', api_key: 'private-key', model: 'old-model', protocol: 'openai' }).map(([field, value]) => ({ key: `ai_${field}`, value })) } : null;
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data } };
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><App><AiIntegrationCard /></App></QueryClientProvider>);
  await waitFor(() => expect((screen.getByLabelText('模型名称') as HTMLInputElement).value).toBe('old-model'));
  fireEvent.change(screen.getByLabelText(/^服务地址/), { target: { value: 'https://new.example/v1' } });
  fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'new-model' } });
  fireEvent.change(screen.getByLabelText('协议'), { target: { value: 'anthropic' } });
  if (key !== undefined) fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: key } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toEqual({ method: 'put', url: '/system/ai-settings/', data: {
    endpoint: 'https://new.example/v1', model: 'new-model', protocol: 'anthropic',
    manifest_chars: '32768', tree_chars: '15000', knowledge_chars: '12000', exemplar_chars: '12000', max_tokens: '16384',
    ...(key === undefined ? {} : { api_key: key }),
  } });
  expect(JSON.stringify(writes)).not.toContain('private-key');
  expect(JSON.stringify(writes)).not.toContain('••••');
});
