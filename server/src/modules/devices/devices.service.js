/**
 * ═══════════════════════════════════════════════════════════════
 *  ربط أجهزة المحل
 *
 *  1) المالك يطلّع كود (POST /devices/pairing-code): 6 أرقام، 10 دقايق، مرّة واحدة.
 *  2) الجهاز يدخّل الكود (POST /devices/pair) فياخد توكن طويل.
 *  3) كل طلبات الجهاز بعد كده بترويسة X-Device-Token.
 *
 *  بنخزّن بصمة الكود والتوكن بس. الكود قصير، فمحمي بحدّ محاولات ضيّق
 *  (pairingLimiter) وبعمر قصير.
 * ═══════════════════════════════════════════════════════════════
 */
import crypto from 'node:crypto';
import { query, queryOne, execute, transaction } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { randomToken, sha256 } from '../../utils/security.js';

export const DEVICE_TYPES = ['display', 'kiosk', 'chair'];
export const TYPE_LABELS = { display: 'شاشة التلفزيون', kiosk: 'تابلت الباب', chair: 'تابلت الكرسي' };
const PAIRING_MINUTES = 10;

/** 6 أرقام عشوائية (مش Math.random) */
const sixDigits = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

export const devicesService = {
  async list(shopId) {
    return query(
      `SELECT d.id, d.type, d.name, d.last_seen_at, d.created_at, d.current_barber_id, b.name AS current_barber_name
         FROM devices d LEFT JOIN barbers b ON b.id = d.current_barber_id
        WHERE d.shop_id = ? AND d.revoked_at IS NULL ORDER BY d.type, d.id`,
      [shopId],
    );
  },

  /** كود ربط جديد. لو الكود اتصادف مع كود شغّال لمحل تاني (نادر جدًا) نجرّب تاني. */
  async createPairing(shopId, { type, name }, userId) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = sixDigits();
      const clash = await queryOne(
        'SELECT id FROM device_pairings WHERE code_hash = ? AND used_at IS NULL AND expires_at > NOW()',
        [sha256(code)],
      );
      if (clash) continue;
      await execute(
        `INSERT INTO device_pairings (shop_id, type, name, code_hash, expires_at, created_by)
         VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), ?)`,
        [shopId, type, name || TYPE_LABELS[type], sha256(code), PAIRING_MINUTES, userId],
      );
      return { code, type, expires_in_minutes: PAIRING_MINUTES };
    }
    throw ApiError.unavailable('تعذّر توليد كود — حاول تاني', { code: 'PAIRING_RETRY' });
  },

  /** الجهاز يدخّل الكود: يتعمل الجهاز ويرجع التوكن مرّة واحدة */
  async pair(code) {
    const token = randomToken(48);
    const device = await transaction(async (tx) => {
      const pairing = await tx.queryOne(
        `SELECT id, shop_id, type, name FROM device_pairings
          WHERE code_hash = ? AND used_at IS NULL AND expires_at > NOW() FOR UPDATE`,
        [sha256(code)],
      );
      if (!pairing) throw ApiError.notFound('الكود غلط أو انتهى — اطلب كود جديد من المالك', { code: 'PAIRING_INVALID' });
      const result = await tx.execute(
        'INSERT INTO devices (shop_id, type, name, token_hash, created_by, last_seen_at) SELECT ?, ?, ?, ?, created_by, NOW() FROM device_pairings WHERE id = ?',
        [pairing.shop_id, pairing.type, pairing.name, sha256(token), pairing.id],
      );
      await tx.execute('UPDATE device_pairings SET used_at = NOW(), device_id = ? WHERE id = ?', [result.insertId, pairing.id]);
      return { id: result.insertId, shop_id: pairing.shop_id, type: pairing.type, name: pairing.name };
    });
    const shop = await queryOne('SELECT name, slug FROM shops WHERE id = ?', [device.shop_id]);
    return { token, device: { id: device.id, type: device.type, name: device.name, shop } };
  },

  async rename(shopId, id, name) {
    const result = await execute('UPDATE devices SET name = ? WHERE id = ? AND shop_id = ? AND revoked_at IS NULL', [name, id, shopId]);
    if (result.affectedRows === 0) throw ApiError.notFound('الجهاز غير موجود', { code: 'DEVICE_NOT_FOUND' });
  },

  async revoke(shopId, id) {
    const device = await queryOne('SELECT id, type, name FROM devices WHERE id = ? AND shop_id = ? AND revoked_at IS NULL', [id, shopId]);
    if (!device) throw ApiError.notFound('الجهاز غير موجود', { code: 'DEVICE_NOT_FOUND' });
    await execute('UPDATE devices SET revoked_at = NOW(), current_barber_id = NULL WHERE id = ?', [id]);
    return device;
  },
};
