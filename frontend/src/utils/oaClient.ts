/**
 * OA 内置浏览器（蓝凌 EKP / KK 等）客户端识别。
 *
 * OA 手机端走应用内 WebView，下载会落到外网终端。从 OA 门户 SSO 进入
 * 或 UA 可识别为 OA 内置浏览器时，移动端隐藏文件下载入口。
 */
export const OA_PORTAL_FLAG_KEY = 'trace-ship-oa-portal';

/** 蓝凌 EKP / KK / 移动门户等内置 WebView 的常见 UA 片段 */
const OA_INAPP_UA_RE =
  /landray|ekp|kkwebview|\bkk\/|kkim|lanyue|e-?mobile|com\.landray/i;

const MOBILE_UA_RE =
  /Android|webOS|iPhone|iPod|iPad|BlackBerry|IEMobile|Opera Mini|Mobile/i;

/** 当前 UA 是否像手机/平板 */
export function isMobileUserAgent(ua: string): boolean {
  return MOBILE_UA_RE.test(ua);
}

/** 当前 UA 是否像 OA 内置浏览器 */
export function isOaInAppBrowser(ua: string): boolean {
  return OA_INAPP_UA_RE.test(ua);
}

/** 从 OA 门户 /sso 进入时打标，供 UA 无法识别时兜底 */
export function markOaPortalEntry(): void {
  try {
    sessionStorage.setItem(OA_PORTAL_FLAG_KEY, '1');
  } catch {
    // 隐私模式等无法写入时忽略，仍可靠 UA 判断
  }
}

function hasOaPortalFlag(): boolean {
  try {
    return sessionStorage.getItem(OA_PORTAL_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * OA 手机端：应隐藏文件下载（产物、日志、发布单导出等）。
 * 桌面浏览器、OA 电脑客户端不隐藏。
 */
export function isOaMobileClient(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (!isMobileUserAgent(ua)) return false;
  return isOaInAppBrowser(ua) || hasOaPortalFlag();
}
