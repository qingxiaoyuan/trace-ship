import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError } from 'axios';
import request, { registerErrorNotifier } from './request';
import { packageApi } from './package';

const originalAdapter = request.defaults.adapter;

afterEach(() => { request.defaults.adapter = originalAdapter; registerErrorNotifier(() => {}); vi.restoreAllMocks(); });

describe('打包文件下载错误', () => {
  beforeEach(() => localStorage.clear());

  it('二进制下载失败时保留 JSON 错误中的产物过期原因', async () => {
    const notify = vi.fn();
    registerErrorNotifier(notify);
    request.defaults.adapter = async (config) => {
      expect(config.url).toBe('/packages/tasks/task/artifacts/file/download/');
      expect(config.responseType).toBe('blob');
      throw new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, undefined, {
        config, status: 404, statusText: 'Not Found', headers: {},
        data: new Blob([JSON.stringify({ code: 40400, message: '产物文件不存在或已清理' })], { type: 'application/json' }),
      });
    };
    await expect(packageApi.downloadArtifact('task', 'file')).rejects.toMatchObject({
      status: 404, friendlyMessage: '产物文件不存在或已清理',
    });
    expect(notify).toHaveBeenCalledWith('产物文件不存在或已清理');
  });

  it.each([
    ['批量文件全部失效', () => packageApi.downloadAllArtifacts('task'), 404, '没有可下载的有效产物文件'],
    ['批量文件部分失效', () => packageApi.downloadAllArtifacts('task'), 404, '部分产物文件不存在或已清理，请逐个下载仍可用的产物'],
    ['完整日志被清理', () => packageApi.getTaskLog('task'), 404, '日志未生成或已清理'],
    ['不可见产物', () => packageApi.downloadArtifact('task', 'private-file'), 403, '无权读取这个任务的产物'],
  ] as const)('%s 保留真实原因且反馈失败', async (_name, download, status, message) => {
    const notify = vi.fn();
    registerErrorNotifier(notify);
    request.defaults.adapter = async (config) => {
      throw new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, undefined, {
        config, status, statusText: 'Error', headers: {},
        data: new Blob([JSON.stringify({ code: status * 100, message })], { type: 'application/json; charset=utf-8' }),
      });
    };
    await expect(download()).rejects.toMatchObject({ status, friendlyMessage: message });
    expect(notify).toHaveBeenCalledWith(message);
  });

  it('非 JSON 网关错误仍按 HTTP 状态反馈，网络中断有明确提示', async () => {
    request.defaults.adapter = async (config) => {
      throw new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, undefined, {
        config, status: 503, statusText: 'Unavailable', headers: {},
        data: new Blob(['<html>gateway unavailable</html>'], { type: 'text/html' }),
      });
    };
    await expect(packageApi.downloadAllArtifacts('task')).rejects.toMatchObject({
      status: 503, friendlyMessage: '服务暂时不可用，请稍后重试',
    });
    request.defaults.adapter = async (config) => { throw new AxiosError('Network Error', 'ERR_NETWORK', config); };
    await expect(packageApi.getTaskLog('task')).rejects.toMatchObject({
      friendlyMessage: '网络异常，请检查网络连接',
    });
  });
});
