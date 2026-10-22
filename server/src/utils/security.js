/**
 * ═══════════════════════════════════════════════════════════════
 *  أدوات الأمان: كلمات المرور، التوكنات، البصمات
 * ═══════════════════════════════════════════════════════════════
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/* ── كلمات المرور ─────────────────────────────────────────────── */

export const hashPassword = (plain) => bcrypt.hash(plain, env.auth.bcryptRounds);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

let dummyHash = null;
/**
 * مقارنة وهمية تستهلك نفس زمن المقارنة الحقيقية. تُستدعى لما يكون
 * البريد غير موجود، حتى لا يُكشف وجود الحساب من فرق زمن الرد.
 */
export async function fakeVerifyPassword(plain) {
  dummyHash ??= await bcrypt.hash('naeeman-timing-equalizer', env.auth.bcryptRounds);
  await bcrypt.compare(plain, dummyHash);
}

const COMMON_PASSWORDS = new Set([
  'password', 'password1', '12345678', '123456789', '1234567890', 'qwertyuiop',
  'iloveyou', 'admin12345', 'naeeman123', 'welcome123', 'abc123456',
]);

/** يُرجع قائمة مشاكل كلمة المرور (فارغة = مقبولة) */
export function passwordIssues(password) {
  const issues = [];
  if (password.length < 10) issues.push('10 حروف على الأقل');

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/]
    .filter((pattern) => pattern.test(password)).length;
  if (classes < 2 && password.length < 16) issues.push('تجمع نوعين على الأقل: حروف، أرقام، رموز (أو تكون 16 حرفًا فأكثر)');

  if (/^(.)\1+$/.test(password)) issues.push('ليست حرفًا مكرّرًا');
  if (COMMON_PASSWORDS.has(password.toLowerCase())) issues.push('ليست من كلمات المرور الشائعة');
  return issues;
}

/** كلمة مرور مؤقتة مقروءة (بلا حروف ملتبسة) */
export function generateTempPassword(length = 12) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return `${out}#7`;
}

/* ── التوكنات ─────────────────────────────────────────────────── */

const ISSUER = 'naeeman';
/** جمهوران منفصلان: توكن الزبون لا يفتح مسارات الموظفين والعكس */
export const AUDIENCE = { staff: 'naeeman-staff', customer: 'naeeman-customer' };

/** توكن دخول موظف */
export function signAccessToken(user) {
  return jwt.sign(
    { role: user.role, shop: user.shop_id },
    env.jwt.accessSecret,
    {
      subject: String(user.id),
      expiresIn: env.jwt.accessTtl,
      issuer: ISSUER,
      audience: AUDIENCE.staff,
      algorithm: 'HS256',
    },
  );
}

/** توكن دخول زبون */
export function signCustomerToken(customer) {
  return jwt.sign({}, env.jwt.accessSecret, {
    subject: String(customer.id),
    expiresIn: env.jwt.accessTtl,
    issuer: ISSUER,
    audience: AUDIENCE.customer,
    algorithm: 'HS256',
  });
}

/** يرمي TokenExpiredError أو JsonWebTokenError — audience: 'staff' | 'customer' */
export function verifyAccessToken(token, audience = 'staff') {
  return jwt.verify(token, env.jwt.accessSecret, {
    issuer: ISSUER,
    audience: AUDIENCE[audience],
    algorithms: ['HS256'],
  });
}

/** نص عشوائي آمن للروابط والتوكنات (لا يُخزَّن إلا بصمته) */
export const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** "15m" · "12h" · "30d" ← ميلي ثانية */
export function ttlToMs(ttl) {
  const match = /^(\d+)\s*([smhd])$/.exec(String(ttl).trim());
  if (!match) throw new Error(`مدّة غير صالحة: ${ttl} (الصيغة: 15m أو 12h أو 30d)`);
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]];
  return Number(match[1]) * unit;
}

export const expiryFromNow = (ttl) => new Date(Date.now() + ttlToMs(ttl));

/** مقارنة نصّين بزمن ثابت (لا تكشف طول التطابق) */
export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
