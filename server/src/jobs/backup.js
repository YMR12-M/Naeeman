/**
 * النسخ الاحتياطية الدورية (شغّالة افتراضيًا في وضع «المحل هو السيرفر»).
 * كمان بتتعمل نسخة بعد كل تقفيل يوم (modules/billing).
 */
import { env } from '../config/env.js';
import { createBackup } from '../db/backup.js';
import { logger } from '../utils/logger.js';
import { registerJob } from './index.js';

export async function backupNow(reason = 'دوري') {
  if (!env.backup.enabled) return null;
  const result = await createBackup();
  logger.info(`نسخة احتياطية (${reason}): ${result.file}`);
  return result;
}

if (env.backup.enabled) {
  registerJob({
    name: 'backup',
    everyMs: Math.max(1, env.backup.everyHours) * 60 * 60_000,
    run: () => backupNow(),
  });
}
