import { defineConfig } from '@playwright/test';
import path from 'node:path';

if (!process.env.SMOKE_BASE_URL || !process.env.SMOKE_MANIFEST || !process.env.SMOKE_REPORT_DIR) {
  throw new Error('请通过 npm run test:browser 启动独立服务和测试数据');
}

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  globalTimeout: 240_000,
  expect: { timeout: 15_000 },
  outputDir: path.join(process.env.SMOKE_REPORT_DIR, 'artifacts'),
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(process.env.SMOKE_REPORT_DIR, 'playwright.json') }],
  ],
  use: {
    baseURL: process.env.SMOKE_BASE_URL,
    browserName: 'chromium',
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
    screenshot: 'only-on-failure',
    // 不归档 trace、录像、storageState 或网络包，避免把临时登录凭据写入报告。
    trace: 'off',
    video: 'off',
  },
});
