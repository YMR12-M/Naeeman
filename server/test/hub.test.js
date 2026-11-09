/**
 * «المحل هو السيرفر»: السيرفر بيقدّم الواجهة، والتابلت على الواي فاي بيكلّمه
 * من نفس العنوان، والنسخ الاحتياطية بترجع البيانات زي ما هي.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { execute, query, queryOne } from '../src/config/db.js';
import { lanAddresses } from '../src/modules/hub/hub.routes.js';
import { createBackup, listBackups, restoreBackup } from '../src/db/backup.js';
import { isNetworkError } from '../src/services/notifications/outbox.js';
import { sinceText } from '../src/jobs/reminders.js';
import { API, bearer, bootstrapOwner, makeApp, resetDatabase, shutdown, staffToken } from './helpers.js';

const { http } = makeApp();
let ctx;
let dir;

before(async () => {
  await resetDatabase();
  ctx = await bootstrapOwner(http, { shop: { name: 'صالون المحل', slug: 'hub-shop' } });
  dir = await mkdtemp(path.join(tmpdir(), 'naeeman-hub-'));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
  await shutdown();
});

describe('السيرفر بيقدّم الواجهة', () => {
  let web;

  before(async () => {
    const site = path.join(dir, 'site');
    await mkdir(path.join(site, 'assets'), { recursive: true });
    await writeFile(path.join(site, 'index.html'), '<!doctype html><title>نعيمًا</title>');
    await writeFile(path.join(site, 'assets', 'app-abc123.js'), 'console.log(1)');
    web = request(createApp({ staticDir: site }));
  });

  test('أي مسار للواجهة = index.html، والملفات بتتخزّن، والـ API فاضل JSON', async () => {
    const home = await web.get('/').set('Accept', 'text/html');
    assert.equal(home.status, 200);
    assert.match(home.text, /نعيمًا/);
    assert.equal(home.headers['cache-control'], 'no-cache');

    const deep = await web.get('/kiosk').set('Accept', 'text/html');
    assert.equal(deep.status, 200);
    assert.match(deep.text, /<title>/);

    const asset = await web.get('/assets/app-abc123.js');
    assert.equal(asset.status, 200);
    assert.match(asset.headers['cache-control'], /immutable/);

    const missing = await web.get(`${API}/nothing-here`).set('Accept', 'text/html');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.success, false);
  });

  test('التابلت من نفس العنوان مسموح، وموقع غريب مرفوض', async () => {
    const same = await web.post(`${API}/devices/pair`)
      .set('Host', '192.168.1.10:4030').set('Origin', 'http://192.168.1.10:4030')
      .send({ code: '000000' });
    assert.notEqual(same.status, 403);

    const foreign = await web.post(`${API}/devices/pair`)
      .set('Host', '192.168.1.10:4030').set('Origin', 'http://evil.example')
      .send({ code: '000000' });
    assert.equal(foreign.status, 403);
    assert.equal(foreign.body.code, 'CORS');
  });
});

describe('النسخ الاحتياطية', () => {
  test('نسخة ← تغيير ← استرجاع = نفس البيانات بالظبط (ومعاها الدرج بالعمود المحسوب)', async () => {
    const [cut] = (await http.post(`${API}/services/bulk`).set(bearer(ctx.token))
      .send({ items: [{ name: 'قص', price: 12345, default_minutes: 25 }] })).body.data;
    await http.post(`${API}/drawer/open`).set(bearer(ctx.token)).send({ opening_float: 5000 });
    await http.post(`${API}/products`).set(bearer(ctx.token)).send({ name: 'جِل «خاص»', price: 4000, initial_qty: 3 });

    const backups = path.join(dir, 'backups');
    const copies = path.join(dir, 'drive');
    const made = await createBackup({ dir: backups, copyDir: copies, keep: 2 });
    assert.ok(made.rows > 5);
    assert.ok(made.bytes > 100);

    await execute('UPDATE services SET price = 1, name = ? WHERE id = ?', ['اتغيّر', cut.id]);
    await execute('DELETE FROM stock_movements');
    await execute('UPDATE products SET stock_qty = 0');

    const restored = await restoreBackup(made.file);
    assert.ok(restored.rows > 5);
    const service = await queryOne('SELECT name, price FROM services WHERE id = ?', [cut.id]);
    assert.deepEqual(service, { name: 'قص', price: 12345 });
    assert.equal((await queryOne('SELECT stock_qty FROM products')).stock_qty, 3);
    assert.equal((await query('SELECT id FROM stock_movements')).length, 1);
    const drawer = await queryOne('SELECT status, open_guard FROM drawer_sessions');
    assert.deepEqual(drawer, { status: 'open', open_guard: 1 });

    // الدخول لسه شغّال بعد الاسترجاع
    const me = await http.get(`${API}/auth/me`).set(bearer(ctx.token));
    assert.equal(me.status, 200);

    // آخر نسختين بس، والنسخة اتنسخت لفولدر السحابة
    await createBackup({ dir: backups, keep: 2 });
    await new Promise((resolve) => { setTimeout(resolve, 1100); });
    await createBackup({ dir: backups, keep: 2 });
    assert.equal((await listBackups(backups)).length, 2);
    assert.equal((await listBackups(copies)).length, 1);
  });

  test('ملف مش نسخة نعيمًا بيترفض', async () => {
    const { createGzip } = await import('node:zlib');
    const { pipeline } = await import('node:stream/promises');
    const { Readable } = await import('node:stream');
    const { createWriteStream } = await import('node:fs');
    const bad = path.join(dir, 'bad.json.gz');
    await pipeline(Readable.from(['{"format":"other"}\n']), createGzip(), createWriteStream(bad));
    await assert.rejects(() => restoreBackup(bad), /مش نسخة نعيمًا/);
  });
});

describe('من غير نت', () => {
  test('أخطاء الشبكة بتتعرف (ما بتتحسبش محاولة إرسال)', () => {
    assert.equal(isNetworkError({ code: 'ENOTFOUND' }), true);
    assert.equal(isNetworkError({ cause: { code: 'ECONNREFUSED' } }), true);
    assert.equal(isNetworkError({ statusCode: 410 }), false);
  });

  test('نص التذكير', () => {
    assert.equal(sinceText(21), 'بقالك 3 أسابيع');
    assert.equal(sinceText(14), 'بقالك أسبوعين');
    assert.equal(sinceText(30), 'بقالك شهر');
    assert.equal(sinceText(10), 'بقالك 10 يوم');
  });
});

describe('عناوين الشبكة', () => {
  test('بيختار عناوين المحل المحلية بس، والأقرب لراوتر المحل الأوّل', () => {
    const found = lanAddresses({
      lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      utun3: [{ address: '10.8.0.2', family: 'IPv4', internal: false }],
      docker0: [{ address: '172.17.0.1', family: 'IPv4', internal: false }],
      Ethernet: [{ address: '10.0.0.7', family: 'IPv4', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }],
      'Wi-Fi': [{ address: '192.168.1.10', family: 4, internal: false }],
      Cellular: [{ address: '8.8.8.8', family: 'IPv4', internal: false }],
    });
    assert.deepEqual(found, [
      { name: 'Wi-Fi', address: '192.168.1.10' },
      { name: 'Ethernet', address: '10.0.0.7' },
    ]);
  });
});

describe('مسارات المحل (المالك بس)', () => {
  let saved;
  before(() => {
    saved = { hubMode: env.hubMode, backup: { ...env.backup }, staticDir: env.staticDir, customerPort: env.customerPort };
  });
  after(() => {
    env.hubMode = saved.hubMode;
    Object.assign(env.backup, saved.backup);
    env.staticDir = saved.staticDir;
    env.customerPort = saved.customerPort;
  });

  test('برّه وضع المحل: enabled=false، والنسخ بتترفض', async () => {
    env.hubMode = false;
    const info = await http.get(`${API}/hub`).set(bearer(ctx.token));
    assert.equal(info.status, 200);
    assert.equal(info.body.data.enabled, false);
    assert.deepEqual(info.body.data.addresses, []);

    const list = await http.get(`${API}/hub/backups`).set(bearer(ctx.token));
    assert.equal(list.status, 409);
    assert.equal(list.body.code, 'HUB_ONLY');
    assert.equal((await http.post(`${API}/hub/backups`).set(bearer(ctx.token))).status, 409);
  });

  test('من غير دخول، أو بدور تاني: ممنوع', async () => {
    env.hubMode = true;
    assert.equal((await http.get(`${API}/hub`)).status, 401);
    const token = await staffToken(http, ctx.shopId, 'manager');
    assert.equal((await http.get(`${API}/hub`).set(bearer(token))).status, 403);
    assert.equal((await http.post(`${API}/hub/backups/restore`).set(bearer(token)).send({ name: 'naeeman-x.json.gz', confirm: true })).status, 403);
  });

  test('وضع المحل: المعلومات، ونسخة دلوقتي، وقايمة، واسترجاع بتأكيد', async () => {
    env.hubMode = true;
    env.staticDir = '/tmp/panel';
    env.customerPort = 4031;
    env.backup.dir = path.join(dir, 'hub-backups');
    env.backup.copyDir = '';
    env.backup.keep = 5;

    const info = await http.get(`${API}/hub`).set(bearer(ctx.token));
    assert.equal(info.body.data.enabled, true);
    assert.equal(info.body.data.api_port, env.port);
    assert.equal(info.body.data.customer_port, 4031);
    assert.equal(info.body.data.serves_panel, true);
    assert.equal(info.body.data.serves_customer, false);
    assert.equal(info.body.data.backup.latest, null);

    const made = await http.post(`${API}/hub/backups`).set(bearer(ctx.token));
    assert.equal(made.status, 200);
    assert.match(made.body.data.name, /^naeeman-.*\.json\.gz$/);

    const list = await http.get(`${API}/hub/backups`).set(bearer(ctx.token));
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.data[0].name, made.body.data.name);
    assert.equal(list.body.data[0].file, undefined, 'المسار الكامل على الجهاز مش بيتبعت');

    // اسم من برّه القايمة ومن غير تأكيد بيترفضوا
    assert.equal((await http.post(`${API}/hub/backups/restore`).set(bearer(ctx.token)).send({ name: made.body.data.name })).status, 422);
    assert.equal((await http.post(`${API}/hub/backups/restore`).set(bearer(ctx.token)).send({ name: '../../etc/passwd', confirm: true })).status, 422);
    const unknown = await http.post(`${API}/hub/backups/restore`).set(bearer(ctx.token)).send({ name: 'naeeman-nothing.json.gz', confirm: true });
    assert.equal(unknown.status, 404);

    // تغيير ثم استرجاع: بيرجع، ومعاه نسخة أمان من الحالة قبل الاسترجاع
    await execute("UPDATE shops SET name = 'اتغيّر' WHERE id = ?", [ctx.shopId]);
    await new Promise((resolve) => { setTimeout(resolve, 1100); });
    const restored = await http.post(`${API}/hub/backups/restore`).set(bearer(ctx.token)).send({ name: made.body.data.name, confirm: true });
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
    assert.ok(restored.body.data.restored > 5);
    assert.match(restored.body.data.safety, /^naeeman-/);
    assert.equal((await queryOne('SELECT name FROM shops WHERE id = ?', [ctx.shopId])).name, 'صالون المحل');
    assert.equal((await http.get(`${API}/hub/backups`).set(bearer(ctx.token))).body.data.length, 2);
  });
});
