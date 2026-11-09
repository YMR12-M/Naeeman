/**
 * نقطة الإقلاع: فحص القاعدة ← تشغيل HTTP ← المهام الخلفية ← إيقاف نظيف.
 */
import { env } from './config/env.js';
import { assertDatabaseConnection, closePool } from './config/db.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';
import { startJobs, stopJobs } from './jobs/index.js';
import './jobs/outbox.js';
import './jobs/queue.js';
import './jobs/reminders.js';
import './jobs/backup.js';

if (!(await assertDatabaseConnection())) {
  logger.error('السيرفر لن يعمل بدون قاعدة البيانات. تأكد إن MySQL شغّال وأن DB_* في .env صحيحة، ثم: npm run db:setup');
  process.exit(1);
}

const app = createApp();
const server = app.listen(env.port, env.host, () => {
  logger.success(`نعيمًا API شغّال على http://localhost:${env.port}${env.apiPrefix}  (${env.nodeEnv}${env.hubMode ? '، المحل هو السيرفر' : ''})`);
  if (env.staticDir) logger.info(`لوحة المحل والأجهزة: http://localhost:${env.port}/`);
  startJobs();
});

// تطبيق الزبون على بورت تاني (نفس الـ API ونفس العملية، فالتحديث اللحظي واحد)
const customerServer = env.customerPort && env.customerStaticDir
  ? createApp({ staticDir: env.customerStaticDir }).listen(env.customerPort, env.host, () => {
    logger.info(`تطبيق الزبون: http://localhost:${env.customerPort}/`);
  })
  : null;

/** إيقاف نظيف: نكمل الطلبات الجارية ثم نغلق الاتصالات (Render/Docker يرسلان SIGTERM) */
let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  logger.info(`${signal} — إيقاف نظيف...`);
  stopJobs();
  customerServer?.close();
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
  // لو فيه اتصال معلّق، لا ننتظر للأبد
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error(`unhandledRejection: ${reason instanceof Error ? reason.stack : reason}`);
});
