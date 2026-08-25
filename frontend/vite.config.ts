import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // 必须用绝对路径：相对 base 会让 /hanzi/1 等二级路由把 assets 解析成 /hanzi/assets/...
  // 导致 JS 加载失败（nginx 回退成 HTML）→ 播放页空白。已踩坑（2026-08-25）
  base: "/",
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 1500,
  },
});
