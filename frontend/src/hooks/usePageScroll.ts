import { createContext, useContext, useMemo } from 'react';
import type { RefObject } from 'react';

export const PageScrollContext = createContext<RefObject<HTMLElement | null> | null>(null);

/** 事件发生时读取容器引用，避免捕获首次渲染时尚未挂载的元素。 */
function createPageScroll(container: RefObject<HTMLElement | null> | null) {
  const getElement = () => window.matchMedia('(max-width: 767.98px)').matches ? container?.current : null;
  return {
    getScrollTop: () => getElement()?.scrollTop ?? window.scrollY,
    scrollTo: (top: number) => (getElement() || window).scrollTo({ top, behavior: 'instant' }),
    getCompactScrollTop: () => {
      const overview = container?.current?.querySelector<HTMLElement>('[data-release-overview]');
      const summary = container?.current?.querySelector<HTMLElement>('[data-release-compact-summary]');
      // 归属栏覆盖概要末尾；在吸顶开始处切页，正文首行仍位于页签下方。
      return overview && summary ? Math.max(0, overview.offsetHeight - summary.offsetHeight) : null;
    },
    subscribe: (onChange: () => void) => {
      const element = container?.current;
      const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onChange);
      if (element) {
        observer?.observe(element);
        if (element.firstElementChild) observer?.observe(element.firstElementChild);
      }
      element?.addEventListener('scroll', onChange, { passive: true });
      window.addEventListener('scroll', onChange, { passive: true });
      window.addEventListener('resize', onChange);
      return () => {
        observer?.disconnect();
        element?.removeEventListener('scroll', onChange);
        window.removeEventListener('scroll', onChange);
        window.removeEventListener('resize', onChange);
      };
    },
  };
}

/** 维保手机页使用内容区滚动；桌面和其他页面继续使用窗口。 */
export function usePageScroll() {
  const container = useContext(PageScrollContext);
  return useMemo(() => createPageScroll(container), [container]);
}
