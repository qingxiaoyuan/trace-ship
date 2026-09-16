import { useEffect, useState } from 'react';
import { isOaMobileClient } from '@/utils/oaClient';

/** OA 手机内置浏览器下隐藏文件下载入口 */
export function useHideFileDownload(): boolean {
  const [hide, setHide] = useState(() => isOaMobileClient());

  useEffect(() => {
    const sync = () => setHide(isOaMobileClient());
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  return hide;
}
