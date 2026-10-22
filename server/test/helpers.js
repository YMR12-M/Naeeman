/**
 * أدوات الاختبارات: قاعدة نظيفة، محل جاهز، مالك جاهز، تسجيل دخول.
 *
 * الاختبارات تعمل على قاعدة `naeeman_test` فقط (env.js يرفض أي اسم لا ينتهي
 * بـ _test). كل ملف اختبار يبدأ بقاعدة فارغة.
 */
import crypto from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool, pool, execute } from '../src/config/db.js';
import { migrateUp } from '../src/db/migrate.js';
import { hashPassword } from '../src/utils/security.js';

export const PASSWORD = 'Str0ng-Pass-123!';
export const API = '/api/v1';

export async function resetDatabase() {
  await migrateUp();
  const connection = await pool.getConnection();
  try {
    const [tables] = await connection.query(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name <> 'schema_migrations'",
    );
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const { name } of tables) await connection.query(`TRUNCATE TABLE \`${name}\``);
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    connection.release();
  }
}

export const shutdown = () => closePool();

export function makeApp() {
  const app = createApp();
  return { app, http: request(app) };
}

let shopCounter = 0;

/** محل بقواعد الطابور الافتراضية (زي ما db:bootstrap بيعمل) */
export async function seedShop({ name = 'صالون الاختبار', slug, timezone = 'Africa/Cairo' } = {}) {
  shopCounter += 1;
  const result = await execute(
    'INSERT INTO shops (uuid, name, slug, timezone, checkin_secret) VALUES (?, ?, ?, ?, ?)',
    [crypto.randomUUID(), name, slug ?? `test-shop-${shopCounter}`, timezone, crypto.randomBytes(32).toString('hex')],
  );
  await execute('INSERT INTO shop_settings (shop_id) VALUES (?)', [result.insertId]);
  await execute('INSERT INTO shop_state (shop_id) VALUES (?)', [result.insertId]);
  return result.insertId;
}

export async function seedUser({
  shopId, role = 'owner', email, password = PASSWORD, fullName = 'مستخدم اختبار', mustChangePassword = false,
}) {
  const result = await execute(
    `INSERT INTO users (uuid, shop_id, full_name, email, password_hash, role, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), shopId, fullName, email, await hashPassword(password), role, mustChangePassword],
  );
  return { id: result.insertId, email, password };
}

/** يسجّل الدخول ويعيد { token, cookie, body } */
export async function login(http, email, password = PASSWORD, clientType = 'web') {
  const response = await http
    .post(`${API}/auth/login`)
    .set('X-Client-Type', clientType)
    .send({ email, password });
  return {
    status: response.status,
    body: response.body,
    token: response.body?.data?.tokens?.access_token,
    refreshToken: response.body?.data?.tokens?.refresh_token,
    cookie: (response.headers['set-cookie'] || [])[0]?.split(';')[0],
    response,
  };
}

export const bearer = (token) => ({ Authorization: `Bearer ${token}` });

/** محل + مالك + تسجيل دخول في خطوة واحدة */
export async function bootstrapOwner(http, { email = 'owner@test.local', shop = {} } = {}) {
  const shopId = await seedShop(shop);
  const owner = await seedUser({ shopId, role: 'owner', email });
  const session = await login(http, email);
  return { shopId, owner, token: session.token };
}

/** موظف بدور معيّن في نفس المحل + توكنه */
export async function staffToken(http, shopId, role, email = `${role}-${crypto.randomUUID().slice(0, 6)}@test.local`) {
  await seedUser({ shopId, role, email });
  return (await login(http, email)).token;
}
