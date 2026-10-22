/**
 * ═══════════════════════════════════════════════════════════════
 *  سجل التدقيق (Audit Log)
 *
 *  نسجّل «مَن غيّر ماذا ومتى» لكل ما يمسّ الأسعار أو الفريق أو الإعدادات
 *  أو ترتيب الطابور يدويًا، مع القيمة قبل وبعد.
 *
 *  التسجيل لا يُسقط العملية الأصلية أبدًا: لو فشل الإدراج نكتب اللوج ونكمل.
 * ═══════════════════════════════════════════════════════════════
 */
import { execute } from '../config/db.js';
import { logger } from './logger.js';

const MAX_JSON_BYTES = 20_000;

function toJson(value) {
  if (value === null || value === undefined) return null;
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > MAX_JSON_BYTES) return JSON.stringify({ truncated: true });
  return text;
}

/**
 * @param {object} req      طلب Express (يُؤخذ منه المستخدم والـ IP)
 * @param {object} entry    { action, entity, entityId, before, after, shopId, userId }
 * @param {object} [tx]     واجهة المعاملة لو نريد التسجيل داخلها
 */
export async function audit(req, entry, tx = { execute }) {
  try {
    await tx.execute(
      `INSERT INTO audit_logs (shop_id, user_id, action, entity, entity_id, before_json, after_json, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.shopId ?? req.user?.shop_id ?? null,
        entry.userId ?? req.user?.id ?? null,
        entry.action,
        entry.entity,
        entry.entityId ?? null,
        toJson(entry.before),
        toJson(entry.after),
        req.context?.ip ?? null,
        req.context?.userAgent ?? null,
      ],
    );
  } catch (error) {
    logger.error(`تعذّر تسجيل التدقيق (${entry.action}): ${error.message}`);
  }
}
