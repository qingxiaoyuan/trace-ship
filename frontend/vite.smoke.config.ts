import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// 独立配置拒绝复用已有开发服务，也不读取开发环境中的 API 地址。
export default defineConfig({
  plugins: [react()],
  envDir: false,
  cacheDir: process.env.SMOKE_VITE_CACHE,
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  build: { outDir: process.env.SMOKE_DIST, emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.SMOKE_FRONTEND_PORT),
    strictPort: true,
    proxy: {
      '/api': { target: process.env.SMOKE_BACKEND_URL, changeOrigin: true },
      '/__browser_smoke__': { target: process.env.SMOKE_BACKEND_URL, changeOrigin: true },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: Number(process.env.SMOKE_FRONTEND_PORT),
    strictPort: true,
    proxy: {
      '/api': { target: process.env.SMOKE_BACKEND_URL, changeOrigin: true },
      '/__browser_smoke__': { target: process.env.SMOKE_BACKEND_URL, changeOrigin: true },
    },
  },
});
