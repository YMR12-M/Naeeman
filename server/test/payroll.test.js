import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execute, queryOne } from '../src/config/db.js';
import { rentFor } from '../src/modules/payroll/payroll.service.js';
import { API, bearer, bootstrapOwner, makeApp, resetDatabase, shutdown, staffToken } from './helpers.js';

const { http } = makeApp();
let ctx;
let managerToken;
let cut;
let gel;
let hassan;
let samy;

const post = (path, body = {}, token = ctx.token) => http.post(`${API}${path}`).set(bearer(token)).send(body);
const put = (path, body = {}, token = ctx.token) => http.put(`${API}${path}`).set(bearer(token)).send(body);
const get = (path, token = ctx.token) => http.get(`${API}${path}`).set(bearer(token));

/** دور على حلاق معيّن ويخلص ويتدفع (بقشيش اختياري) */
async function paidVisit(barber, { tip = 0, product = false } = {}) {
  const ticket = (await post('/queue/tickets', { service_ids: [cut.id], barber_id: barber.id })).body.data;
  await post(`/queue/barbers/${barber.id}/next`);
  await post(`/queue/barbers/${barber.id}/finish`);
  const bill = (await post(`/bills/for-ticket/${ticket.id}`)).body.data;
  if (product) await post(`/bills/${bill.id}/items`, { product_id: gel.id });
  const total = 10000 + (product ? 4000 : 0);
  const paid = await post(`/bills/${bill.id}/checkout`, { tip, payments: [{ method: 'cash', amount: total + tip }] });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  return paid.body.data;
}

const PAY = {
  pay_type: 'commission', service_pct: 4000, product_pct: 1000, daily_wage: 0, rent_amount: 0, rent_period: 'week', tips_to_barber: true,
};

before(async () => {
  await resetDatabase();
  ctx = await bootstrapOwner(http, { shop: { slug: 'payroll-shop' } });
  managerToken = await staffToken(http, ctx.shopId, 'manager');
  await http.patch(`${API}/shop/settings`).set(bearer(ctx.token)).send({ cashier_enabled: true });
  [cut] = (await post('/services/bulk', { items: [{ name: 'قص', price: 10000, default_minutes: 25 }] })).body.data;
  gel = (await post('/products', { name: 'جِل', price: 4000, initial_qty: 20 })).body.data;
  hassan = (await post('/barbers', { name: 'حسن' })).body.data;
  samy = (await post('/barbers', { name: 'سامي' })).body.data;
  for (const barber of [hassan, samy]) await post(`/barbers/${barber.id}/status`, { status: 'available' });
  await post('/drawer/open', { opening_float: 50000 });
});
after(shutdown);

