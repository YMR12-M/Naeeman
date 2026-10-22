import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { query } from '../src/config/db.js';
import {
  API, bearer, bootstrapOwner, makeApp, resetDatabase, seedShop, seedUser, login, shutdown, staffToken,
} from './helpers.js';

const { http } = makeApp();
let ctx;

before(async () => {
  await resetDatabase();
  ctx = await bootstrapOwner(http);
});
after(shutdown);

describe('المحل', () => {
  test('GET /shop: البيانات + القواعد الافتراضية + المواعيد + الحالة دلوقتي', async () => {
    const response = await http.get(`${API}/shop`).set(bearer(ctx.token));
    assert.equal(response.status, 200);
    const shop = response.body.data;
    assert.equal(shop.name, 'صالون الاختبار');
    assert.equal(shop.accepting_tickets, true);
    assert.equal(shop.checkin_secret, undefined, 'سرّ الـ check-in ما يطلعش للواجهة أبدًا');
    assert.deepEqual(shop.settings, {
      remote_tickets_enabled: true, max_tickets_per_day: null, notify_ahead: 2, grace_minutes: 10,
      max_delays: 2, close_buffer_minutes: 15, display_name_style: 'first_initial',
    });
    assert.deepEqual(shop.hours, []);
    assert.equal(shop.now.open, false);
  });

  test('تعديل البيانات بيتسجّل في السجل', async () => {
    const response = await http.patch(`${API}/shop`).set(bearer(ctx.token))
      .send({ name: 'صالون الأمل', phone: '01012345678', accepting_tickets: false });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.name, 'صالون الأمل');
    assert.equal(response.body.data.phone, '+201012345678');
    assert.equal(response.body.data.accepting_tickets, false);

    const [row] = await query("SELECT before_json, after_json FROM audit_logs WHERE action = 'shop.update'");
    assert.ok(row);
  });

  test('حقول غير معروفة مرفوضة (ما ينفعش يغيّر الـ slug أو السرّ من هنا)', async () => {
    const response = await http.patch(`${API}/shop`).set(bearer(ctx.token)).send({ checkin_secret: 'x' });
    assert.equal(response.status, 422);
  });
});

describe('المواعيد', () => {
  test('الأسبوع كله مرّة واحدة، وفترة بتعدّي نص الليل مقبولة', async () => {
    const periods = [0, 1, 2, 3, 4, 6].map((weekday) => ({ weekday, opens_at: '12:00', closes_at: '02:00' }));
    const response = await http.put(`${API}/shop/hours`).set(bearer(ctx.token)).send({ periods });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.periods.length, 6);
    assert.deepEqual(response.body.data.periods[0], { weekday: 0, opens_at: '12:00', closes_at: '02:00' });
    assert.ok('open' in response.body.data.now);
  });

  test('فترتين متداخلتين في نفس اليوم مرفوضين', async () => {
    const response = await http.put(`${API}/shop/hours`).set(bearer(ctx.token)).send({
      periods: [{ weekday: 5, opens_at: '10:00', closes_at: '15:00' }, { weekday: 5, opens_at: '14:00', closes_at: '20:00' }],
    });
    assert.equal(response.status, 422);
    assert.match(response.body.errors.periods, /متداخلين/);
  });

  test('وقت غلط مرفوض', async () => {
    const response = await http.put(`${API}/shop/hours`).set(bearer(ctx.token)).send({
      periods: [{ weekday: 1, opens_at: '25:00', closes_at: '20:00' }],
    });
    assert.equal(response.status, 422);
  });
});

describe('قواعد الطابور', () => {
  test('تعديل جزئي', async () => {
    const response = await http.patch(`${API}/shop/settings`).set(bearer(ctx.token))
      .send({ grace_minutes: 15, max_tickets_per_day: 80, display_name_style: 'number_only' });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.grace_minutes, 15);
    assert.equal(response.body.data.max_tickets_per_day, 80);
    assert.equal(response.body.data.display_name_style, 'number_only');
    assert.equal(response.body.data.notify_ahead, 2);
  });

  test('قيم برّه الحدود مرفوضة', async () => {
    const response = await http.patch(`${API}/shop/settings`).set(bearer(ctx.token)).send({ grace_minutes: 0 });
    assert.equal(response.status, 422);
  });
});

describe('الصلاحيات', () => {
  test('المدير والاستقبال يقروا المحل بس، وما يعدّلوش الإعدادات', async () => {
    for (const role of ['manager', 'cashier']) {
      const token = await staffToken(http, ctx.shopId, role);
      assert.equal((await http.get(`${API}/shop`).set(bearer(token))).status, 200);
      assert.equal((await http.patch(`${API}/shop`).set(bearer(token)).send({ name: 'x' })).status, 403);
      assert.equal((await http.patch(`${API}/shop/settings`).set(bearer(token)).send({ grace_minutes: 5 })).status, 403);
      assert.equal((await http.put(`${API}/shop/hours`).set(bearer(token)).send({ periods: [] })).status, 403);
    }
  });

  test('كل محل يشوف نفسه بس', async () => {
    const other = await seedShop({ name: 'محل تاني' });
    await seedUser({ shopId: other, role: 'owner', email: 'o2@test.local' });
    const { token } = await login(http, 'o2@test.local');
    const response = await http.get(`${API}/shop`).set(bearer(token));
    assert.equal(response.body.data.name, 'محل تاني');
  });
});
