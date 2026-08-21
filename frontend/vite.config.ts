/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
  server: {
    host: true,
    port: 8855,
    proxy: {
      // 当 VITE_ENABLE_MOCK=true 时，/api 请求会被前端 mock 适配器拦截，
      // 不会到达此处代理；mock 关闭时才转发到后端服务。
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
  },
});
