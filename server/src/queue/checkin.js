/**
 * ═══════════════════════════════════════════════════════════════
 *  كود الـ check-in المتغيّر
 *
 *  QR ثابت على الباب ممكن يتصوّر ويتعمل منه «وصلت» من البيت. عشان كده
 *  الكود بيتعرض على شاشة التلفزيون جوّه المحل وبيتغيّر كل دقيقة:
 *  HMAC بسرّ المحل (shops.checkin_secret) على رقم الدقيقة. مقبول الكود
 *  الحالي واللي قبله (الزبون ممكن يمسح في آخر ثانية من الدقيقة).
 * ═══════════════════════════════════════════════════════════════
 */
import crypto from 'node:crypto';
import { safeEqual } from '../utils/security.js';

export const CHECKIN_WINDOW_MS = 60_000;

/** كود من 6 أرقام لدقيقة معيّنة */
export function checkinCode(secretHex, shopId, at = new Date()) {
  const window = Math.floor(at.getTime() / CHECKIN_WINDOW_MS);
  const digest = crypto.createHmac('sha256', Buffer.from(secretHex, 'hex')).update(`${shopId}:${window}`).digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

/** الكود صحيح للدقيقة دي أو اللي قبلها؟ */
export function verifyCheckin(secretHex, shopId, code, now = new Date()) {
  const given = String(code ?? '');
  return [now, new Date(now.getTime() - CHECKIN_WINDOW_MS)]
    .some((at) => safeEqual(checkinCode(secretHex, shopId, at), given));
}

/** إمتى الكود الحالي يتغيّر (للشاشة) */
export const checkinExpiresAt = (now = new Date()) =>
  new Date((Math.floor(now.getTime() / CHECKIN_WINDOW_MS) + 1) * CHECKIN_WINDOW_MS);
