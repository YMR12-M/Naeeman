/**
 * وضع «المحل هو السيرفر» في البرنامج: التحقّق من الإعدادات (سريع)، وتشغيل
 * حقيقي لسيرفر نعيمًا على قاعدة مؤقتة (بيتخطّى لو MySQL مش موجودة).
 *   cd desktop && npm test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Hub, findMysqld, lanIp, normalizeHub, normalizeOwner, ownerPasswordIssues, waitForPort,
} from '../src/hub.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '../../server');

describe('إعدادات وضع المحل', () => {
  test('الافتراضي: بورتات 4030 و4031 وMySQL على الجهاز', () => {
    const result = normalizeHub({});
    assert.equal(result.ok, true);
    assert.equal(result.value.apiPort, 4030);
    assert.equal(result.value.customerPort, 4031);
    assert.deepEqual(result.value.mysql, { mode: 'external', host: '127.0.0.1', port: 3306, user: 'root', password: '', database: 'naeeman' });
    assert.ok(result.value.secret.length >= 48, 'سرّ الجلسات بيتولّد لوحده');
  });

  test('السرّ بيتحفظ لو اتبعت، وMySQL المتشحونة بتاخد بورت 3307', () => {
    const result = normalizeHub({ secret: 'x'.repeat(64), mysql: { mode: 'bundled', password: 'p' } });
    assert.equal(result.value.secret, 'x'.repeat(64));
    assert.equal(result.value.mysql.port, 3307);
    assert.equal(result.value.mysql.host, '127.0.0.1');
    assert.equal(result.value.mysql.user, 'root');
  });

  test('بورتات غلط أو متكرّرة واسم قاعدة غريب بيترفضوا', () => {
    assert.equal(normalizeHub({ apiPort: 80 }).ok, false);
    assert.equal(normalizeHub({ apiPort: 'abc' }).ok, false);
    const same = normalizeHub({ apiPort: 4040, customerPort: 4040 });
    assert.equal(same.ok, false);
    assert.match(same.errors.join(' '), /يختلفوا/);
    assert.equal(normalizeHub({ mysql: { database: 'x; DROP DATABASE y' } }).ok, false);
  });

  test('بيانات المالك: نفس شرط السيرفر', () => {
    assert.deepEqual(ownerPasswordIssues('Strong-Pass-123'), []);
    assert.ok(ownerPasswordIssues('short').length > 0);
    assert.ok(ownerPasswordIssues('alllowercaseletters').length > 0);

    const good = normalizeOwner({ shop: 'صالون زمان', name: 'أحمد', email: 'Ahmed@Example.com', password: 'Strong-Pass-123' });
    assert.equal(good.ok, true);
    assert.equal(good.value.email, 'ahmed@example.com');

    const bad = normalizeOwner({ shop: '', name: 'ا', email: 'nope', password: 'weak', slug: 'Bad Slug' });
    assert.equal(bad.ok, false);
    assert.equal(bad.errors.length, 5);
  });

  test('عنوان الشبكة: 192.168 قبل 10، ومن غير شبكة = null', () => {
    assert.equal(lanIp({
      Ethernet: [{ address: '10.0.0.7', family: 'IPv4', internal: false }],
      'Wi-Fi': [{ address: '192.168.1.10', family: 4, internal: false }],
    }), '192.168.1.10');
    assert.equal(lanIp({ lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }] }), null);
  });

  test('بيلاقي mysqld المتشحون من المتغيّر أو الموارد', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'naeeman-find-'));
    try {
      const exe = process.platform === 'win32' ? 'mysqld.exe' : 'mysqld';
      await mkdir(path.join(dir, 'mysql', 'bin'), { recursive: true });
      assert.equal(findMysqld({ resourcesPath: dir, env: {} }), null);
      await writeFile(path.join(dir, 'mysql', 'bin', exe), '');
      assert.equal(findMysqld({ resourcesPath: dir, env: {} }), path.join(dir, 'mysql', 'bin', exe));
      assert.equal(findMysqld({ resourcesPath: '/nowhere', env: { NAEEMAN_MYSQLD: path.join(dir, 'mysql', 'bin', exe) } }), path.join(dir, 'mysql', 'bin', exe));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/* ═══════════ تشغيل حقيقي ═══════════ */

