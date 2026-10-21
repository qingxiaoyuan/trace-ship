import { useSyncExternalStore } from 'react';
import { usePageScroll } from './usePageScroll';

const idleSubscribe = () => () => {};
const initialSnapshot = () => false;

/** 归属栏开始吸顶时切换为 Penpot 13；按概要与归属栏的实际高度判断。 */
export function useCompactReleaseHeader(enabled = true) {
  const { subscribe, getScrollTop, getCompactScrollTop } = usePageScroll();
  return useSyncExternalStore(enabled ? subscribe : idleSubscribe,
    () => {
      if (!enabled) return false;
      const top = getCompactScrollTop();
      return top !== null && getScrollTop() >= top;
    }, initialSnapshot);
}
