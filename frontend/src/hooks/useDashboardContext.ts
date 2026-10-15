import { createContext, useContext } from 'react';
import type { DashboardContext } from '@/api/dashboard';

export const DashboardContextState = createContext<DashboardContext | null>(null);

/** 首页、导航及页面入口共享已核验的服务端上下文。 */
export function useDashboardContext() {
  return useContext(DashboardContextState);
}
