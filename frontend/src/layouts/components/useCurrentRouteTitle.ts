import { useMemo } from 'react';
import { useMatches } from 'react-router-dom';

/** 当前页标题：取最后一个带 handle.title 的路由匹配，默认「工作台」 */
export function useCurrentRouteTitle(): string {
  const matches = useMatches();
  return useMemo(() => {
    for (let i = matches.length - 1; i >= 0; i -= 1) {
      const title = (matches[i].handle as { title?: string } | undefined)?.title;
      if (title) return title;
    }
    return '工作台';
  }, [matches]);
}