const OWNER = { shop: 'صالون الاختبار', name: 'مالك الاختبار', email: 'owner@hub-test.local', password: 'Hub-Test-Pass-2026', slug: 'hub-test' };
const require = createRequire(path.join(serverDir, 'package.json'));

// MySQL الاختبارية: root من غير كلمة سر على جهازك، أو NAEEMAN_TEST_DB_PASSWORD (زي CI)
const DB_PASSWORD = process.env.NAEEMAN_TEST_DB_PASSWORD ?? '';
const connect = () => require('mysql2/promise').createConnection({ host: '127.0.0.1', user: 'root', password: DB_PASSWORD });

/** MySQL شغّالة وبتقبل الدخول فعلًا (مش بس البورت مفتوح) */
async function mysqlUp() {
  try { const connection = await connect(); await connection.end(); return true; } catch { return false; }
}

async function dropDatabase(database) {
  const connection = await connect();
  await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await connection.end();
}

async function checkRunning(hub, { apiPort, customerPort }) {
  const health = await (await fetch(`http://127.0.0.1:${apiPort}/health`)).json();
  assert.equal(health.service, 'naeeman-api');

  // اللوحة بتتقدّم من السيرفر، وتطبيق الزبون على بورته
  const panel = await fetch(`http://127.0.0.1:${apiPort}/kiosk`, { headers: { Accept: 'text/html' } });
  assert.equal(panel.status, 200);
  assert.match(await panel.text(), /لوحة-الاختبار/);
  const customer = await fetch(`http://127.0.0.1:${customerPort}/s/hub-test`, { headers: { Accept: 'text/html' } });
  assert.equal(customer.status, 200);
  assert.match(await customer.text(), /تطبيق-الزبون-الاختبار/);

  // المالك اتعمل ويدخل، ووضع المحل ظاهر في /hub
  const login = await fetch(`http://127.0.0.1:${apiPort}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'app' },
    body: JSON.stringify({ email: OWNER.email, password: OWNER.password }),
  });
  assert.equal(login.status, 200);
  const token = (await login.json()).data.tokens.access_token;
  const info = await (await fetch(`http://127.0.0.1:${apiPort}/api/v1/hub`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.equal(info.data.enabled, true);
  assert.equal(info.data.api_port, apiPort);
  assert.equal(info.data.customer_port, customerPort);
  assert.equal(info.data.backup.enabled, true);

  // نسخة احتياطية بتتعمل في فولدر البرنامج
  const backup = await fetch(`http://127.0.0.1:${apiPort}/api/v1/hub/backups`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  assert.equal(backup.status, 200, await backup.clone().text());
  assert.ok(existsSync(hub.backupsDir));
  assert.equal(hub.status().state, 'running');
}

async function withSite(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'naeeman-hubrun-'));
  const panelDir = path.join(root, 'panel');
  const customerDir = path.join(root, 'customer');
  await mkdir(panelDir, { recursive: true });
  await mkdir(customerDir, { recursive: true });
  await writeFile(path.join(panelDir, 'index.html'), '<!doctype html><title>لوحة-الاختبار</title>');
  await writeFile(path.join(customerDir, 'index.html'), '<!doctype html><title>تطبيق-الزبون-الاختبار</title>');
  try { await fn({ root, panelDir, customerDir }); } finally { await rm(root, { recursive: true, force: true }); }
}

describe('تشغيل السيرفر على MySQL موجودة', { timeout: 180_000 }, async () => {
  const available = await mysqlUp();
  const database = `naeeman_hubtest_${process.pid}`;

  test('تجهيز وتشغيل وإيقاف', { skip: !available && 'MySQL مش شغّالة على 3306' }, async () => {
    await withSite(async ({ root, panelDir, customerDir }) => {
      const hub = new Hub({ serverDir, dataDir: path.join(root, 'data'), panelDir, customerDir });
      const config = { apiPort: 4120, customerPort: 4121, mysql: { database, password: DB_PASSWORD } };
      try {
        await hub.initialize(config, OWNER);
        await hub.start({ ...config, secret: hub.config.secret });
        await checkRunning(hub, config);

        // تشغيل تاني على نفس القاعدة: المالك موجود فمفيش تكرار
        await hub.stop();
        await assert.rejects(() => waitForPort(4120, { timeoutMs: 800 }), 'البورت اتقفل بعد الإيقاف');
        await hub.start({ ...config, secret: hub.config.secret });
        await checkRunning(hub, config);
      } finally {
        await hub.stop();
        await dropDatabase(database);
      }
    });
  });

  test('بيانات مالك ضعيفة بتتوقّف قبل ما أي حاجة تتشغّل', { skip: !available && 'MySQL مش شغّالة' }, async () => {
    await withSite(async ({ root, panelDir }) => {
      const hub = new Hub({ serverDir, dataDir: path.join(root, 'data'), panelDir });
      await assert.rejects(() => hub.initialize({ apiPort: 4122, customerPort: 4123, mysql: { database, password: DB_PASSWORD } }, { ...OWNER, password: 'weak' }), /كلمة السر/);
      assert.equal(hub.state, 'stopped');
      assert.equal(hub.server, null);
    });
  });
});

