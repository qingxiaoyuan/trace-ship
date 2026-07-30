/**
 * 浏览器能力检测与外部工具地址
 *
 * AI 生成镜像页面依赖高版本浏览器 API，进入前先做能力检测，
 * 不满足时引导用户到浏览器升级页下载最新 Chrome。
 */

/** AI 生成镜像（Agent）访问地址 */
export const AI_AGENT_URL = 'http://10.128.89.202:28010/agent';

/** 内网 Chrome 离线安装包下载地址 */
export const CHROME_DOWNLOAD_URL = 'http://10.128.89.202:8660/get/ChromeStandaloneSetup64.exe';

/** 浏览器升级提示页路由 */
export const BROWSER_UPGRADE_PATH = '/browser-upgrade';

/** Chrome 内核最低主版本要求 */
const MIN_CHROME_MAJOR = 100;

/**
 * 解析 UA 中的 Chrome 内核主版本（Chrome / Chromium / Edge 均基于 Chrome）
 *
 * 非 Chrome 内核浏览器返回 null，交由 API 能力检测兜底判断。
 */
function getChromeMajorVersion(): number | null {
  const ua = navigator.userAgent;
  const match = ua.match(/(?:Chrome|Chromium|Edg)\/(\d+)/);
  return match ? Number(match[1]) : null;
}

/**
 * 检测当前浏览器是否支持高版本 API
 *
 * 优先看 Chrome 内核版本；UA 无法判断时回退到关键 API 能力检测
 * （structuredClone / Array.prototype.at / Object.hasOwn / Promise.any）。
 */
export function isModernBrowser(): boolean {
  const chromeMajor = getChromeMajorVersion();
  if (chromeMajor !== null) {
    return chromeMajor >= MIN_CHROME_MAJOR;
  }
  return (
    typeof globalThis.structuredClone === 'function' &&
    typeof Array.prototype.at === 'function' &&
    typeof Object.hasOwn === 'function' &&
    typeof Promise.any === 'function'
  );
}

/**
 * 打开 AI 生成镜像页面：浏览器满足要求时新 tab 直达，
 * 否则新 tab 打开浏览器升级提示页。
 */
export function openAiAgent(): void {
  if (isModernBrowser()) {
    window.open(AI_AGENT_URL, '_blank', 'noopener,noreferrer');
  } else {
    window.open(BROWSER_UPGRADE_PATH, '_blank');
  }
}
