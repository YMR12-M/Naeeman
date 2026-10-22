import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, noContent } from '../../utils/response.js';
import { audit } from '../../utils/audit.js';
import { authService } from './auth.service.js';

const cookieOptions = (expires) => ({
  httpOnly: true,
  secure: env.cookie.secure,
  sameSite: env.cookie.sameSite,
  path: `${env.apiPrefix}/auth`,
  ...(env.cookie.domain ? { domain: env.cookie.domain } : {}),
  ...(expires ? { expires } : {}),
});

const clearRefreshCookie = (res) => res.clearCookie(env.cookie.name, cookieOptions());

/**
 * شكل الجلسة المُرسَل:
 *  • الويب: توكن التجديد في كوكي httpOnly (لا يصل لجافاسكربت الصفحة)،
 *    فلا تسرقه ثغرة XSS.
 *  • التطبيقات (موبايل/ديسكتوب): في الجسم، لتخزّنه في مخزن آمن بالجهاز.
 */
function sendSession(req, res, session, status = 200) {
  const isWeb = req.context.clientType === 'web';
  if (isWeb) res.cookie(env.cookie.name, session.refresh.token, cookieOptions(session.refresh.expiresAt));

  return ok(res, {
    user: session.user,
    tokens: {
      access_token: session.access_token,
      token_type: 'Bearer',
      expires_in: session.expires_in,
      ...(isWeb ? {} : {
        refresh_token: session.refresh.token,
        refresh_expires_at: session.refresh.expiresAt,
      }),
    },
  }, status);
}

/**
 * توكن التجديد من الجسم (تطبيقات) أو الكوكي (ويب).
 * عند الكوكي نطلب ترويسة `X-Client-Type`: ترويسة غير بسيطة تُجبر المتصفّح
 * على preflight الذي لا تجتازه إلا نطاقاتنا المسموحة — حماية CSRF.
 */
function readRefreshToken(req) {
  if (req.body?.refresh_token) return req.body.refresh_token;
  const cookie = req.cookies?.[env.cookie.name];
  if (cookie && !req.headers['x-client-type']) {
    throw ApiError.forbidden('طلب غير مسموح', { code: 'CSRF' });
  }
  return cookie || null;
}

export const authController = {
  login: asyncHandler(async (req, res) => {
    const session = await authService.login(req.body, req.context);
    await audit(req, { action: 'auth.login', entity: 'user', entityId: session.user.id, userId: session.user.id, shopId: session.user.shop.id });
    sendSession(req, res, session);
  }),

  refresh: asyncHandler(async (req, res) => {
    const token = readRefreshToken(req);
    if (!token) throw ApiError.unauthorized('مفيش جلسة — سجّل الدخول', { code: 'NO_SESSION' });
    try {
      sendSession(req, res, await authService.refresh(token, req.context));
    } catch (error) {
      // جلسة منتهية/مسروقة: نمسح الكوكي كي لا يعيد المتصفّح إرسالها
      if (error.code && error.code.startsWith('SESSION_')) clearRefreshCookie(res);
      throw error;
    }
  }),

  logout: asyncHandler(async (req, res) => {
    await authService.logout(readRefreshToken(req));
    clearRefreshCookie(res);
    noContent(res);
  }),

  logoutAll: asyncHandler(async (req, res) => {
    await authService.logoutAll(req.user.id);
    clearRefreshCookie(res);
    noContent(res);
  }),

  me: asyncHandler(async (req, res) => ok(res, await authService.me(req.user))),

  updateProfile: asyncHandler(async (req, res) =>
    ok(res, await authService.updateProfile(req.user, req.body))),

  changePassword: asyncHandler(async (req, res) => {
    const session = await authService.changePassword(req.user, req.body, req.context);
    await audit(req, { action: 'auth.password_changed', entity: 'user', entityId: req.user.id });
    sendSession(req, res, session);
  }),

  forgotPassword: asyncHandler(async (req, res) => {
    await authService.forgotPassword(req.body);
    ok(res, { message: 'لو البريد مسجّل عندنا هيوصلك رابط الاستعادة خلال دقائق' });
  }),

  resetPassword: asyncHandler(async (req, res) => {
    await authService.resetPassword(req.body);
    ok(res, { message: 'تم تغيير كلمة المرور — سجّل الدخول' });
  }),

  listSessions: asyncHandler(async (req, res) => ok(res, await authService.listSessions(req.user.id))),

  revokeSession: asyncHandler(async (req, res) => {
    await authService.revokeSession(req.user.id, req.params.familyId);
    noContent(res);
  }),
};
