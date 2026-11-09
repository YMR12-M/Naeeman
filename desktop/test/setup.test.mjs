/**
 * صفحة أوّل تشغيل (setup.html + setup.js) في jsdom بجسر متزيّف: اختيار الوضع،
 * وإظهار الحقول الصح، وما اللي بيتبعت للبرنامج.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../src');
const clientDir = path.resolve(here, '../../client');
let JSDOM;
try { ({ JSDOM } = createRequire(path.join(clientDir, 'package.json'))('jsdom')); } catch { JSDOM = null; }

// أوبجكتات jsdom من realm تاني: بنقارن بالقيم (JSON) مش بالـ prototype
const plain = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise((resolve) => { setTimeout(resolve, 10); });

async function open(state, overrides = {}) {
  const calls = { startHub: [], saveRemote: [], pick: 0 };
  const dom = new JSDOM(readFileSync(path.join(src, 'setup.html'), 'utf8').replace('<script src="setup.js"></script>', ''), { runScripts: 'outside-only' });
  const { window } = dom;
  window.naeemanSetup = {
    state: async () => ({ mode: null, serverUrl: '', hubInitialized: false, mysqldAvailable: true, ip: '192.168.1.10', apiPort: 4030, customerPort: 4031, error: '', ...state }),
    saveRemote: async (url) => { calls.saveRemote.push(url); return overrides.remote ?? { ok: true }; },
    startHub: async (input) => { calls.startHub.push(input); return overrides.hub ?? { ok: true }; },
    pickFolder: async () => { calls.pick += 1; return '/Users/x/Google Drive/Naeeman'; },
  };
  window.eval(readFileSync(path.join(src, 'setup.js'), 'utf8'));
  await tick();
  const $ = (id) => window.document.getElementById(id);
  const choose = (name, value) => {
    const input = window.document.querySelector(`input[name=${name}][value=${value}]`);
    input.checked = true;
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const fill = (id, value) => { $(id).value = value; };
  const submit = async () => { $('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await tick(); };
  return { window, $, calls, choose, fill, submit };
}

describe('صفحة أوّل تشغيل', { skip: !JSDOM && 'jsdom مش متسطّب في client' }, () => {
  test('من غير اختيار: مفيش زرار ولا حقول', async () => {
    const page = await open({});
    assert.equal(page.$('save').hidden, true);
    assert.equal(page.$('hub-new').hidden, true);
    assert.equal(page.$('remote').hidden, true);
  });

  test('سيرفر المحل: حقول المالك والقاعدة، وMySQL المتشحونة هي الافتراضي', async () => {
    const page = await open({});
    page.choose('mode', 'hub');
    assert.equal(page.$('hub-new').hidden, false);
    assert.equal(page.$('remote').hidden, true);
    assert.equal(page.$('save').textContent, 'جهّز وشغّل');
    assert.equal(page.$('db-external').hidden, true, 'حقول MySQL الخارجية متخبّية');
    page.choose('db', 'external');
    assert.equal(page.$('db-external').hidden, false);
  });

  test('من غير mysqld متشحون: الخيار مقفول والافتراضي MySQL على الجهاز', async () => {
    const page = await open({ mysqldAvailable: false });
    page.choose('mode', 'hub');
    assert.equal(page.window.document.querySelector('input[name=db][value=bundled]').disabled, true);
    assert.equal(page.$('db-external').hidden, false);
  });

  test('كلمتين سر مش زي بعض: بتترفض قبل ما حاجة تتبعت', async () => {
    const page = await open({});
    page.choose('mode', 'hub');
    page.fill('owner-password', 'Strong-Pass-123');
    page.fill('owner-password2', 'Strong-Pass-124');
    await page.submit();
    assert.equal(page.calls.startHub.length, 0);
    assert.match(page.$('error').textContent, /مش زي بعض/);
    assert.equal(page.$('error').hidden, false);
    assert.equal(page.$('save').disabled, false);
  });

  test('بيبعت المحل والمالك والقاعدة وفولدر السحابة والبورتات', async () => {
    const page = await open({});
    page.choose('mode', 'hub');
    page.fill('shop', 'صالون زمان');
    page.fill('owner-name', 'أحمد');
    page.fill('owner-email', 'a@example.com');
    page.fill('owner-password', 'Strong-Pass-123');
    page.fill('owner-password2', 'Strong-Pass-123');
    page.$('pick').click();
    await tick();
    await page.submit();
    assert.deepEqual(plain(page.calls.startHub[0]), {
      hub: { apiPort: '4030', customerPort: '4031', backupCopyDir: '/Users/x/Google Drive/Naeeman', mysql: { mode: 'bundled' } },
      owner: { shop: 'صالون زمان', name: 'أحمد', email: 'a@example.com', password: 'Strong-Pass-123' },
    });
  });

  test('رفض من البرنامج (كلمة سر ضعيفة مثلًا) بيظهر والزرار بيرجع', async () => {
    const page = await open({}, { hub: { ok: false, message: 'كلمة السر: 12 حرفًا على الأقل' } });
    page.choose('mode', 'hub');
    page.fill('owner-password', 'x');
    page.fill('owner-password2', 'x');
    await page.submit();
    assert.equal(page.$('error').textContent, 'كلمة السر: 12 حرفًا على الأقل');
    assert.equal(page.$('save').disabled, false);
    assert.equal(page.$('save').textContent, 'جهّز وشغّل');
  });

  test('اتجهّز قبل كده: بيشغّل من غير ما يسأل عن المالك تاني', async () => {
    const page = await open({ mode: 'hub', hubInitialized: true });
    assert.equal(page.$('hub-new').hidden, true);
    assert.equal(page.$('hub-ready').hidden, false);
    assert.equal(page.$('save').textContent, 'شغّل سيرفر المحل');
    await page.submit();
    assert.deepEqual(plain(page.calls.startHub), [{}]);
  });

  test('اتصال بسيرفر موجود', async () => {
    const page = await open({ serverUrl: 'http://192.168.1.10:4030', mode: 'remote' });
    assert.equal(page.$('remote').hidden, false);
    assert.equal(page.$('url').value, 'http://192.168.1.10:4030');
    assert.equal(page.$('save').textContent, 'اتصل');
    await page.submit();
    assert.deepEqual(page.calls.saveRemote, ['http://192.168.1.10:4030']);
  });

  test('الخطأ اللي جاي من البرنامج في الرابط بيظهر (السيرفر ما اشتغلش)', async () => {
    const page = await open({ error: 'سيرفر المحل ما اشتغلش: البورت مشغول' });
    assert.equal(page.$('error').textContent, 'سيرفر المحل ما اشتغلش: البورت مشغول');
  });
});
