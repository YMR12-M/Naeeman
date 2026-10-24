import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * إعداد Vite للوحة المحل (ومعاها شاشات التلفزيون والكشك والكرسي).
 *
 * المنافذ: 5200 للتطوير و4200 للمعاينة (تطبيق الزبون 5201 — بجواره بلا تصادم).
 * `strictPort` مقصود: لو المنفذ مشغول الأفضل يفشل بصوت عالي من إنه ينقل
 * بصمت لمنفذ تاني.
 *
 * البروكسي بيوجّه /api للسيرفر ويشيل ترويسة Origin: كده التابلت أو التلفزيون
 * اللي فاتحين اللوحة من عنوان الجهاز في الشبكة ما بيترفضوش من قايمة CORS.
 * ده للتطوير بس.
 */
const API_TARGET = process.env.NAEEMAN_API_TARGET || 'http://localhost:4030';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5200,
    strictPort: true,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('origin'));
        },
      },
    },
  },
  preview: { port: 4200, strictPort: true },
  build: { sourcemap: false, chunkSizeWarningLimit: 800 },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    css: false,
    globals: true,
  },
});
