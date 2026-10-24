/**
 * ═══════════════════════════════════════════════════════════════
 *  حسابات الزباين: تسجيل ودخول برقم الموبايل وكلمة سر
 *
 *  نفس قرارات أمان الموظفين (توكن قصير + تجديد دوّار ببصمة بس + كشف
 *  السرقة + قفل بعد محاولات فاشلة + رسالة واحدة لأي فشل)، بس في جداول
 *  منفصلة وبجمهور توكن مختلف: توكن الزبون ما يفتحش أي مسار موظفين.
 *
 *  مفيش SMS: استعادة كلمة السر بالبريد لو الزبون حطّه، وإلا بكود من 6
 *  أرقام بيطلّعه الاستقبال في المحل. الرد على «نسيت» واحد دايمًا، فما
 *  بيكشفش مين مسجّل.
 * ═══════════════════════════════════════════════════════════════
 */
import crypto from 'node:crypto';
import { queryOne, execute, transaction, isDuplicate } from '../../config/db.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import {
  hashPassword, verifyPassword, fakeVerifyPassword, signCustomerToken,
  randomToken, sha256, expiryFromNow, ttlToMs,
} from '../../utils/security.js';
import { enqueueEmail } from '../../services/notifications/outbox.js';

const BAD_CREDENTIALS = 'رقم الموبايل أو كلمة السر غلط';
const REUSE_GRACE_MS = 10_000;
const SHOP_CODE_MINUTES = 15;
const SHOP_CODE_ATTEMPTS = 5;

/** بصمة كود المحل مربوطة برقم الطلب: نفس الكود لطلب تاني بصمته مختلفة */
const shopCodeHash = (requestId, code) => sha256(`shop-reset:${requestId}:${code}`);

export const loadCustomer = (customerId) => queryOne(
  'SELECT id, uuid, name, phone, email, status, created_at FROM customers WHERE id = ?',
  [customerId],
);

export const toPublicCustomer = (customer) => ({
  id: customer.id,
  uuid: customer.uuid,
  name: customer.name,
  phone: customer.phone,
  email: customer.email,
  created_at: customer.created_at,
});

