import { useMatches } from 'react-router-dom';
import { useDashboardContext } from '@/hooks/useDashboardContext';
import { getNavLabel } from './navMenu';

/** 当前页标题：取最后一个带 handle.title 的路由匹配，默认「工作台」 */
export function useCurrentRouteTitle(): string {
  const matches = useMatches();
  const maintainer = useDashboardContext()?.layout_mode === 'maintainer';
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const title = (matches[i].handle as { title?: string } | undefined)?.title;
    if (title) return maintainer && title === '发布详情' ? '版本详情' : getNavLabel(matches[i].pathname, title, maintainer);
  }
  return '工作台';
}
