import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 后端地址：默认本机 3000，可用 VITE_API_TARGET 覆盖
const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:3000';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: true,
    port: 5175,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
});
