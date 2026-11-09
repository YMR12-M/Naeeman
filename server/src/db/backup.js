/**
 * ═══════════════════════════════════════════════════════════════
 *  النسخ الاحتياطية (المحل هو السيرفر)
 *
 *  نسخة كاملة للقاعدة في ملف واحد مضغوط (JSON سطر لكل صف)، من غير
 *  mysqldump: بيشتغل في أي مكان فيه Node، وبيرجع بنفس القيم بالظبط
 *  (التواريخ والأرقام الكبيرة نصوص زي ما هي في القاعدة).
 *
 *  • `createBackup` كل كام ساعة وبعد تقفيل اليوم، وبيحتفظ بآخر N نسخة.
 *  • لو فيه BACKUP_COPY_DIR (فولدر Google Drive أو OneDrive على الجهاز)،
 *    النسخة بتتنسخ له، والصور الجديدة كمان، فبتطلع على السحابة لوحدها.
 *  • `restoreBackup` بيمسح القاعدة الحالية ويرجّع النسخة (بعد ما يتأكّد إن
 *    النسخة من نفس الإصدار أو أقدم).
 *
 *  الأوامر:
 *    npm run db:backup
 *    npm run db:restore -- <الملف> --yes
 * ═══════════════════════════════════════════════════════════════
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createGunzip, createGzip } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { migrateUp } from './migrate.js';

const FORMAT = 'naeeman-backup/1';

const connect = () => mysql.createConnection({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  ssl: env.db.ssl ? { rejectUnauthorized: true } : undefined,
  charset: 'utf8mb4_unicode_ci',
  timezone: 'Z',
  // كل القيم نصوص زي ما هي، فالاسترجاع بيرجّعها بالظبط
  dateStrings: true,
  supportBigNumbers: true,
  bigNumberStrings: true,
  typeCast: (field, next) => (field.type === 'JSON' ? field.string('utf8') : next()),
});

/** الجداول وأعمدتها اللي بتتخزّن (من غير الأعمدة المحسوبة) */
async function tablesOf(connection) {
  const [rows] = await connection.query(
    `SELECT table_name AS t, column_name AS c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND extra NOT LIKE '%GENERATED%'
      ORDER BY table_name, ordinal_position`,
  );
  const tables = new Map();
  for (const row of rows) {
    if (!tables.has(row.t)) tables.set(row.t, []);
    tables.get(row.t).push(row.c);
  }
  return tables;
}

const stamp = (date = new Date()) => date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

async function* lines(connection, tables, migrations) {
  yield `${JSON.stringify({ format: FORMAT, database: env.db.database, created_at: new Date().toISOString(), migrations, tables: Object.fromEntries(tables) })}\n`;
  for (const [table, columns] of tables) {
    if (table === 'schema_migrations') continue;
    const list = columns.map((column) => `\`${column}\``).join(', ');
    const [rows] = await connection.query({ sql: `SELECT ${list} FROM \`${table}\``, rowsAsArray: true });
    for (const row of rows) yield `${JSON.stringify({ t: table, r: row })}\n`;
  }
}

/** ينسخ الصور الجديدة بس (الصورة ما بتتغيّرش بعد ما تترفع) */
async function syncDir(from, to) {
  let copied = 0;
  let entries;
  try { entries = await readdir(from, { withFileTypes: true }); } catch { return 0; }
  await mkdir(to, { recursive: true });
  for (const entry of entries) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copied += await syncDir(source, target);
    } else {
      const exists = await stat(target).then(() => true, () => false);
      if (!exists) { await copyFile(source, target); copied += 1; }
    }
  }
  return copied;
}

/**
 * نسخة جديدة. @returns {Promise<{ file, bytes, rows, copied? }>}
 */
export async function createBackup({ dir = env.backup.dir, copyDir = env.backup.copyDir, keep = env.backup.keep } = {}) {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `naeeman-${env.db.database}-${stamp()}.json.gz`);
  const connection = await connect();
  let rows = 0;
  try {
    // قراية متّسقة: كل الجداول من نفس اللحظة
    await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    const tables = await tablesOf(connection);
    const [migrationRows] = await connection.query('SELECT version FROM schema_migrations ORDER BY version');
    const migrations = migrationRows.map((row) => row.version);
    const source = Readable.from((async function* counted() {
      for await (const line of lines(connection, tables, migrations)) { rows += 1; yield line; }
    })());
    await pipeline(source, createGzip({ level: 6 }), createWriteStream(`${file}.part`));
    await connection.query('COMMIT');
  } finally {
    await connection.end();
  }
  const { rename } = await import('node:fs/promises');
  await rename(`${file}.part`, file);

  // آخر N نسخة بس
  const old = (await readdir(dir)).filter((name) => /^naeeman-.*\.json\.gz$/.test(name)).sort().reverse().slice(keep);
  for (const name of old) await rm(path.join(dir, name), { force: true });

  const result = { file, bytes: (await stat(file)).size, rows: rows - 1 };
  if (copyDir) {
    try {
      await mkdir(copyDir, { recursive: true });
      await copyFile(file, path.join(copyDir, path.basename(file)));
      result.copied = await syncDir(env.uploadsDir, path.join(copyDir, 'uploads'));
    } catch (error) {
      logger.warn(`النسخة اتعملت بس ما اتنسختش لـ ${copyDir}: ${error.message}`);
    }
  }
  return result;
}

