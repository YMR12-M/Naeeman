/**
 * ═══════════════════════════════════════════════════════════════
 *  صندوق الإشعارات (Outbox)
 *
 *  لا نرسل بريدًا مباشرة من داخل طلب HTTP. نكتب الرسالة في الجدول
 *  (داخل نفس معاملة الحجز إن أمكن)، وعامل خلفي يرسلها مع إعادة محاولة
 *  بتأخير متزايد. النتيجة: سقوط مزوّد البريد لحظة الحجز لا يُفشل الحجز
 *  ولا يضيّع الرسالة، وإن أُلغيت المعاملة لا تخرج رسالة عن شيء لم يحدث.
 * ═══════════════════════════════════════════════════════════════
 */
import { execute, query } from '../../config/db.js';
import { logger } from '../../utils/logger.js';
import { renderTemplate } from './templates.js';
import { sendMail } from './mailer.js';
import { sendPushToCustomer } from './push.js';

const MAX_ATTEMPTS = 5;

/**
 * الإشعار بيفقد قيمته بعد وقت: «دورك جه» بعد ساعة ما بقاش ليه لازمة،
 * والتذكير بعد يوم. لو النت كان قاطع (المحل هو السيرفر)، اللي عدّى وقته
 * بيتعلّم skipped بدل ما يوصل الزبون متأخّر.
 */
const STALE_MINUTES = { push: 60, reminder: 24 * 60 };

/** أخطاء الشبكة نفسها (النت قاطع): ما بتتحسبش محاولة */
const NETWORK_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);
export const isNetworkError = (error) => NETWORK_CODES.has(error?.code) || NETWORK_CODES.has(error?.cause?.code);

/** يضيف بريدًا إلى الصندوق. `tx` اختياري ليكون جزءًا من معاملة قائمة. */
export async function enqueueEmail({ shopId = null, to, template, payload, delaySeconds = 0 }, tx = { execute }) {
  if (!to) return;
  await tx.execute(
    `INSERT INTO notification_outbox (shop_id, channel, to_address, template, payload, scheduled_at)
     VALUES (?, 'email', ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
    [shopId, to, template, JSON.stringify(payload), Math.max(0, Math.round(delaySeconds))],
  );
}

/** إشعار Push لزبون (to_address = رقم الزبون) */
export async function enqueuePush({ shopId = null, customerId, payload, template = 'push' }, tx = { execute }) {
  await tx.execute(
    `INSERT INTO notification_outbox (shop_id, channel, to_address, template, payload)
     VALUES (?, 'push', ?, ?, ?)`,
    [shopId, String(customerId), template, JSON.stringify(payload)],
  );
}

async function deliver(row) {
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  if (row.channel === 'email') {
    const message = renderTemplate(row.template, payload);
    return sendMail({ to: row.to_address, ...message });
  }
  const result = await sendPushToCustomer(Number(row.to_address), payload);
  return { status: result.skipped ? 'skipped' : 'sent' };
}

/** يعالج دفعة من الرسائل المستحقّة. يعيد عدد المرسَل. */
export async function processOutbox({ batch = 25 } = {}) {
  const due = await query(
    `SELECT id, channel, to_address, template, payload, attempts, TIMESTAMPDIFF(MINUTE, created_at, NOW()) AS age_minutes
       FROM notification_outbox
      WHERE status = 'pending' AND scheduled_at <= NOW()
      ORDER BY scheduled_at
      LIMIT ${Math.min(Math.max(Number(batch) || 25, 1), 100)}`,
  );

  let sent = 0;
  for (const row of due) {
    const staleAfter = row.channel === 'push' ? (STALE_MINUTES[row.template] ?? STALE_MINUTES.push) : null;
    if (staleAfter !== null && row.age_minutes > staleAfter) {
      await execute("UPDATE notification_outbox SET status = 'skipped', last_error = 'stale' WHERE id = ?", [row.id]);
      continue;
    }
    try {
      const result = await deliver(row);
      const status = result.status === 'skipped' ? 'skipped' : 'sent';
      await execute(
        'UPDATE notification_outbox SET status = ?, attempts = attempts + 1, sent_at = NOW(), last_error = NULL WHERE id = ?',
        [status, row.id],
      );
      if (status === 'sent') sent += 1;
    } catch (error) {
      if (isNetworkError(error)) {
        // النت قاطع: نستنّى دقيقة ونجرّب تاني من غير ما نحسبها محاولة
        await execute(
          'UPDATE notification_outbox SET last_error = ?, scheduled_at = DATE_ADD(NOW(), INTERVAL 1 MINUTE) WHERE id = ?',
          [`offline: ${String(error.message).slice(0, 460)}`, row.id],
        );
        continue;
      }
      const attempts = row.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      // تأخير متزايد: 2 · 4 · 8 · 16 دقيقة
      const delayMinutes = 2 ** attempts;
      await execute(
        `UPDATE notification_outbox
            SET status = ?, attempts = ?, last_error = ?,
                scheduled_at = DATE_ADD(NOW(), INTERVAL ? MINUTE)
          WHERE id = ?`,
        [failed ? 'failed' : 'pending', attempts, String(error.message).slice(0, 480), delayMinutes, row.id],
      );
      logger.warn(`تعذّر إرسال الإشعار #${row.id} (محاولة ${attempts}/${MAX_ATTEMPTS}): ${error.message}`);
    }
  }
  return sent;
}

/** يمسح الرسائل القديمة (فيها روابط وبيانات زباين لا داعي لبقائها) */
export async function purgeOutbox({ keepDays = 14 } = {}) {
  const result = await execute(
    "DELETE FROM notification_outbox WHERE status IN ('sent','skipped','failed') AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)",
    [keepDays],
  );
  return result.affectedRows;
}
