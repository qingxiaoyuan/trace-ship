import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import request from '@/api/request';
import { ReviewSettingsCard } from './ReviewSettingsCard';

afterEach(cleanup);

it('复用共享模型且仅保存技能，不再提供重复模型和密钥编辑项', async () => {
  const saves: Record<string, string>[] = [];
  const current = { version_id: 'v1', endpoint: 'https://shared.example/v1', model: 'shared-model', protocol: 'openai', has_api_key: true, skill: { name: 'code-review-expert', revision: 'abc', source: 'https://example.com', license: 'MIT', files: [] } };
  request.defaults.adapter = async config => {
    if (config.method === 'put') saves.push(JSON.parse(config.data));
    const data = config.url === '/system/review-skills/' ? [] : current;
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data } };
  };
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App><ReviewSettingsCard /></App></QueryClientProvider>);
  await screen.findByText('shared-model');
  expect(screen.queryByLabelText('模型名称')).toBeNull();
  expect(screen.queryByLabelText('服务地址')).toBeNull();
  expect(screen.queryByLabelText('API 密钥')).toBeNull();
  expect(screen.getByRole('link', { name: '前往模型设置' }).getAttribute('href')).toBe('#ai-model-service');
  fireEvent.click(screen.getByRole('button', { name: '保存审查配置' }));
  await waitFor(() => expect(saves).toEqual([{ skill: 'code-review-expert' }]));
});

it('上传技能后可查看文件清单并选择保存', async () => {
  let submitted: Record<string, string> | undefined;
  request.defaults.adapter = async config => {
    let data: unknown;
    if (config.url === '/system/review-skills/' && config.method === 'get') data = [];
    else if (config.url === '/system/review-skills/' && config.method === 'post') data = { id: 'skill-1', name: '安全审查', files: ['SKILL.md', 'references/check.md'], created_at: '2026-10-28' };
    else if (config.method === 'put') {
      submitted = JSON.parse(config.data);
      data = { version_id: 'v2', endpoint: 'https://review.example/v1', model: 'model', protocol: 'openai', has_api_key: false, skill: { name: '安全审查', revision: 'skill-1', source: '', license: '', files: ['SKILL.md', 'references/check.md'] } };
    } else data = { version_id: 'v1', endpoint: 'https://review.example/v1', model: 'model', protocol: 'openai', has_api_key: false, skill: { name: 'code-review-expert', revision: 'abc', source: 'https://example.com', license: 'MIT', files: [] } };
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data } };
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><App><ReviewSettingsCard /></App></QueryClientProvider>);
  await screen.findByText('model');
  fireEvent.change(screen.getByLabelText('上传审查技能'), { target: { files: [new File(['# 安全'], 'SKILL.md', { type: 'text/markdown' })] } });
  await screen.findByText(/references\/check.md/);
  fireEvent.click(screen.getByRole('button', { name: '保存审查配置' }));
  await waitFor(() => expect(submitted?.skill).toBe('skill-1'));
});

it('技能校验失败时显示具体原因', async () => {
  request.defaults.adapter = async config => {
    if (config.url === '/system/review-skills/' && config.method === 'post') {
      throw { isAxiosError: true, response: { status: 400, data: { code: 40000, message: '参数错误', data: { file: ['引用文档不存在：missing.md'] } } }, config };
    }
    const data = config.url === '/system/review-skills/' ? [] : { version_id: null, endpoint: '', model: '', protocol: 'auto', has_api_key: false, skill: { name: 'code-review-expert', revision: 'abc', source: 'https://example.com', license: 'MIT', files: [] } };
    return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data } };
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><App><ReviewSettingsCard /></App></QueryClientProvider>);
  fireEvent.change(screen.getByLabelText('上传审查技能'), { target: { files: [new File(['bad'], 'SKILL.md')] } });
  expect(await screen.findByText('引用文档不存在：missing.md')).toBeTruthy();
});
