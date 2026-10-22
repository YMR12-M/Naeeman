/**
 * التحقّق من جهاز المحل (ترويسة `X-Device-Token`).
 *
 * كل جهاز ليه شغلانة واحدة: توكن التلفزيون ما يفتحش مسارات الكشك ولا
 * الكرسي. الجهاز الملغي مرفوض فورًا، والمحل الموقوف كمان.
 * «آخر ظهور» بيتحدّث مرّة كل دقيقة بالكتير (مش مع كل طلب).
 */
import { execute, queryOne } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sha256 } from '../utils/security.js';

/** الأجهزة ما بتخلصش جلستها، فبنقفل الـ stream كل 10 دقايق عشان الإلغاء يسري على الشاشات المفتوحة */
export const DEVICE_STREAM_MS = 10 * 60_000;

export const authenticateDevice = (...types) => asyncHandler(async (req, _res, next) => {
  const token = String(req.headers['x-device-token'] || '');
  if (!token) throw ApiError.unauthorized('الجهاز مش مربوط — دخّل كود الربط', { code: 'NO_DEVICE_TOKEN' });

  const device = await queryOne(
    `SELECT d.id, d.shop_id, d.type, d.name, d.current_barber_id, d.revoked_at, d.last_seen_at, s.status AS shop_status
       FROM devices d JOIN shops s ON s.id = d.shop_id WHERE d.token_hash = ?`,
    [sha256(token)],
  );
  if (!device || device.revoked_at) {
    throw ApiError.unauthorized('الجهاز اتلغى أو مش مربوط — اربطه تاني', { code: 'DEVICE_REVOKED' });
  }
  if (device.shop_status !== 'active') throw ApiError.forbidden('اشتراك المحل موقوف', { code: 'SHOP_SUSPENDED' });
  if (types.length > 0 && !types.includes(device.type)) {
    throw ApiError.forbidden('الجهاز ده مش مربوط على الشغلانة دي', { code: 'WRONG_DEVICE_TYPE' });
  }
  if (!device.last_seen_at || Date.now() - device.last_seen_at.getTime() > 60_000) {
    await execute('UPDATE devices SET last_seen_at = NOW() WHERE id = ?', [device.id]);
  }

  req.device = device;
  req.shopId = device.shop_id;
  req.authExpiresAt = Date.now() + DEVICE_STREAM_MS;
  next();
});
