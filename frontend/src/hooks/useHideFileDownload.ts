import { useEffect, useState } from 'react';
import { isOaMobileClient } from '@/utils/oaClient';

/** 按目标项目角色收起文件入口；OA 手机继续沿用下载兼容规则。null 表示角色尚未确认。 */
export function useHideFileDownload(projectRole?: string | null): boolean {
  const [hide, setHide] = useState(() => isOaMobileClient());

  useEffect(() => {
    const sync = () => setHide(isOaMobileClient());
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  return hide || projectRole === 'maintainer' || projectRole === null;
}
