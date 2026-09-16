import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OA_PORTAL_FLAG_KEY,
  isMobileUserAgent,
  isOaInAppBrowser,
  isOaMobileClient,
  markOaPortalEntry,
} from './oaClient';

describe('oaClient', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('识别手机 UA 与 OA 内置浏览器 UA', () => {
    expect(isMobileUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true);
    expect(isMobileUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0')).toBe(false);
    expect(isOaInAppBrowser('Mozilla/5.0 (Linux; Android 13) Chrome/120.0.0.0 Mobile Safari/537.36 kk/7.2.0')).toBe(
      true,
    );
    expect(isOaInAppBrowser('Mozilla/5.0 (Linux; Android 13) Chrome/120.0.0.0 Mobile Safari/537.36')).toBe(false);
  });

  it('OA 手机 UA 隐藏下载', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Mobile Safari/537.36 LandrayKK/6.0',
    });
    expect(isOaMobileClient()).toBe(true);
  });

  it('OA 门户 SSO 进入的手机端即使 UA 无品牌也隐藏下载', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    });
    expect(isOaMobileClient()).toBe(false);
    markOaPortalEntry();
    expect(sessionStorage.getItem(OA_PORTAL_FLAG_KEY)).toBe('1');
    expect(isOaMobileClient()).toBe(true);
  });

  it('OA 电脑端不隐藏下载', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 landray ekp',
    });
    markOaPortalEntry();
    expect(isOaMobileClient()).toBe(false);
  });
});
