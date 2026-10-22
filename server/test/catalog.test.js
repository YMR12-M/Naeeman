import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { queryOne } from '../src/config/db.js';
import {
  API, bearer, bootstrapOwner, login, makeApp, resetDatabase, seedShop, seedUser, shutdown, staffToken,
} from './helpers.js';

const { http } = makeApp();
let ctx;

before(async () => {
  await resetDatabase();
  ctx = await bootstrapOwner(http);
});
after(shutdown);

const post = (path, body, token = ctx.token) => http.post(`${API}${path}`).set(bearer(token)).send(body);
const patch = (path, body, token = ctx.token) => http.patch(`${API}${path}`).set(bearer(token)).send(body);
const get = (path, token = ctx.token) => http.get(`${API}${path}`).set(bearer(token));

describe('قايمة الأسعار', () => {
  let services;

  test('التجهيز لأوّل مرّة: كذا خدمة مرّة واحدة بالترتيب', async () => {
    const response = await post('/services/bulk', {
      items: [
        { name: 'قص', price: 8000, default_minutes: 25 },
        { name: 'دقن', price: 4000, default_minutes: 15 },
        { name: 'قص ودقن', price: 12000, default_minutes: 35 },
      ],
    });
    assert.equal(response.status, 201);
    services = response.body.data;
    assert.deepEqual(services.map((item) => item.name), ['قص', 'دقن', 'قص ودقن']);
    assert.equal(services[0].active, true);
  });

  test('السعر بالقروش عدد صحيح، والمدّة لها حدود', async () => {
    assert.equal((await post('/services', { name: 'صبغة', price: 99.5, default_minutes: 40 })).status, 422);
    assert.equal((await post('/services', { name: 'صبغة', price: 15000, default_minutes: 0 })).status, 422);
    assert.equal((await post('/services', { name: '', price: 15000, default_minutes: 40 })).status, 422);
  });

  test('تعديل السعر بيتسجّل قبل وبعد', async () => {
    const response = await patch(`/services/${services[0].id}`, { price: 9000 });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.price, 9000);
    const row = await queryOne("SELECT before_json, after_json FROM audit_logs WHERE action = 'service.update'");
    const before = typeof row.before_json === 'string' ? JSON.parse(row.before_json) : row.before_json;
    assert.equal(before.price, 8000);
  });

  test('إعادة الترتيب لازم تشمل الكل', async () => {
    const [cut, beard, combo] = services.map((item) => item.id);
    assert.equal((await http.put(`${API}/services/order`).set(bearer(ctx.token)).send({ ids: [combo, cut] })).status, 400);
    const response = await http.put(`${API}/services/order`).set(bearer(ctx.token)).send({ ids: [combo, cut, beard] });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data.map((item) => item.name), ['قص ودقن', 'قص', 'دقن']);
  });

  test('الأرشفة بتخفي الخدمة ولا تمسحها، والاسترجاع بيرجّعها آخر القايمة', async () => {
    const id = services[1].id;
    assert.equal((await http.delete(`${API}/services/${id}`).set(bearer(ctx.token))).status, 204);
    assert.equal((await get('/services')).body.data.length, 2);
    const all = (await get('/services?include_archived=true')).body.data;
    assert.equal(all.length, 3);
    assert.ok(all.at(-1).archived_at);
    assert.equal((await patch(`/services/${id}`, { price: 1 })).status, 409);

    const restored = await post(`/services/${id}/restore`, {});
    assert.equal(restored.status, 200);
    assert.equal((await get('/services')).body.data.at(-1).id, id);
  });

  test('الاستقبال يقرا القايمة بس', async () => {
    const token = await staffToken(http, ctx.shopId, 'cashier');
    assert.equal((await get('/services', token)).status, 200);
    assert.equal((await post('/services', { name: 'x', price: 1, default_minutes: 5 }, token)).status, 403);
  });
});

describe('الحلاقين', () => {
  let hassan;

  test('إضافة حلاق بكرسي وPIN — والـ PIN ما يرجعش أبدًا', async () => {
    const response = await post('/barbers', { name: 'حسن', chair_no: 2, pin: '4821' });
    assert.equal(response.status, 201);
    hassan = response.body.data;
    assert.equal(hassan.has_pin, true);
    assert.equal(hassan.pin_hash, undefined);
    assert.equal(hassan.status, 'off');

    const row = await queryOne('SELECT pin_hash FROM barbers WHERE id = ?', [hassan.id]);
    assert.notEqual(row.pin_hash, '4821');
  });

  test('الكرسي ما يتكرّرش', async () => {
    const response = await post('/barbers', { name: 'محمود', chair_no: 2 });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'CHAIR_TAKEN');
    assert.match(response.body.errors.chair_no, /حسن/);
    assert.equal((await post('/barbers', { name: 'محمود', chair_no: 1 })).status, 201);
  });

  test('الـ PIN أربعة أرقام بالظبط', async () => {
    assert.equal((await post('/barbers', { name: 'سيد', pin: '12' })).status, 422);
    assert.equal((await http.put(`${API}/barbers/${hassan.id}/pin`).set(bearer(ctx.token)).send({ pin: 'abcd' })).status, 422);
    const response = await http.put(`${API}/barbers/${hassan.id}/pin`).set(bearer(ctx.token)).send({ pin: '1357' });
    assert.equal(response.status, 200);
  });

  test('الحالة: استراحة لمدّة، ومتاح بيمسح نهاية الاستراحة', async () => {
    const onBreak = await post(`/barbers/${hassan.id}/status`, { status: 'break', break_minutes: 20 });
    assert.equal(onBreak.status, 200);
    assert.equal(onBreak.body.data.status, 'break');
    const minutes = (new Date(onBreak.body.data.break_until) - Date.now()) / 60_000;
    assert.ok(minutes > 18 && minutes <= 20, `الاستراحة ${minutes} دقيقة`);

    const back = await post(`/barbers/${hassan.id}/status`, { status: 'available' });
    assert.equal(back.body.data.status, 'available');
    assert.equal(back.body.data.break_until, null);
  });

  test('الاستقبال يغيّر الحالة بس، وما يضيفش ولا يغيّر PIN', async () => {
    const token = await staffToken(http, ctx.shopId, 'cashier');
    assert.equal((await post(`/barbers/${hassan.id}/status`, { status: 'off' }, token)).status, 200);
    assert.equal((await post('/barbers', { name: 'x' }, token)).status, 403);
    assert.equal((await http.put(`${API}/barbers/${hassan.id}/pin`).set(bearer(token)).send({ pin: '0000' })).status, 403);
  });

  test('الأرشفة بتفضّي الكرسي وتخلّيه off', async () => {
    assert.equal((await http.delete(`${API}/barbers/${hassan.id}`).set(bearer(ctx.token))).status, 204);
    const archived = (await get('/barbers?include_archived=true')).body.data.find((item) => item.id === hassan.id);
    assert.equal(archived.status, 'off');
    assert.equal(archived.chair_no, null);
    assert.equal((await post('/barbers', { name: 'سيد', chair_no: 2 })).status, 201);
  });

  test('محل تاني ما يشوفش حلاقينا', async () => {
    const other = await seedShop({ name: 'محل تاني' });
    await seedUser({ shopId: other, role: 'owner', email: 'o3@test.local' });
    const { token } = await login(http, 'o3@test.local');
    assert.deepEqual((await get('/barbers', token)).body.data, []);
    assert.equal((await patch(`/barbers/${hassan.id}`, { name: 'x' }, token)).status, 404);
  });
});
