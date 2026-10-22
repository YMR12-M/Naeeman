/**
 * ═══════════════════════════════════════════════════════════════
 *  مشغّل الـ migrations
 *
 *  ملفات SQL مرقّمة في db/migrations تُنفَّذ بالترتيب مرّة واحدة لكل ملف،
 *  ويُسجَّل كل منها في جدول schema_migrations مع بصمته (checksum).
 *
 *  لو عدّلتَ ملفًا نُفِّذ من قبل نحذّرك ولا نعيد تنفيذه: التغيير على
 *  قاعدة قائمة يكون بملف migration جديد، لا بتعديل القديم.
 *
 *  الأوامر:
 *    npm run db:migrate     ينشئ القاعدة إن لم توجد وينفّذ الجديد فقط
 *    npm run db:status      يعرض ما نُفِّذ وما ينتظر
 *    npm run db:reset -- --yes   يحذف القاعدة ويعيد بناءها (ممنوع في الإنتاج)
 * ═══════════════════════════════════════════════════════════════
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

const baseConfig = {
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  ssl: env.db.ssl ? { rejectUnauthorized: true } : undefined,
  charset: 'utf8mb4_unicode_ci',
  multipleStatements: true,
};

const connect = (database) => mysql.createConnection({ ...baseConfig, database });

const quoteIdent = (name) => `\`${String(name).replace(/`/g, '')}\``;

export async function ensureDatabase() {
  const connection = await connect(undefined);
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS ${quoteIdent(env.db.database)}
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await connection.end();
  }
}

async function readMigrationFiles() {
  const names = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort();
  return Promise.all(names.map(async (name) => {
    const sql = await readFile(join(MIGRATIONS_DIR, name), 'utf8');
    return {
      version: name.replace(/\.sql$/, ''),
      file: name,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    };
  }));
}

async function ensureLedger(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     VARCHAR(80) NOT NULL,
      checksum    CHAR(64)    NOT NULL,
      applied_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

/** ينفّذ الملفات الجديدة فقط ويعيد قائمة ما نُفِّذ */
export async function migrateUp() {
  await ensureDatabase();
  const connection = await connect(env.db.database);
  try {
    await ensureLedger(connection);
    const [rows] = await connection.query('SELECT version, checksum FROM schema_migrations');
    const applied = new Map(rows.map((row) => [row.version, row.checksum]));

    const ran = [];
    for (const migration of await readMigrationFiles()) {
      if (applied.has(migration.version)) {
        if (applied.get(migration.version) !== migration.checksum) {
          logger.warn(`${migration.file} اتعدّل بعد ما اتنفّذ — مش هيتنفّذ تاني. اعمل migration جديد للتغيير.`);
        }
        continue;
      }
      try {
        await connection.query(migration.sql);
      } catch (error) {
        throw new Error(`فشل تنفيذ ${migration.file}: ${error.message}`);
      }
      await connection.query(
        'INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)',
        [migration.version, migration.checksum],
      );
      ran.push(migration.version);
      logger.success(`اتنفّذ ${migration.file}`);
    }
    return ran;
  } finally {
    await connection.end();
  }
}

export async function migrationStatus() {
  await ensureDatabase();
  const connection = await connect(env.db.database);
  try {
    await ensureLedger(connection);
    const [rows] = await connection.query('SELECT version, checksum, applied_at FROM schema_migrations');
    const applied = new Map(rows.map((row) => [row.version, row]));
    return (await readMigrationFiles()).map((migration) => ({
      version: migration.version,
      applied: applied.has(migration.version),
      applied_at: applied.get(migration.version)?.applied_at ?? null,
      modified: applied.has(migration.version) && applied.get(migration.version).checksum !== migration.checksum,
    }));
  } finally {
    await connection.end();
  }
}

/** يحذف القاعدة ويعيد بناءها — للتطوير والاختبارات فقط */
export async function resetDatabase() {
  if (env.isProd) throw new Error('db:reset ممنوع في الإنتاج');
  const connection = await connect(undefined);
  try {
    await connection.query(`DROP DATABASE IF EXISTS ${quoteIdent(env.db.database)}`);
  } finally {
    await connection.end();
  }
  return migrateUp();
}

/* ── سطر الأوامر ─────────────────────────────────────────────── */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const command = process.argv[2] || 'up';
  try {
    if (command === 'up') {
      const ran = await migrateUp();
      logger.success(ran.length ? `خلص — ${ran.length} ملف اتنفّذ` : 'القاعدة محدّثة، مفيش جديد');
    } else if (command === 'status') {
      const rows = await migrationStatus();
      for (const row of rows) {
        console.log(`${row.applied ? '✔' : '·'} ${row.version}${row.modified ? '   ⚠ اتعدّل بعد التنفيذ' : ''}`);
      }
    } else if (command === 'reset') {
      if (!process.argv.includes('--yes')) {
        console.log(`ده هيمسح قاعدة «${env.db.database}» بالكامل. لو متأكد:  npm run db:reset -- --yes`);
        process.exitCode = 1;
      } else {
        await resetDatabase();
        logger.success(`اتبنت قاعدة ${env.db.database} من الصفر`);
      }
    } else {
      console.log('الأوامر: up | status | reset');
      process.exitCode = 1;
    }
  } catch (error) {
    logger.error(error.message);
    process.exitCode = 1;
  }
}
