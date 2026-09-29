import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useModalDraft } from './useModalDraft';

describe('useModalDraft', () => {
  it('关闭后重开同一对象时恢复草稿', async () => {
    const { result, rerender } = renderHook(
      ({ open, key }: { open: boolean; key: string }) =>
        useModalDraft(open, key, () => ({ title: `初始-${key}` })),
      { initialProps: { open: true, key: 'project-1' } },
    );

    await waitFor(() => expect(result.current.value).toEqual({ title: '初始-project-1' }));
    act(() => result.current.save({ title: '未保存标题' }));
    rerender({ open: false, key: 'project-1' });
    rerender({ open: true, key: 'project-1' });

    await waitFor(() => expect(result.current.value).toEqual({ title: '未保存标题' }));
  });

  it('切换编辑对象后仍能恢复各自草稿', async () => {
    const { result, rerender } = renderHook(
      ({ open, key }: { open: boolean; key: string }) =>
        useModalDraft(open, key, () => ({ title: `初始-${key}` })),
      { initialProps: { open: true, key: 'project-1' } },
    );

    await waitFor(() => expect(result.current.value).toEqual({ title: '初始-project-1' }));
    act(() => result.current.save({ title: '项目一草稿' }));
    rerender({ open: false, key: 'project-1' });
    rerender({ open: true, key: 'project-2' });

    await waitFor(() => expect(result.current.value).toEqual({ title: '初始-project-2' }));
    act(() => result.current.save({ title: '项目二草稿' }));
    rerender({ open: false, key: 'project-2' });
    rerender({ open: true, key: 'project-1' });

    await waitFor(() => expect(result.current.value).toEqual({ title: '项目一草稿' }));
  });

  it('清除当前对象草稿时保留其他对象', async () => {
    const { result, rerender } = renderHook(
      ({ open, key }: { open: boolean; key: string }) =>
        useModalDraft(open, key, () => ({ title: `初始-${key}` })),
      { initialProps: { open: true, key: 'project-1' } },
    );

    await waitFor(() => expect(result.current.value).toEqual({ title: '初始-project-1' }));
    act(() => result.current.save({ title: '项目一草稿' }));
    rerender({ open: false, key: 'project-1' });
    rerender({ open: true, key: 'project-2' });
    await waitFor(() => expect(result.current.value).toEqual({ title: '初始-project-2' }));
    act(() => {
      result.current.save({ title: '项目二草稿' });
      result.current.clear();
    });
    rerender({ open: false, key: 'project-2' });
    rerender({ open: true, key: 'project-1' });
    await waitFor(() => expect(result.current.value).toEqual({ title: '项目一草稿' }));
    rerender({ open: false, key: 'project-1' });
    rerender({ open: true, key: 'project-2' });
    await waitFor(() => expect(result.current.value).toEqual({ title: '初始-project-2' }));
  });

  it('清除草稿后再次打开时使用初始值', async () => {
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useModalDraft(open, 'project-1', () => ({ title: '初始值' })),
      { initialProps: { open: true } },
    );

    await waitFor(() => expect(result.current.value).toEqual({ title: '初始值' }));
    act(() => {
      result.current.save({ title: '已保存草稿' });
      result.current.clear();
    });
    rerender({ open: false });
    rerender({ open: true });

    await waitFor(() => expect(result.current.value).toEqual({ title: '初始值' }));
  });

  it('组件卸载后不保留页面草稿', async () => {
    const first = renderHook(() => useModalDraft(true, 'project-1', () => ({ title: '初始值' })));
    await waitFor(() => expect(first.result.current.value).toEqual({ title: '初始值' }));
    act(() => first.result.current.save({ title: '页面内草稿' }));
    first.unmount();

    const second = renderHook(() => useModalDraft(true, 'project-1', () => ({ title: '初始值' })));
    await waitFor(() => expect(second.result.current.value).toEqual({ title: '初始值' }));
  });
});