/** النسخ الموجودة (الأحدث الأوّل) */
export async function listBackups(dir = env.backup.dir) {
  let names;
  try { names = await readdir(dir); } catch { return []; }
  const files = names.filter((name) => /^naeeman-.*\.json\.gz$/.test(name)).sort().reverse();
  return Promise.all(files.map(async (name) => {
    const info = await stat(path.join(dir, name));
    return { name, file: path.join(dir, name), bytes: info.size, created_at: info.mtime };
  }));
}

/**
 * يرجّع نسخة: بيحدّث شكل القاعدة للإصدار الحالي، ويمسح البيانات، ويحط
 * بيانات النسخة. النسخة من إصدار أحدث من السيرفر بتترفض.
 */
export async function restoreBackup(file) {
  const current = await migrateUp().then(async () => {
    const connection = await connect();
    try {
      const [rows] = await connection.query('SELECT version FROM schema_migrations');
      return new Set(rows.map((row) => row.version));
    } finally {
      await connection.end();
    }
  });

  const connection = await connect();
  // الـ interface بيبدأ يقرا أوّل ما يتعمل: لازم يتعمل قبل الـ for await على طول،
  // وإلا ملف صغير بيخلص قبل ما نبدأ نلفّ عليه واللفّة تستنّى للأبد.
  const input = readline.createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  let header = null;
  let restored = 0;
  const batch = new Map();
  const flush = async (table) => {
    const rows = batch.get(table);
    if (!rows?.length) return;
    const columns = header.tables[table].map((column) => `\`${column}\``).join(', ');
    await connection.query(`INSERT INTO \`${table}\` (${columns}) VALUES ?`, [rows]);
    restored += rows.length;
    batch.set(table, []);
  };

  try {
    for await (const line of input) {
      if (!line.trim()) continue;
      const record = JSON.parse(line);
      if (!header) {
        if (record.format !== FORMAT) throw new Error('الملف ده مش نسخة نعيمًا');
        const unknown = record.migrations.filter((version) => !current.has(version));
        if (unknown.length) throw new Error(`النسخة من إصدار أحدث من السيرفر (${unknown.join('، ')}) — حدّث البرنامج الأول`);
        header = record;
        await connection.query('SET FOREIGN_KEY_CHECKS = 0');
        await connection.query("SET time_zone = '+00:00'");
        const [existing] = await connection.query(
          "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name <> 'schema_migrations'",
        );
        for (const { name } of existing) await connection.query(`TRUNCATE TABLE \`${name}\``);
        continue;
      }
      if (!header.tables[record.t]) continue;
      if (!batch.has(record.t)) batch.set(record.t, []);
      batch.get(record.t).push(record.r);
      if (batch.get(record.t).length >= 500) await flush(record.t);
    }
    for (const table of batch.keys()) await flush(table);
  } finally {
    await connection.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
    await connection.end();
  }
  if (!header) throw new Error('الملف فاضي');
  return { rows: restored, created_at: header.created_at };
}

/* ── سطر الأوامر ─────────────────────────────────────────────── */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const [command, file] = process.argv.slice(2);
  try {
    if (command === 'backup') {
      const result = await createBackup();
      logger.success(`النسخة اتعملت: ${result.file} (${Math.round(result.bytes / 1024)} KB، ${result.rows} صف)`);
    } else if (command === 'restore') {
      if (!file || !process.argv.includes('--yes')) {
        console.log(`ده هيمسح قاعدة «${env.db.database}» ويرجّع النسخة. لو متأكد:  npm run db:restore -- <الملف> --yes`);
        process.exitCode = 1;
      } else {
        const result = await restoreBackup(file);
        logger.success(`اترجّعت نسخة ${result.created_at} (${result.rows} صف)`);
      }
    } else {
      console.log('الأوامر: backup | restore <file> --yes');
      process.exitCode = 1;
    }
  } catch (error) {
    logger.error(error.message);
    process.exitCode = 1;
  }
}
