/**
 * تجمّع اتصالات MySQL (Connection Pool) + مساعدات الاستعلام.
 *
 * لماذا Pool وليس اتصالًا واحدًا؟ لأن كل طلب HTTP يستعير اتصالًا ثم
 * يعيده، فنتجنّب كلفة فتح اتصال جديد ونحمي القاعدة من الإغراق.
 *
 * ملاحظات مهمّة:
 *  • كل الاستعلامات مُعامَلة (parameterized) — لا نبني SQL بدمج نصوص
 *    من المستخدم إطلاقًا. الاستثناء الوحيد LIMIT/OFFSET: أرقام صحيحة
 *    تُتحقَّق قبل الدمج (prepared statements في MySQL 8 تتعثّر بها).
 *  • الدوال نفسها تعمل داخل المعاملة وخارجها: `transaction()` تمرّر
 *    كائنًا بنفس الواجهة (query / queryOne / execute) مربوطًا باتصال
 *    المعاملة، فلا يضطرّ كود الخدمات لمعرفة أين يعمل.
 *  • التواريخ (DATE) تصل نصًّا `YYYY-MM-DD` بلا تحويل منطقة زمنية،
 *    والأوقات (TIMESTAMP) تصل كـ Date بتوقيت UTC.
 */
import mysql from 'mysql2/promise';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

export const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: env.db.connectionLimit,
  queueLimit: 0,
  charset: 'utf8mb4_unicode_ci',
  timezone: 'Z',
  dateStrings: ['DATE'],
  decimalNumbers: true,
  ssl: env.db.ssl ? { rejectUnauthorized: true } : undefined,
});

/**
 * توقيت جلسة MySQL = UTC دائمًا.
 *
 * خيار `timezone: 'Z'` أعلاه يخبر الـ driver كيف يفسّر التواريخ، لكنه لا يغيّر
 * توقيت جلسة MySQL نفسها. لو كان السيرفر على توقيت جهازك (القاهرة UTC+3 مثلًا)
 * فـ `NOW()` تُرجع وقتًا محليًا يقرؤه الـ driver على أنه UTC، فتنحرف كل
 * مقارنة بين وقت التطبيق ووقت القاعدة ثلاث ساعات: حساب مقفول لا ينفكّ،
 * جلسة لا تنتهي، حجز معلّق لا يُحرَّر في موعده. نثبّت الجلسة على UTC لكل
 * اتصال جديد فتتطابق المنطقتان في أي بيئة.
 */
pool.pool.on('connection', (connection) => {
  connection.query("SET time_zone = '+00:00'");
});

/** undefined ← null، وbool ← 0/1 (الـ driver يرفض الأول ويتلخبط في الثاني) */
const clean = (params) => params.map((value) => {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
});

/** يربط واجهة الاستعلام باتصال بعينه (الـ pool أو اتصال معاملة) */
function bind(connection) {
  const execute = async (sql, params = []) => (await connection.execute(sql, clean(params)))[0];
  return {
    /** يعيد مصفوفة صفوف */
    query: execute,
    /** يعيد أول صف أو null */
    queryOne: async (sql, params = []) => (await execute(sql, params))[0] ?? null,
    /** INSERT/UPDATE/DELETE ← { insertId, affectedRows, ... } */
    execute,
  };
}

export const { query, queryOne, execute } = bind(pool);

/**
 * تشغيل مجموعة عمليات داخل معاملة (Transaction).
 * COMMIT تلقائي عند النجاح، و ROLLBACK عند أي خطأ، ويُعاد الاتصال للـ pool دائمًا.
 *
 * @example
 *   await transaction(async (tx) => {
 *     await tx.execute('UPDATE ...', [..]);
 *     return tx.queryOne('SELECT ...');
 *   });
 */
export async function transaction(handler) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await handler(bind(connection));
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch { /* الاتصال نفسه انقطع */ }
    throw error;
  } finally {
    connection.release();
  }
}

/** علامات استفهام لقائمة IN: placeholders(3) → '?,?,?' */
export const placeholders = (count) => Array.from({ length: count }, () => '?').join(',');

/** رقم صحيح آمن للدمج في LIMIT/OFFSET */
export function safeInt(value, { min = 0, max = 1_000_000, fallback = 0 } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/** هل الخطأ تكرار قيمة فريدة؟ ويحمل اسم القيد (للتمييز بين أكثر من قيد) */
export const isDuplicate = (error, constraint) =>
  error?.code === 'ER_DUP_ENTRY' && (!constraint || String(error.sqlMessage || '').includes(constraint));

/** فحص الاتصال عند الإقلاع — نفضّل الفشل المبكر الواضح */
export async function assertDatabaseConnection() {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    logger.success(`قاعدة البيانات متصلة: ${env.db.database}@${env.db.host}:${env.db.port}`);
    return true;
  } catch (error) {
    logger.error(`تعذّر الاتصال بقاعدة البيانات: ${error.message}`);
    return false;
  }
}

export const closePool = () => pool.end();
