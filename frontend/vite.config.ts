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
    rollupOptions: {
      output: {
        /**
         * 手动拆 chunk 的理由（2026-10-29；与 src/App.tsx 的 React.lazy 配套）：
         *
         * 只做路由懒加载的话，共享依赖会被 rollup 塞进「被多个异步块引用」的
         * 公共块里，改一行业务代码就会把整块 hash 换掉。显式拆出三组
         * 内容稳定、体积大的库，让它们的文件名在业务迭代中保持不变 ——
         * 用户第二次访问直接走 CF / 浏览器缓存，不用重下。
         *
         * 只列这三组、其余返回 undefined 是**故意的**：没匹配到的包由 rollup
         * 按「谁引用谁携带」自动归块，这样只被某个页面用的零散依赖不会被打包进
         * 一个所有页面都得下的公共块（那正是拆包要解决的问题）。
         */
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;

          // React 内核：每个页面都依赖，也是最长寿的一块
          if (
            /node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)
          ) {
            return "vendor-react";
          }

          // 图表栈：只有 /access 与 /lottery/(history|predict) 会用到
          if (
            /node_modules\/(recharts|victory-vendor|d3-[a-z]+|internmap|react-smooth|decimal\.js-light|fast-equals)\//.test(
              id,
            )
          ) {
            return "vendor-chart";
          }

          // Markdown 栈：只有 /tools 会用到（remark/rehype 的转译链很长，单独成块）
          if (
            /node_modules\/(react-markdown|remark-[a-z-]+|rehype-[a-z-]+|unified|micromark[a-z-]*|mdast-[a-z-]+|hast-[a-z-]+|unist-[a-z-]+|vfile[a-z-]*|highlight\.js|lowlight|property-information|devlop|bail|trough|is-plain-obj|zwitch|longest-streak|ccount|markdown-table|escape-string-regexp|trim-lines|html-url-attributes|space-separated-tokens|comma-separated-tokens|character-entities[a-z-]*|parse-entities|decode-named-character-reference)\//.test(
              id,
            )
          ) {
            return "vendor-md";
          }

          return undefined;
        },
      },
    },
  },
});
