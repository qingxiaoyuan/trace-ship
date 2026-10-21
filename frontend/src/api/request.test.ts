import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError } from 'axios';
import { dashboardApi } from './dashboard';
import request, { registerErrorNotifier } from './request';

const originalAdapter = request.defaults.adapter;

beforeEach(() => localStorage.clear());

afterEach(() => {
  request.defaults.adapter = originalAdapter;
  registerErrorNotifier(() => {});
  vi.restoreAllMocks();
});

describe('请求取消与网络错误提示', () => {
  it('权限查询被取消时保留取消结果且不提示网络异常', async () => {
    const notify = vi.fn();
    registerErrorNotifier(notify);
    const controller = new AbortController();
    controller.abort();

    const error = await dashboardApi.getContext(controller.signal).catch((reason: unknown) => reason);

    expect(axios.isCancel(error)).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  it('真实网络故障仍展示全局错误提示', async () => {
    const notify = vi.fn();
    registerErrorNotifier(notify);
    request.defaults.adapter = async (config) => {
      throw new AxiosError('Network Error', 'ERR_NETWORK', config);
    };

    await expect(dashboardApi.getContext()).rejects.toMatchObject({
      friendlyMessage: '网络异常，请检查网络连接',
    });
    expect(notify).toHaveBeenCalledWith('网络异常，请检查网络连接');
  });
});
