import { useCallback, useEffect, useRef, useState } from 'react';

interface ModalDraft<T> {
  key: string;
  value: T;
}

/**
 * 按 draftKey 把弹窗草稿留在本组件内存里。
 * 切换对象不会丢掉另一个对象的草稿；clear 只删除当前 key。
 * 组件卸载后全部丢弃。凭证口令同样只留在内存，直到 clear 或卸载。
 */
export function useModalDraft<T>(
  open: boolean,
  draftKey: string,
  getInitialValue: () => T,
) {
  const draftsRef = useRef<Map<string, T>>(new Map());
  const activeKeyRef = useRef<string | null>(null);
  const wasOpenRef = useRef(false);
  const [session, setSession] = useState<ModalDraft<T> | null>(null);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }

    if (wasOpenRef.current && activeKeyRef.current === draftKey) return;

    activeKeyRef.current = draftKey;
    wasOpenRef.current = true;
    const saved = draftsRef.current.get(draftKey);
    setSession({
      key: draftKey,
      value: saved === undefined ? getInitialValue() : saved,
    });
  }, [open, draftKey, getInitialValue]);

  const save = useCallback((value: T) => {
    const key = activeKeyRef.current;
    if (!key) return;
    draftsRef.current.set(key, value);
  }, []);

  const clear = useCallback(() => {
    const key = activeKeyRef.current;
    if (!key) return;
    draftsRef.current.delete(key);
  }, []);

  return {
    value: session?.key === draftKey ? session.value : undefined,
    save,
    clear,
  };
}
