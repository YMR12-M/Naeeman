/**
 * تذكير «بقالك 3 أسابيع»: إشعار للزبون اللي عنده التطبيق واشتراك إشعارات،
 * مرّة واحدة لكل زيارة، في وقت معقول (من 11 الصبح لـ 9 بالليل بتوقيت المحل).
 * اللي معندوش تطبيق بيظهر للاستقبال في «وحشونا» برسالة واتساب جاهزة.
 */
import { query, transaction } from '../config/db.js';
import { env } from '../config/env.js';
import { enqueuePush } from '../services/notifications/outbox.js';
import { logger } from '../utils/logger.js';
import { registerJob } from './index.js';

/** الساعة دلوقتي بتوقيت المحل */
function localHour(timeZone, now) {
  const text = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now);
  return Number(text);
}

/** «بقالك 3 أسابيع» · «بقالك شهر» · «بقالك 25 يوم» */
export function sinceText(days) {
  if (days >= 28 && days < 45) return 'بقالك شهر';
  if (days % 7 === 0 || days >= 14) {
    const weeks = Math.round(days / 7);
    if (weeks === 2) return 'بقالك أسبوعين';
    return weeks >= 3 && weeks <= 10 ? `بقالك ${weeks} أسابيع` : `بقالك ${weeks} أسبوع`;
  }
  return `بقالك ${days} يوم`;
}

/**
 * @param {object} [options]
 * @param {Date}    [options.now]
 * @param {boolean} [options.force]  تجاهل ساعات الإرسال (للاختبارات)
 * @returns {Promise<number>} عدد الإشعارات اللي اتحطّت في الصندوق
 */
export async function sendReminders({ now = new Date(), force = false } = {}) {
  const shops = await query(
    `SELECT s.id, s.name, s.slug, s.timezone, ss.reminder_days FROM shops s
       JOIN shop_settings ss ON ss.shop_id = s.id
      WHERE s.status = 'active' AND ss.reminder_enabled = 1`,
  );
  let queued = 0;
  for (const shop of shops) {
    const hour = localHour(shop.timezone, now);
    if (!force && (hour < 11 || hour >= 21)) continue;
    const due = await query(
      `SELECT sc.id, sc.customer_id, sc.name, DATEDIFF(NOW(), sc.last_visit_at) AS days
         FROM shop_customers sc
        WHERE sc.shop_id = ? AND sc.customer_id IS NOT NULL AND sc.reminders_off = 0 AND sc.last_visit_at IS NOT NULL
          AND sc.last_visit_at < DATE_SUB(NOW(), INTERVAL ? DAY)
          AND (sc.reminded_at IS NULL OR sc.reminded_at < sc.last_visit_at)
          AND EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.customer_id = sc.customer_id)
          AND NOT EXISTS (SELECT 1 FROM queue_tickets t WHERE t.customer_id = sc.customer_id AND t.status IN ('waiting','serving'))
        ORDER BY sc.last_visit_at LIMIT 200`,
      [shop.id, shop.reminder_days],
    );
    for (const card of due) {
      await transaction(async (tx) => {
        // مرّة واحدة: لو مهمة تانية سبقتنا، الشرط مش هيعدّي
        const result = await tx.execute(
          'UPDATE shop_customers SET reminded_at = NOW() WHERE id = ? AND (reminded_at IS NULL OR reminded_at < last_visit_at)',
          [card.id],
        );
        if (result.affectedRows === 0) return;
        const first = String(card.name).split(/\s+/)[0];
        await enqueuePush({
          shopId: shop.id,
          customerId: card.customer_id,
          template: 'reminder',
          payload: {
            title: `${shop.name} وحشناك`,
            body: `${sinceText(card.days)} من آخر حلاقة يا ${first}. خُد دورك من التطبيق وتعالى على ميعادك.`,
            url: `${env.customerAppUrl}/s/${shop.slug}`,
            tag: `reminder-${shop.id}`,
          },
        }, tx);
        queued += 1;
      });
    }
  }
  if (queued > 0) logger.info(`تذكير «وحشناك»: ${queued} إشعار`);
  return queued;
}

registerJob({
  name: 'reminders',
  everyMs: 30 * 60_000,
  run: () => sendReminders(),
});
