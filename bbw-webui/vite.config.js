import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  // 相对路径产物:可从任意子目录/端口托管(dist 直接丢进静态服务器目录)
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    // 允许导入工作区内的 bbw-protocol 源码
    fs: { allow: [".."] },
  },
  build: { outDir: "dist", target: "es2020" },
});