async function issueRefreshToken(customer, context, familyId = crypto.randomUUID()) {
  const token = randomToken(48);
  const ttl = context.clientType === 'web' ? env.jwt.refreshTtl : env.jwt.refreshTtlApp;
  const expiresAt = expiryFromNow(ttl);
  await execute(
    `INSERT INTO customer_refresh_tokens (customer_id, family_id, token_hash, client_type, user_agent, ip_address, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [customer.id, familyId, sha256(token), context.clientType, context.userAgent || null, context.ip || null, expiresAt],
  );
  return { token, expiresAt, familyId };
}

async function startSession(customer, context, familyId) {
  return {
    customer: toPublicCustomer(customer),
    access_token: signCustomerToken(customer),
    expires_in: Math.floor(ttlToMs(env.jwt.accessTtl) / 1000),
    refresh: await issueRefreshToken(customer, context, familyId),
  };
}

const revokeFamily = (familyId) =>
  execute('UPDATE customer_refresh_tokens SET revoked_at = NOW() WHERE family_id = ? AND revoked_at IS NULL', [familyId]);

const revokeAll = (customerId) =>
  execute('UPDATE customer_refresh_tokens SET revoked_at = NOW() WHERE customer_id = ? AND revoked_at IS NULL', [customerId]);

function duplicateError(error) {
  if (isDuplicate(error, 'uq_customers_phone')) {
    return ApiError.conflict('الرقم ده عليه حساب بالفعل — سجّل دخول', { code: 'PHONE_TAKEN', details: { phone: 'عليه حساب بالفعل' } });
  }
  if (isDuplicate(error, 'uq_customers_email')) {
    return ApiError.conflict('البريد ده مستخدم في حساب تاني', { code: 'EMAIL_TAKEN', details: { email: 'مستخدم في حساب تاني' } });
  }
  return null;
}

export const customerAuthService = {
  async register({ name, phone, password, email }, context) {
    let id;
    try {
      const result = await execute(
        'INSERT INTO customers (uuid, phone, name, email, password_hash, last_login_at) VALUES (?, ?, ?, ?, ?, NOW())',
        [crypto.randomUUID(), phone, name, email ?? null, await hashPassword(password)],
      );
      id = result.insertId;
    } catch (error) {
      throw duplicateError(error) ?? error;
    }
    return startSession(await loadCustomer(id), context);
  },

  async login({ phone, password }, context) {
    const row = await queryOne(
      'SELECT id, password_hash, failed_logins, locked_until, status FROM customers WHERE phone = ?',
      [phone],
    );
    if (!row) {
      await fakeVerifyPassword(password);
      throw ApiError.unauthorized(BAD_CREDENTIALS, { code: 'BAD_CREDENTIALS' });
    }
    if (row.locked_until && row.locked_until.getTime() > Date.now()) {
      const minutes = Math.max(1, Math.ceil((row.locked_until.getTime() - Date.now()) / 60_000));
      throw ApiError.locked(`الحساب مقفول مؤقتًا بسبب محاولات كتير — جرّب بعد ${minutes} دقيقة`, { code: 'ACCOUNT_LOCKED' });
    }
    if (!(await verifyPassword(password, row.password_hash))) {
      const failed = row.failed_logins + 1;
      if (failed >= env.auth.maxFailedLogins) {
        await execute(
          'UPDATE customers SET failed_logins = 0, locked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?',
          [env.auth.lockMinutes, row.id],
        );
      } else {
        await execute('UPDATE customers SET failed_logins = ? WHERE id = ?', [failed, row.id]);
      }
      throw ApiError.unauthorized(BAD_CREDENTIALS, { code: 'BAD_CREDENTIALS' });
    }
    if (row.status !== 'active') throw ApiError.forbidden('الحساب موقوف', { code: 'CUSTOMER_BLOCKED' });

    await execute('UPDATE customers SET failed_logins = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?', [row.id]);
    return startSession(await loadCustomer(row.id), context);
  },

  async refresh(rawToken, context) {
    const record = await queryOne(
      'SELECT id, customer_id, family_id, used_at, revoked_at, expires_at FROM customer_refresh_tokens WHERE token_hash = ?',
      [sha256(rawToken)],
    );
    if (!record) throw ApiError.unauthorized('الجلسة غير صالحة — سجّل الدخول من جديد', { code: 'SESSION_INVALID' });
    if (record.revoked_at) throw ApiError.unauthorized('الجلسة انتهت — سجّل الدخول من جديد', { code: 'SESSION_REVOKED' });
    if (record.used_at) {
      if (Date.now() - record.used_at.getTime() < REUSE_GRACE_MS) {
        throw ApiError.unauthorized('جلسة قيد التجديد — حاول تاني', { code: 'REFRESH_IN_PROGRESS' });
      }
      await revokeFamily(record.family_id);
      throw ApiError.unauthorized('الجلسة اتستخدمت من مكان تاني — سجّل الدخول من جديد', { code: 'SESSION_REUSED' });
    }
    if (record.expires_at.getTime() < Date.now()) {
      throw ApiError.unauthorized('انتهت الجلسة — سجّل الدخول من جديد', { code: 'SESSION_EXPIRED' });
    }
    const customer = await loadCustomer(record.customer_id);
    if (!customer || customer.status !== 'active') {
      await revokeFamily(record.family_id);
      throw ApiError.unauthorized('الحساب غير متاح', { code: 'CUSTOMER_UNAVAILABLE' });
    }
    const claimed = await execute(
      'UPDATE customer_refresh_tokens SET used_at = NOW() WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL',
      [record.id],
    );
    if (claimed.affectedRows === 0) {
      throw ApiError.unauthorized('جلسة قيد التجديد — حاول تاني', { code: 'REFRESH_IN_PROGRESS' });
    }
    return startSession(customer, context, record.family_id);
  },

  async logout(rawToken) {
    if (!rawToken) return;
    const record = await queryOne('SELECT family_id FROM customer_refresh_tokens WHERE token_hash = ?', [sha256(rawToken)]);
    if (record) await revokeFamily(record.family_id);
  },

  async updateProfile(customer, changes) {
    const sets = [];
    const params = [];
    for (const column of ['name', 'email']) {
      if (changes[column] !== undefined) { sets.push(`${column} = ?`); params.push(changes[column]); }
    }
    if (sets.length > 0) {
      try {
        await execute(`UPDATE customers SET ${sets.join(', ')} WHERE id = ?`, [...params, customer.id]);
      } catch (error) {
        throw duplicateError(error) ?? error;
      }
    }
    return toPublicCustomer(await loadCustomer(customer.id));
  },

  async changePassword(customer, { current_password: current, new_password: next }, context) {
    const row = await queryOne('SELECT password_hash FROM customers WHERE id = ?', [customer.id]);
    if (!(await verifyPassword(current, row.password_hash))) {
      throw ApiError.badRequest('كلمة السر الحالية غلط', { code: 'WRONG_PASSWORD', details: { current_password: 'غلط' } });
    }
    await execute('UPDATE customers SET password_hash = ? WHERE id = ?', [await hashPassword(next), customer.id]);
    await revokeAll(customer.id);
    return startSession(await loadCustomer(customer.id), context);
  },

  /** دايمًا ينجح ظاهريًا. لو الحساب مالوش بريد، مفيش حاجة تتبعت. */
  async forgotPassword({ phone }) {
    const customer = await queryOne(
      "SELECT id, name, email FROM customers WHERE phone = ? AND status = 'active' AND email IS NOT NULL",
      [phone],
    );
    if (!customer) return;
    const token = randomToken(48);
    await transaction(async (tx) => {
      await tx.execute('UPDATE customer_password_resets SET used_at = NOW() WHERE customer_id = ? AND used_at IS NULL', [customer.id]);
      await tx.execute(
        'INSERT INTO customer_password_resets (customer_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))',
        [customer.id, sha256(token)],
      );
      await enqueueEmail({
        to: customer.email,
        template: 'customer_password_reset',
        payload: { name: customer.name, link: `${env.customerAppUrl}/reset-password?token=${token}` },
      }, tx);
    });
  },

  async resetPassword({ token, new_password: next }) {
    const record = await queryOne(
      'SELECT id, customer_id FROM customer_password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()',
      [sha256(token)],
    );
    if (!record) throw ApiError.badRequest('الرابط غير صالح أو انتهت صلاحيته — اطلب رابط جديد', { code: 'RESET_INVALID' });
    const passwordHash = await hashPassword(next);
    await transaction(async (tx) => {
      await tx.execute(
        'UPDATE customers SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?',
        [passwordHash, record.customer_id],
      );
      await tx.execute('UPDATE customer_password_resets SET used_at = NOW() WHERE id = ?', [record.id]);
      await tx.execute('UPDATE customer_refresh_tokens SET revoked_at = NOW() WHERE customer_id = ? AND revoked_at IS NULL', [record.customer_id]);
    });
  },

  /**
   * كود استعادة من المحل (للزبون اللي مالوش بريد): الاستقبال بيطلّعه وهو
   * شايف الزبون قدّامه. أي كود قديم مش مستعمل بيتلغي.
   */
  async issueShopCode(phone, issuedBy) {
    const customer = await queryOne("SELECT id, name, phone FROM customers WHERE phone = ? AND status = 'active'", [phone]);
    if (!customer) throw ApiError.notFound('مفيش حساب زبون بالرقم ده', { code: 'CUSTOMER_NOT_FOUND' });
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    await transaction(async (tx) => {
      await tx.execute('UPDATE customer_password_resets SET used_at = NOW() WHERE customer_id = ? AND used_at IS NULL', [customer.id]);
      const inserted = await tx.execute(
        `INSERT INTO customer_password_resets (customer_id, kind, token_hash, expires_at, issued_by)
         VALUES (?, 'shop', ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), ?)`,
        [customer.id, sha256(randomToken(32)), SHOP_CODE_MINUTES, issuedBy],
      );
      await tx.execute('UPDATE customer_password_resets SET code_hash = ? WHERE id = ?', [shopCodeHash(inserted.insertId, code), inserted.insertId]);
    });
    return { customer: { id: customer.id, name: customer.name, phone: customer.phone }, code, expires_in_minutes: SHOP_CODE_MINUTES };
  },

  async resetWithShopCode({ phone, code, new_password: next }) {
    const invalid = () => ApiError.badRequest('الكود غلط أو انتهى — اطلب كود جديد من المحل', { code: 'RESET_INVALID' });
    const record = await queryOne(
      `SELECT r.id, r.customer_id, r.code_hash, r.attempts
         FROM customer_password_resets r JOIN customers c ON c.id = r.customer_id
        WHERE c.phone = ? AND c.status = 'active' AND r.kind = 'shop' AND r.used_at IS NULL AND r.expires_at > NOW()
        ORDER BY r.id DESC LIMIT 1`,
      [phone],
    );
    if (!record || !record.code_hash) throw invalid();
    const expected = Buffer.from(record.code_hash, 'hex');
    const actual = Buffer.from(shopCodeHash(record.id, code), 'hex');
    if (!crypto.timingSafeEqual(expected, actual)) {
      // بعد آخر محاولة الكود بيتحرق، والزبون يرجع للمحل
      await execute(
        'UPDATE customer_password_resets SET attempts = attempts + 1, used_at = IF(attempts + 1 >= ?, NOW(), used_at) WHERE id = ?',
        [SHOP_CODE_ATTEMPTS, record.id],
      );
      throw invalid();
    }
    const passwordHash = await hashPassword(next);
    await transaction(async (tx) => {
      await tx.execute(
        'UPDATE customers SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?',
        [passwordHash, record.customer_id],
      );
      await tx.execute('UPDATE customer_password_resets SET used_at = NOW() WHERE id = ?', [record.id]);
      await tx.execute('UPDATE customer_refresh_tokens SET revoked_at = NOW() WHERE customer_id = ? AND revoked_at IS NULL', [record.customer_id]);
    });
  },

  async subscribePush(customerId, { endpoint, keys }, userAgent) {
    await execute(
      `INSERT INTO push_subscriptions (customer_id, endpoint, endpoint_hash, p256dh, auth, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE customer_id = VALUES(customer_id), p256dh = VALUES(p256dh), auth = VALUES(auth)`,
      [customerId, endpoint, sha256(endpoint), keys.p256dh, keys.auth, userAgent || null],
    );
  },

  async unsubscribePush(customerId, endpoint) {
    await execute('DELETE FROM push_subscriptions WHERE customer_id = ? AND endpoint_hash = ?', [customerId, sha256(endpoint)]);
  },
};
