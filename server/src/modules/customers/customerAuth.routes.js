/**
 * مسارات دخول الزبون. نفس شكل جلسة الموظفين:
 *  • تطبيق الويب (PWA): توكن التجديد في كوكي httpOnly، وطلب التجديد
 *    لازم فيه ترويسة X-Client-Type (حماية CSRF).
 *  • تطبيق الموبايل (Capacitor): التوكن في الجسم ويتخزّن في مخزن آمن.
 */
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { validate } from '../../middleware/validate.js';
import { loginLimiter, passwordResetLimiter, registerLimiter } from '../../middleware/rateLimiters.js';
import { ApiError } from '../../utils/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created, noContent } from '../../utils/response.js';
import { customerPasswordSchema, emailSchema, phoneSchema } from '../../utils/schemas.js';
import { customerAuthService as service } from './customerAuth.service.js';

const COOKIE = 'naeeman_crt';

const optionalEmail = z.union([emailSchema, z.literal('').transform(() => null), z.null()]).optional();

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(60),
  phone: phoneSchema,
  password: customerPasswordSchema,
  email: optionalEmail,
}).strict();

const loginSchema = z.object({ phone: phoneSchema, password: z.string().min(1).max(128) });
const refreshSchema = z.object({ refresh_token: z.string().min(20).max(300).optional() });
const forgotSchema = z.object({ phone: phoneSchema });
const resetSchema = z.object({ token: z.string().min(20).max(300), new_password: customerPasswordSchema });
const shopCodeResetSchema = z.object({
  phone: phoneSchema,
  code: z.string().trim().regex(/^\d{6}$/, 'الكود 6 أرقام'),
  new_password: customerPasswordSchema,
}).strict();

const cookieOptions = (expires) => ({
  httpOnly: true,
  secure: env.cookie.secure,
  sameSite: env.cookie.sameSite,
  path: `${env.apiPrefix}/customer-auth`,
  ...(env.cookie.domain ? { domain: env.cookie.domain } : {}),
  ...(expires ? { expires } : {}),
});

const clearCookie = (res) => res.clearCookie(COOKIE, cookieOptions());

export function sendCustomerSession(req, res, session, status = 200) {
  const isWeb = req.context.clientType === 'web';
  if (isWeb) res.cookie(COOKIE, session.refresh.token, cookieOptions(session.refresh.expiresAt));
  return (status === 201 ? created : ok)(res, {
    customer: session.customer,
    tokens: {
      access_token: session.access_token,
      token_type: 'Bearer',
      expires_in: session.expires_in,
      ...(isWeb ? {} : { refresh_token: session.refresh.token, refresh_expires_at: session.refresh.expiresAt }),
    },
  });
}

function readRefreshToken(req) {
  if (req.body?.refresh_token) return req.body.refresh_token;
  const cookie = req.cookies?.[COOKIE];
  if (cookie && !req.headers['x-client-type']) throw ApiError.forbidden('طلب غير مسموح', { code: 'CSRF' });
  return cookie || null;
}

const router = Router();

router.post('/register', registerLimiter, validate({ body: registerSchema }), asyncHandler(async (req, res) =>
  sendCustomerSession(req, res, await service.register(req.body, req.context), 201)));

router.post('/login', loginLimiter, validate({ body: loginSchema }), asyncHandler(async (req, res) =>
  sendCustomerSession(req, res, await service.login(req.body, req.context))));

router.post('/refresh', validate({ body: refreshSchema }), asyncHandler(async (req, res) => {
  const token = readRefreshToken(req);
  if (!token) throw ApiError.unauthorized('مفيش جلسة — سجّل الدخول', { code: 'NO_SESSION' });
  try {
    sendCustomerSession(req, res, await service.refresh(token, req.context));
  } catch (error) {
    if (error.code && error.code.startsWith('SESSION_')) clearCookie(res);
    throw error;
  }
}));

router.post('/logout', validate({ body: refreshSchema }), asyncHandler(async (req, res) => {
  await service.logout(readRefreshToken(req));
  clearCookie(res);
  noContent(res);
}));

router.post('/forgot-password', passwordResetLimiter, validate({ body: forgotSchema }), asyncHandler(async (req, res) => {
  await service.forgotPassword(req.body);
  ok(res, { message: 'لو الرقم عليه حساب وفيه بريد، هيوصلك رابط الاستعادة خلال دقايق. لو مفيش بريد، كلّم المحل.' });
}));

router.post('/reset-password', passwordResetLimiter, validate({ body: resetSchema }), asyncHandler(async (req, res) => {
  await service.resetPassword(req.body);
  ok(res, { message: 'كلمة السر اتغيّرت — سجّل الدخول' });
}));

/** بالكود اللي الاستقبال طلّعه في المحل (للزبون اللي مالوش بريد) */
router.post('/reset-with-code', passwordResetLimiter, validate({ body: shopCodeResetSchema }), asyncHandler(async (req, res) => {
  await service.resetWithShopCode(req.body);
  ok(res, { message: 'كلمة السر اتغيّرت — سجّل الدخول' });
}));

export default router;
