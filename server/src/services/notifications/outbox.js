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
export async function enqueuePush({ shopId = null, customerId, payload }, tx = { execute }) {
  await tx.execute(
    `INSERT INTO notification_outbox (shop_id, channel, to_address, template, payload)
     VALUES (?, 'push', ?, 'push', ?)`,
    [shopId, String(customerId), JSON.stringify(payload)],
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
    `SELECT id, channel, to_address, template, payload, attempts
       FROM notification_outbox
      WHERE status = 'pending' AND scheduled_at <= NOW()
      ORDER BY scheduled_at
      LIMIT ${Math.min(Math.max(Number(batch) || 25, 1), 100)}`,
  );

  let sent = 0;
  for (const row of due) {
    try {
      const result = await deliver(row);
      const status = result.status === 'skipped' ? 'skipped' : 'sent';
      await execute(
        'UPDATE notification_outbox SET status = ?, attempts = attempts + 1, sent_at = NOW(), last_error = NULL WHERE id = ?',
        [status, row.id],
      );
      if (status === 'sent') sent += 1;
    } catch (error) {
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