describe('بملف Electron نفسه كـ Node (زي البرنامج المتسطّب)', { timeout: 180_000 }, async () => {
  const available = await mysqlUp();
  let electronBinary = null;
  try {
    electronBinary = createRequire(import.meta.url)('electron');
    // الملف ممكن يكون موجود وناقصه frameworks (تسطيب ناقص): نجرّبه فعلًا
    const { spawnSync } = await import('node:child_process');
    const probe = spawnSync(electronBinary, ['-e', 'console.log(process.versions.electron)'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });
    if (probe.status !== 0 || !probe.stdout.trim()) electronBinary = null;
  } catch { electronBinary = null; }
  const database = `naeeman_hubtest_electron_${process.pid}`;

  test('نفس التجهيز والتشغيل بـ ELECTRON_RUN_AS_NODE', { skip: (!available && 'MySQL مش شغّالة') || (!electronBinary && 'Electron مش بيشتغل هنا') }, async () => {
    await withSite(async ({ root, panelDir, customerDir }) => {
      const hub = new Hub({ serverDir, dataDir: path.join(root, 'data'), panelDir, customerDir, execPath: electronBinary, electron: true });
      const config = { apiPort: 4126, customerPort: 4127, mysql: { database, password: DB_PASSWORD } };
      try {
        await hub.initialize(config, OWNER);
        await hub.start({ ...config, secret: hub.config.secret });
        await checkRunning(hub, config);
      } finally {
        await hub.stop();
        await dropDatabase(database);
      }
    });
  });
});

describe('MySQL المتشحونة (mysqld على الجهاز بدل الموارد)', { timeout: 240_000 }, async () => {
  const mysqld = findMysqld({ env: process.env }) ?? ['/opt/homebrew/opt/mysql/bin/mysqld', '/usr/local/opt/mysql/bin/mysqld'].find((file) => existsSync(file)) ?? null;

  test('أوّل تشغيل بيجهّز مجلد البيانات بكلمة سر، وبعدها السيرفر بيقوم', { skip: !mysqld && 'mysqld مش موجود' }, async () => {
    await withSite(async ({ root, panelDir, customerDir }) => {
      const hub = new Hub({ serverDir, dataDir: path.join(root, 'data'), panelDir, customerDir, mysqld });
      const config = { apiPort: 4124, customerPort: 4125, mysql: { mode: 'bundled', port: 3398, password: 'Bundled-Root-Pass-1' } };
      try {
        await hub.initialize(config, OWNER);
        assert.ok(existsSync(path.join(root, 'data', 'mysql', 'mysql')), 'مجلد البيانات اتجهّز');
        assert.ok(!existsSync(path.join(root, 'data', 'mysql-init.sql')), 'ملف كلمة السر المؤقّت اتمسح');
        await hub.start({ ...config, secret: hub.config.secret });
        await checkRunning(hub, config);

        // كلمة السر مطلوبة فعلًا
        const mysql = require('mysql2/promise');
        await assert.rejects(() => mysql.createConnection({ host: '127.0.0.1', port: 3398, user: 'root' }));
        const connection = await mysql.createConnection({ host: '127.0.0.1', port: 3398, user: 'root', password: 'Bundled-Root-Pass-1' });
        await connection.end();
      } finally {
        await hub.stop();
      }
      await assert.rejects(() => waitForPort(3398, { timeoutMs: 800 }), 'MySQL وقفت مع الإيقاف');
    });
  });
});

