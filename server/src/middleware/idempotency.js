/**
 * منع التكرار (ترويسة `Idempotency-Key`).
 *
 * الطابور بيتلمس من تابلت جنب الكرسي ونت المحل ضعيف: الحلاق يدوس «التالي»،
 * الطلب يوصل السيرفر بس الرد يضيع، والتابلت يعيد المحاولة. من غير الحماية
 * دي الزبون التاني كان هيتقفل من غير ما يقعد. بالمفتاح، المحاولة التانية
 * بترجع نفس الرد الأوّل من غير ما تتنفّذ تاني.
 *
 *  • المفتاح اختياري؛ من غيره الطلب يتنفّذ عادي.
 *  • النطاق (scope) = صاحب الطلب (user:5 · customer:9 · device:3)، فمفتاحين
 *    متشابهين من جهازين ما يتخانقوش.
 *  • ردود 5xx ما بتتحفظش: المحاولة التانية من حقّها تتنفّذ.
 */
import { execute, queryOne, isDuplicate } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const KEY_RE = /^[\w-]{8,80}$/;

/** @param {(req) => string} scopeOf */
export const idempotent = (scopeOf) => asyncHandler(async (req, res, next) => {
  const key = req.headers['idempotency-key'];
  if (!key) return next();
  if (!KEY_RE.test(String(key))) {
    throw ApiError.badRequest('Idempotency-Key لازم 8 لـ 80 حرف (حروف وأرقام وشرطة)', { code: 'BAD_IDEMPOTENCY_KEY' });
  }
  const scope = scopeOf(req);

  try {
    await execute('INSERT INTO idempotency_keys (scope, idem_key) VALUES (?, ?)', [scope, key]);
  } catch (error) {
    if (!isDuplicate(error)) throw error;
    const saved = await queryOne(
      'SELECT status_code, body FROM idempotency_keys WHERE scope = ? AND idem_key = ?',
      [scope, key],
    );
    if (saved?.status_code) {
      res.setHeader('Idempotent-Replay', 'true');
      const body = typeof saved.body === 'string' ? JSON.parse(saved.body) : saved.body;
      return res.status(saved.status_code).json(body);
    }
    throw ApiError.conflict('الطلب ده لسه بيتنفّذ — استنّى ثانية', { code: 'IN_PROGRESS' });
  }

  // نحفظ الرد قبل ما يتبعت، عشان المحاولة التانية تلاقيه
  const send = res.json.bind(res);
  res.json = (body) => {
    const status = res.statusCode;
    const store = status >= 500
      ? execute('DELETE FROM idempotency_keys WHERE scope = ? AND idem_key = ?', [scope, key])
      : execute(
        'UPDATE idempotency_keys SET status_code = ?, body = ? WHERE scope = ? AND idem_key = ?',
        [status, JSON.stringify(body ?? null), scope, key],
      );
    store.catch(() => {}).finally(() => send(body));
    return res;
  };
  return next();
});

/** يمسح المفاتيح القديمة (المحاولات المكرّرة بتحصل خلال ثواني، يوم كفاية جدًا) */
export async function purgeIdempotencyKeys() {
  const result = await execute('DELETE FROM idempotency_keys WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 DAY)');
  return result.affectedRows;
}
