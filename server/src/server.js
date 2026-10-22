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

if (!(await assertDatabaseConnection())) {
  logger.error('السيرفر لن يعمل بدون قاعدة البيانات. تأكد إن MySQL شغّال وأن DB_* في .env صحيحة، ثم: npm run db:setup');
  process.exit(1);
}

const app = createApp();
const server = app.listen(env.port, () => {
  logger.success(`نعيمًا API شغّال على http://localhost:${env.port}${env.apiPrefix}  (${env.nodeEnv})`);
  startJobs();
});

/** إيقاف نظيف: نكمل الطلبات الجارية ثم نغلق الاتصالات (Render/Docker يرسلان SIGTERM) */
let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  logger.info(`${signal} — إيقاف نظيف...`);
  stopJobs();
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
