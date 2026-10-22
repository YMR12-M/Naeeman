/**
 * التحقّق من هوية الموظف عبر Access Token (ترويسة `Authorization: Bearer`).
 *
 * `authenticate`      → يرفض الطلب إن لم يكن هناك توكن صالح، ويرفض أيضًا
 *                       الحساب الذي عليه تغيير كلمة المرور حتى يغيّرها.
 * `authenticateLoose` → نفسه لكن يسمح بالمرور في حالة تغيير كلمة المرور؛
 *                       للمسارات التي تحتاجها هذه الحالة فقط (me، تغيير
 *                       الكلمة، الخروج).
 *
 * نُحمّل المستخدم من القاعدة في كل طلب (لا نثق بالدور داخل التوكن وحده):
 * إيقاف حساب أو تغيير دوره يسري فورًا لا بعد انتهاء التوكن.
 * وتوكن الزبون (audience مختلف) مرفوض هنا تمامًا.
 */
import { verifyAccessToken } from '../utils/security.js';
import { queryOne } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export function extractBearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

export const loadUser = (userId) => queryOne(
  `SELECT u.id, u.uuid, u.shop_id, u.full_name, u.email, u.phone, u.role, u.status,
          u.must_change_password, u.created_at,
          s.name AS shop_name, s.slug AS shop_slug, s.status AS shop_status
     FROM users u
     JOIN shops s ON s.id = u.shop_id
    WHERE u.id = ? AND u.deleted_at IS NULL`,
  [userId],
);

/** يفكّ التوكن ويرمي ApiError برسالة مفهومة لو منتهي أو غير صالح */
export function decodeBearer(req, audience) {
  const token = extractBearer(req);
  if (!token) throw ApiError.unauthorized('لازم تسجّل الدخول للمتابعة', { code: 'NO_TOKEN' });
  try {
    return verifyAccessToken(token, audience);
  } catch (error) {
    const expired = error.name === 'TokenExpiredError';
    throw ApiError.unauthorized(
      expired ? 'انتهت الجلسة، جدّد الدخول' : 'توكن غير صالح',
      { code: expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID' },
    );
  }
}

function makeAuthenticator({ allowPasswordChange }) {
  return asyncHandler(async (req, _res, next) => {
    const payload = decodeBearer(req, 'staff');

    const user = await loadUser(Number(payload.sub));
    if (!user) throw ApiError.unauthorized('الحساب غير موجود', { code: 'USER_NOT_FOUND' });
    if (user.status !== 'active') {
      throw ApiError.forbidden('الحساب موقوف — كلّم المالك', { code: 'USER_SUSPENDED' });
    }
    if (user.shop_status !== 'active') {
      throw ApiError.forbidden('اشتراك المحل موقوف — كلّم الدعم', { code: 'SHOP_SUSPENDED' });
    }
    if (user.must_change_password && !allowPasswordChange) {
      throw ApiError.forbidden('لازم تغيّر كلمة المرور الأول', { code: 'PASSWORD_CHANGE_REQUIRED' });
    }

    req.user = user;
    req.shopId = user.shop_id;
    // لحظة انتهاء التوكن: الـ streams المفتوحة بتتقفل عندها وتتفتح بتوكن جديد
    req.authExpiresAt = payload.exp * 1000;
    next();
  });
}

export const authenticate = makeAuthenticator({ allowPasswordChange: false });
export const authenticateLoose = makeAuthenticator({ allowPasswordChange: true });
