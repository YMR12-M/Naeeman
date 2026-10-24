import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * إعداد Vite لتطبيق الزبون (PWA) وصفحة المحل العامة.
 *
 * المنافذ: 5201 للتطوير و4201 للمعاينة (لوحة المحل 5200 جنبه).
 * البروكسي بيوجّه /api للسيرفر ويشيل ترويسة Origin، عشان الموبايل اللي فاتح
 * التطبيق من عنوان الكمبيوتر في الشبكة ما يترفضش من قايمة CORS. للتطوير بس.
 *
 * الـ service worker (public/sw.js) ملف ثابت من غير بناء: بيعرض الإشعارات
 * وبيفتح «دوري» لما الزبون يدوس عليها، وبيخلّي التطبيق يفتح من غير نت.
 */
const API_TARGET = process.env.NAEEMAN_API_TARGET || 'http://localhost:4030';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: Number(process.env.NAEEMAN_MOBILE_PORT) || 5201,
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
  preview: { port: 4201, strictPort: true },
  build: { sourcemap: false, chunkSizeWarningLimit: 800 },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    css: false,
    globals: true,
  },
});