describe('حساب الحلاقين', () => {
  test('الإيجار بالتناسب مع المدّة', () => {
    assert.equal(rentFor({ rent_amount: 70000, rent_period: 'week' }, 14, 10), 140000);
    assert.equal(rentFor({ rent_amount: 30000, rent_period: 'month' }, 15, 12), 15000);
    assert.equal(rentFor({ rent_amount: 5000, rent_period: 'day' }, 7, 5), 25000);
    assert.equal(rentFor({ rent_amount: 0, rent_period: 'week' }, 7, 7), 0);
  });

  test('طريقة الحساب: المالك يعدّل، والمدير يشوف بس', async () => {
    assert.equal((await put(`/payroll/barbers/${hassan.id}`, PAY, managerToken)).status, 403);
    const saved = await put(`/payroll/barbers/${hassan.id}`, PAY);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.data.service_pct, 4000);
    assert.equal((await get('/payroll/barbers', managerToken)).body.data.length, 2);
  });

  test('بالنسبة: 40% خدمات + 10% منتجات + البقشيش − السلفة', async () => {
    await paidVisit(hassan, { tip: 2000 });
    await paidVisit(hassan, { product: true });
    // سلفة من الدرج (المدير)
    assert.equal((await post('/drawer/movements', { type: 'advance', amount: 3000, barber_id: hassan.id }, managerToken)).status, 201);

    const preview = (await get(`/payroll/preview?barber_id=${hassan.id}`, managerToken)).body.data;
    assert.equal(preview.services_total, 20000);
    assert.equal(preview.service_commission, 8000);
    assert.equal(preview.products_total, 4000);
    assert.equal(preview.product_commission, 400);
    assert.equal(preview.tips, 2000);
    assert.equal(preview.advances, 3000);
    assert.equal(preview.days_worked, 1);
    assert.equal(preview.net, 8000 + 400 + 2000 - 3000);
  });

  test('الحساب بيتصرف من الدرج وبيقفل كل حاجة: الحساب التاني فاضي', async () => {
    assert.equal((await post('/payroll/settlements', { barber_id: hassan.id, via: 'drawer' }, managerToken)).status, 403);
    const settled = await post('/payroll/settlements', { barber_id: hassan.id, via: 'drawer', note: 'حساب الأسبوع' });
    assert.equal(settled.status, 201, JSON.stringify(settled.body));
    assert.equal(settled.body.data.net, 7400);
    assert.equal(settled.body.data.settled_via, 'drawer');
    const payout = await queryOne('SELECT type, amount FROM cash_movements WHERE id = ?', [settled.body.data.cash_movement_id]);
    assert.deepEqual(payout, { type: 'payout', amount: 7400 });

    const again = await post('/payroll/settlements', { barber_id: hassan.id, via: 'drawer' });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'NOTHING_TO_SETTLE');

    const later = (await get(`/payroll/preview?barber_id=${hassan.id}`)).body.data;
    assert.equal(later.net, 0, 'كل حاجة اتحسبت');
    assert.equal(later.rent, 0);
    assert.equal(later.period_days, 0, 'حساب تاني في نفس اليوم من غير أيام جديدة');
    const before = await get(`/payroll/preview?barber_id=${hassan.id}&to=2020-01-01`);
    assert.equal(before.status, 422, 'قبل آخر حساب');
  });

  test('النسبة القديمة فاضلة على السطور القديمة', async () => {
    await put(`/payroll/barbers/${hassan.id}`, { ...PAY, service_pct: 5000 });
    const old = await queryOne(
      "SELECT commission_rate, commission FROM bill_items WHERE barber_id = ? AND kind = 'service' ORDER BY id LIMIT 1",
      [hassan.id],
    );
    assert.deepEqual(old, { commission_rate: 4000, commission: 4000 });
  });

  test('إيجار كرسي: الخدمات كلها للحلاق وعليه الإيجار، ولو عليه أكتر بيدفع للدرج', async () => {
    await put(`/payroll/barbers/${samy.id}`, {
      pay_type: 'chair_rent', service_pct: 10_000, product_pct: 0, daily_wage: 0, rent_amount: 70000, rent_period: 'week', tips_to_barber: true,
    });
    await paidVisit(samy);
    // الحساب لأسبوع: أوّل يوم شغل من 6 أيام
    const today = (await queryOne('SELECT MAX(business_date) AS d FROM barber_days WHERE barber_id = ?', [samy.id])).d;
    const weekAgo = new Date(`${today}T00:00:00Z`);
    weekAgo.setUTCDate(weekAgo.getUTCDate() - 6);
    await execute('INSERT INTO barber_days (barber_id, business_date, shop_id) VALUES (?, ?, ?)', [samy.id, weekAgo.toISOString().slice(0, 10), ctx.shopId]);

    const preview = (await get(`/payroll/preview?barber_id=${samy.id}`)).body.data;
    assert.equal(preview.period_days, 7);
    assert.equal(preview.service_commission, 10000);
    assert.equal(preview.rent, 70000);
    assert.equal(preview.net, 10000 - 70000);

    const settled = await post('/payroll/settlements', { barber_id: samy.id, via: 'drawer' });
    assert.equal(settled.status, 201);
    const collected = await queryOne('SELECT type, amount FROM cash_movements WHERE id = ?', [settled.body.data.cash_movement_id]);
    assert.deepEqual(collected, { type: 'cash_in', amount: 60000 });
  });

  test('يومية: × أيام الشغل، والمرتجع بيقلّل العمولة اللي ما اتحسبتش', async () => {
    await put(`/payroll/barbers/${samy.id}`, { ...PAY, pay_type: 'salary', daily_wage: 15000, service_pct: 1000 });
    const bill = await paidVisit(samy);
    await post(`/bills/${bill.id}/refund`, { amount: 5000, method: 'cash', reason: 'الزبون مش راضي' });
    const preview = (await get(`/payroll/preview?barber_id=${samy.id}`)).body.data;
    assert.equal(preview.days_worked, 0, 'اليوم ده اتحسب في الحساب اللي فات');
    assert.equal(preview.service_commission, 500);
    assert.equal(preview.wages, 0);
    const list = (await get(`/payroll/settlements?barber_id=${samy.id}`, managerToken)).body.data;
    assert.equal(list.length, 1);
  });
});
