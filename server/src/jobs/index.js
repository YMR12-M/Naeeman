/**
 * ═══════════════════════════════════════════════════════════════
 *  المهام الخلفية
 *
 *  مهام دورية بسيطة داخل نفس عملية السيرفر (لا Redis ولا طابور خارجي):
 *    • تطبيق مهل الطابور (اللي جه دوره وما وصلش)
 *    • إرسال الإشعارات من الصندوق (outbox)
 *
 *  لو شغّلت أكثر من نسخة من السيرفر فلن تتكرّر المهمة: كل مهمة تأخذ
 *  قفل MySQL (GET_LOCK) قبل التنفيذ، ومن لا يحصل عليه يتخطّى الدورة.
 * ═══════════════════════════════════════════════════════════════
 */
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const registry = [];
const timers = [];
let running = false;

/** تسجيل مهمة: register({ name, everyMs, run }) */
export function registerJob(job) {
  registry.push(job);
}

async function withLock(name, fn) {
  const connection = await pool.getConnection();
  const lockName = `naeeman:${env.db.database}:${name}`;
  try {
    const [[row]] = await connection.query('SELECT GET_LOCK(?, 0) AS got', [lockName]);
    if (row.got !== 1) return; // نسخة أخرى تنفّذها الآن
    try {
      await fn();
    } finally {
      await connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
    }
  } finally {
    connection.release();
  }
}

export function startJobs() {
  if (!env.jobsEnabled || running) return;
  running = true;

  for (const job of registry) {
    const tick = async () => {
      try {
        await withLock(job.name, job.run);
      } catch (error) {
        logger.error(`فشلت المهمة ${job.name}: ${error.message}`);
      }
    };
    // أول تشغيل بعد قليل (لا نزاحم الإقلاع)، ثم بشكل دوري
    const first = setTimeout(tick, 5_000);
    const timer = setInterval(tick, job.everyMs);
    first.unref();
    timer.unref();
    timers.push(first, timer);
  }
  logger.info(`المهام الخلفية شغّالة (${registry.length})`);
}

export function stopJobs() {
  for (const timer of timers) {
    clearTimeout(timer);
    clearInterval(timer);
  }
  timers.length = 0;
  running = false;
}
