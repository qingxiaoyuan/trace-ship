import { afterEach, describe, expect, it, vi } from 'vitest';
import { isModernBrowser } from './browserCheck';

/** 替换 navigator.userAgent（jsdom 中该属性只读，需 defineProperty） */
function stubUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

describe('isModernBrowser', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Chrome 主版本 >= 100 判定为现代浏览器', () => {
    stubUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0 Safari/537.36');
    expect(isModernBrowser()).toBe(true);
  });

  it('Chrome 主版本 < 100 判定为过旧', () => {
    stubUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/90.0.0.0 Safari/537.36');
    expect(isModernBrowser()).toBe(false);
  });

  it('Edge 按 Chrome 内核版本判断', () => {
    stubUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0');
    expect(isModernBrowser()).toBe(true);
  });

  it('非 Chrome 内核 UA 回退到 API 能力检测', () => {
    stubUserAgent('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15');
    // jsdom 运行在现代 Node 上，structuredClone / at / hasOwn / Promise.any 均可用
    expect(isModernBrowser()).toBe(true);
  });
});
