import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { isOaMobileClient } from '@/utils/oaClient';

/** 按目标项目角色收起文件入口；OA 手机继续沿用下载兼容规则。null 表示角色尚未确认。 */
export function useHideFileDownload(projectRole?: string | null): boolean {
  const [isOaMobile, setIsOaMobile] = useState(() => isOaMobileClient());
  const canDownload = useAuthStore((state) => state.user?.can_download_files === true);

  useEffect(() => {
    const sync = () => setIsOaMobile(isOaMobileClient());
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  return !canDownload || isOaMobile || projectRole === 'maintainer' || projectRole === null;
}
