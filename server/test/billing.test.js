import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execute, query, queryOne } from '../src/config/db.js';
import { API, bearer, bootstrapOwner, makeApp, resetDatabase, shutdown, staffToken } from './helpers.js';

const { http } = makeApp();
let ctx;
let cashier;
let manager;
let cut;
let beard;
let gel;
let hassan;

const as = (token) => ({
  get: (path, query = {}) => http.get(`${API}${path}`).query(query).set(bearer(token)),
  post: (path, body = {}, headers = {}) => http.post(`${API}${path}`).set(bearer(token)).set(headers).send(body),
  patch: (path, body = {}) => http.patch(`${API}${path}`).set(bearer(token)).send(body),
  del: (path) => http.delete(`${API}${path}`).set(bearer(token)),
});
let owner;

/** زبون من الشارع على حسن، ويخلص */
async function servedTicket(serviceIds = [cut.id], extra = {}) {
  const ticket = (await owner.post('/queue/tickets', { service_ids: serviceIds, barber_id: hassan.id, ...extra })).body.data;
  await owner.post(`/queue/barbers/${hassan.id}/next`);
  await owner.post(`/queue/barbers/${hassan.id}/finish`);
  return ticket;
}

const billOf = async (ticketId) => (await owner.post(`/bills/for-ticket/${ticketId}`)).body.data;
const setCashier = (enabled) => owner.patch('/shop/settings', { cashier_enabled: enabled });

before(async () => {
  await resetDatabase();
  ctx = await bootstrapOwner(http, { shop: { name: 'صالون الكاشير', slug: 'cashier-shop' } });
  owner = as(ctx.token);
  cashier = as(await staffToken(http, ctx.shopId, 'cashier'));
  manager = as(await staffToken(http, ctx.shopId, 'manager'));
  [cut, beard] = (await owner.post('/services/bulk', {
    items: [{ name: 'قص', price: 10000, default_minutes: 25 }, { name: 'دقن', price: 5000, default_minutes: 15 }],
  })).body.data;
  hassan = (await owner.post('/barbers', { name: 'حسن' })).body.data;
  await owner.post(`/barbers/${hassan.id}/status`, { status: 'available' });
  gel = (await owner.post('/products', { name: 'جِل', barcode: '6221000000017', price: 4000, cost: 2500, initial_qty: 10 })).body.data;
});
after(shutdown);

describe('الكاشير مقفول (زي المرحلة الأولى)', () => {
  test('الدور اللي خلص = فاتورة اتسدّدت كاش لوحدها، والتقرير بيقرا منها', async () => {
    const ticket = await servedTicket([cut.id, beard.id]);
    const bill = await billOf(ticket.id);
    assert.equal(bill.status, 'paid');
    assert.equal(bill.auto_paid, true);
    assert.equal(bill.total, 15000);
    assert.equal(bill.items.length, 2);
    assert.equal(bill.items[0].barber_id, hassan.id);
    assert.deepEqual(bill.payments.map((p) => [p.method_code, p.amount]), [['cash', 15000]]);

    const day = (await owner.get('/reports/today')).body.data;
    assert.equal(day.revenue, 15000);
    assert.deepEqual(day.methods.map((m) => [m.code, m.net]), [['cash', 15000]]);
  });
});

describe('الكاشير شغّال', () => {
  test('الفاتورة بتستنّى الكاشير، ومفيش دفع من غير درج', async () => {
    await setCashier(true);
    const ticket = await servedTicket([cut.id]);
    const bill = await billOf(ticket.id);
    assert.equal(bill.status, 'open');
    assert.equal(bill.subtotal, 10000);

    const closed = await cashier.post(`/bills/${bill.id}/checkout`, { payments: [{ method: 'card', amount: 10000 }] });
    assert.equal(closed.status, 409);
    assert.equal(closed.body.code, 'DRAWER_CLOSED');

    const drawer = await cashier.post('/drawer/open', { opening_float: 20000 });
    assert.equal(drawer.status, 201);
    assert.equal((await cashier.post('/drawer/open', { opening_float: 0 })).body.code, 'DRAWER_OPEN');
  });

  test('دفع مقسوم: كاش بباقي + إنستاباي، والمجموع لازم يطابق، والبقشيش للحلاق', async () => {
    const ticket = await servedTicket([cut.id, beard.id]);
    const bill = await billOf(ticket.id);

    const wrong = await cashier.post(`/bills/${bill.id}/checkout`, { payments: [{ method: 'cash', amount: 10000 }] });
    assert.equal(wrong.status, 422);
    assert.equal(wrong.body.code, 'PAYMENT_MISMATCH');

    const paid = await cashier.post(`/bills/${bill.id}/checkout`, {
      tip: 1000,
      payments: [
        { method: 'cash', amount: 6000, tendered: 10000 },
        { method: 'instapay', amount: 10000, reference: 'IP-778' },
      ],
    });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    assert.equal(paid.body.data.status, 'paid');
    assert.equal(paid.body.data.total, 15000);
    assert.equal(paid.body.data.tip, 1000);
    assert.equal(paid.body.data.paid, 16000);
    assert.equal(paid.body.data.change, 4000);

    const again = await cashier.post(`/bills/${bill.id}/checkout`, { payments: [{ method: 'cash', amount: 15000 }] });
    assert.equal(again.body.code, 'BILL_PAID');
  });

  test('دفعتين لنفس الفاتورة في نفس اللحظة: واحدة بس بتعدّي', async () => {
    const ticket = await servedTicket([cut.id]);
    const bill = await billOf(ticket.id);
    const body = { payments: [{ method: 'cash', amount: 10000 }] };
    const results = await Promise.all([
      cashier.post(`/bills/${bill.id}/checkout`, body),
      manager.post(`/bills/${bill.id}/checkout`, body),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const { n } = await queryOne("SELECT COUNT(*) AS n FROM payments WHERE bill_id = ? AND kind = 'payment'", [bill.id]);
    assert.equal(n, 1);
  });

  test('نفس الطلب اتبعت مرّتين بنفس المفتاح: بيرجع نفس الرد', async () => {
    const ticket = await servedTicket([beard.id]);
    const bill = await billOf(ticket.id);
    const key = { 'Idempotency-Key': `checkout-${bill.id}-abcdef` };
    const body = { payments: [{ method: 'cash', amount: 5000 }] };
    const first = await cashier.post(`/bills/${bill.id}/checkout`, body, key);
    const second = await cashier.post(`/bills/${bill.id}/checkout`, body, key);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(second.headers['idempotent-replay'], 'true');
  });

  test('الخصم: لازم سبب، والاستقبال لحد 10%، والمدير من غير حد، والخصم بيتوزّع على السطور', async () => {
    const ticket = await servedTicket([cut.id, beard.id]);
    const bill = await billOf(ticket.id);
    const noReason = await cashier.post(`/bills/${bill.id}/checkout`, { discount: 1000, payments: [{ method: 'cash', amount: 14000 }] });
    assert.equal(noReason.status, 422);
    assert.equal(noReason.body.errors.discount_reason, 'الحقل مطلوب');

    const tooMuch = await cashier.post(`/bills/${bill.id}/checkout`, {
      discount: 3000, discount_reason: 'زبون قديم', payments: [{ method: 'cash', amount: 12000 }],
    });
    assert.equal(tooMuch.status, 403);
    assert.equal(tooMuch.body.code, 'DISCOUNT_LIMIT');

    const ok = await manager.post(`/bills/${bill.id}/checkout`, {
      discount: 3000, discount_reason: 'زبون قديم', payments: [{ method: 'cash', amount: 12000 }],
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.data.items.map((item) => item.discount_share), [2000, 1000]);
  });

  test('منتج وهو مستني: الفاتورة بتتفتح بدري والخدمة بتنضاف لما الدور يخلص، والمخزن بينقص بعد الدفع', async () => {
    const ticket = (await owner.post('/queue/tickets', { service_ids: [cut.id], barber_id: hassan.id })).body.data;
    const early = await billOf(ticket.id);
    assert.equal(early.status, 'open');
    await cashier.post(`/bills/${early.id}/items`, { product_id: gel.id });
    await cashier.post(`/bills/${early.id}/items`, { product_id: gel.id }); // الماسح اتداس مرّتين = كمية 2
    await owner.post(`/queue/barbers/${hassan.id}/next`);
    await owner.post(`/queue/barbers/${hassan.id}/finish`);

    const bill = (await cashier.get(`/bills/${early.id}`)).body.data;
    assert.deepEqual(bill.items.map((item) => [item.kind, item.qty, item.line_total, item.barber_id]), [
      ['product', 2, 8000, hassan.id],
      ['service', 1, 10000, hassan.id],
    ]);
    await cashier.post(`/bills/${early.id}/checkout`, { payments: [{ method: 'card', amount: 18000 }] });
    assert.equal((await owner.get(`/products/${gel.id}`)).body.data.stock_qty, 8);
  });

  test('بيع من غير دور بالباركود، والاستقبال يشيل منتج بس مش خدمة', async () => {
    const found = (await cashier.get('/products/lookup', { barcode: '6221000000017' })).body.data;
    const bill = (await cashier.post('/bills', { items: [{ product_id: found.id }, { service_id: beard.id }] })).body.data;
    assert.equal(bill.source, 'counter');
    assert.equal(bill.subtotal, 9000);
    const service = bill.items.find((item) => item.kind === 'service');
    assert.equal((await cashier.del(`/bills/${bill.id}/items/${service.id}`)).status, 403);
    const product = bill.items.find((item) => item.kind === 'product');
    const after = (await cashier.del(`/bills/${bill.id}/items/${product.id}`)).body.data;
    assert.equal(after.subtotal, 5000);

    // فاتورة فيها سطور: الإلغاء للمدير
    assert.equal((await cashier.post(`/bills/${bill.id}/void`, { reason: 'غلط' })).status, 403);
    const voided = await manager.post(`/bills/${bill.id}/void`, { reason: 'غلط' });
    assert.equal(voided.body.data.status, 'void');
  });

  test('المرتجع: للمدير، بحدّ المدفوع، والمنتج بيرجع المخزن مرّة واحدة', async () => {
    const bill = (await cashier.post('/bills', { items: [{ product_id: gel.id, qty: 2 }] })).body.data;
    await cashier.post(`/bills/${bill.id}/checkout`, { payments: [{ method: 'cash', amount: 8000 }] });
    const stock = (await owner.get(`/products/${gel.id}`)).body.data.stock_qty;
    const item = bill.items[0];

    assert.equal((await cashier.post(`/bills/${bill.id}/refund`, { amount: 4000, method: 'cash', reason: 'مكسور' })).status, 403);
    const big = await manager.post(`/bills/${bill.id}/refund`, { amount: 9000, method: 'cash', reason: 'مكسور' });
    assert.equal(big.status, 422);

    const refunded = await manager.post(`/bills/${bill.id}/refund`, {
      amount: 4000, method: 'cash', reason: 'مكسور', restock: [{ item_id: item.id, qty: 1 }],
    });
    assert.equal(refunded.status, 200, JSON.stringify(refunded.body));
    assert.equal(refunded.body.data.refunded, 4000);
    assert.equal((await owner.get(`/products/${gel.id}`)).body.data.stock_qty, stock + 1);

    const twice = await manager.post(`/bills/${bill.id}/refund`, {
      amount: 1000, method: 'cash', reason: 'تاني', restock: [{ item_id: item.id, qty: 2 }],
    });
    assert.equal(twice.status, 422);
  });

  test('الدرج: المتوقّع بالفكّة والكاش والمصروف والمرتجع، والقفل بيسجّل الفرق', async () => {
    const current = (await cashier.get('/drawer/current')).body.data;
    const expected = current.totals.expected_cash;
    // فكّة 200 + كاش 60 + 100 + 50 + 120 + 80 − مرتجع 40
    assert.equal(expected, 20000 + 6000 + 10000 + 5000 + 12000 + 8000 - 4000);

    const tooBig = await cashier.post('/drawer/movements', { type: 'expense', amount: expected + 1, note: 'شاي' });
    assert.equal(tooBig.body.code, 'DRAWER_SHORT');
    const noNote = await cashier.post('/drawer/movements', { type: 'expense', amount: 500 });
    assert.equal(noNote.status, 422);
    assert.equal((await cashier.post('/drawer/movements', { type: 'expense', amount: 500, note: 'شاي' })).status, 201);
    assert.equal((await cashier.post('/drawer/movements', { type: 'advance', amount: 500, barber_id: hassan.id })).status, 403);

    const closed = await cashier.post('/drawer/close', { counted_cash: expected - 500 - 300 });
    assert.equal(closed.status, 200);
    assert.equal(closed.body.data.expected_cash, expected - 500);
    assert.equal(closed.body.data.variance, -300);
  });

  test('تقفيل اليوم: بيختم الفترة، والتقفيل التاني فاضي، والفاتورة المفتوحة بتترحّل', async () => {
    const open = (await cashier.post('/bills', { items: [{ product_id: gel.id }] })).body.data;
    assert.equal((await cashier.get('/day-close/preview')).status, 403);

    const preview = (await manager.get('/day-close/preview')).body.data;
    assert.deepEqual(preview.blockers, []);
    assert.equal(preview.warnings[0].code, 'OPEN_BILLS');
    assert.equal(preview.summary.variance, -300);
    assert.ok(preview.summary.sales > 0);

    const closed = await manager.post('/day-close', { note: 'آخر اليوم' });
    assert.equal(closed.status, 201, JSON.stringify(closed.body));
    assert.equal(closed.body.data.number, 1);
    const { n } = await queryOne('SELECT COUNT(*) AS n FROM payments WHERE day_close_id IS NULL');
    assert.equal(n, 0);

    const again = await manager.post('/day-close', {});
    assert.equal(again.body.code, 'NOTHING_TO_CLOSE');

    // درج مفتوح بيمنع التقفيل
    await cashier.post('/drawer/open', { opening_float: 0 });
    await cashier.post(`/bills/${open.id}/checkout`, { payments: [{ method: 'cash', amount: 4000 }] });
    const blocked = await manager.post('/day-close', {});
    assert.equal(blocked.body.code, 'DRAWER_OPEN');
    await cashier.post('/drawer/close', { counted_cash: 4000 });
    const second = await manager.post('/day-close', {});
    assert.equal(second.body.data.number, 2);
    assert.equal(second.body.data.summary.sales, 4000);
    assert.equal((await manager.get('/day-close')).body.data.length, 2);
  });

  test('طرق الدفع: المالك بس يزوّد ويقفل، والكاش ما يتقفلش', async () => {
    const methods = (await cashier.get('/payment-methods')).body.data;
    assert.deepEqual(methods.map((m) => m.code), ['cash', 'card', 'wallet', 'instapay']);
    assert.equal((await manager.post('/payment-methods', { label: 'فوري', kind: 'other' })).status, 403);
    const fawry = await owner.post('/payment-methods', { label: 'فوري', kind: 'other' });
    assert.equal(fawry.status, 201);
    const cash = methods.find((m) => m.code === 'cash');
    assert.equal((await owner.patch(`/payment-methods/${cash.id}`, { active: false })).body.code, 'CASH_REQUIRED');
    const card = methods.find((m) => m.code === 'card');
    await owner.patch(`/payment-methods/${card.id}`, { active: false });

    await cashier.post('/drawer/open', { opening_float: 0 });
    const bill = (await cashier.post('/bills', { items: [{ product_id: gel.id }] })).body.data;
    const refused = await cashier.post(`/bills/${bill.id}/checkout`, { payments: [{ method: 'card', amount: 4000 }] });
    assert.equal(refused.body.code, 'BAD_METHOD');
    const viaFawry = await cashier.post(`/bills/${bill.id}/checkout`, { payments: [{ method: fawry.body.data.code, amount: 4000 }] });
    assert.equal(viaFawry.status, 200);
    await owner.patch(`/payment-methods/${card.id}`, { active: true });
  });

  test('الإيصال: بيانات المحل والفاتورة والمقاس', async () => {
    await owner.patch('/shop/settings', { receipt_width: 58, receipt_footer: 'نعيمًا يا باشا' });
    const [{ id }] = await query("SELECT id FROM bills WHERE status = 'paid' ORDER BY id DESC LIMIT 1");
    const receipt = (await cashier.get(`/bills/${id}/receipt`)).body.data;
    assert.equal(receipt.width, 58);
    assert.equal(receipt.footer, 'نعيمًا يا باشا');
    assert.equal(receipt.shop.name, 'صالون الكاشير');
    assert.match(receipt.shop.url, /\/s\/cashier-shop$/);
    assert.ok(receipt.bill.items.length > 0);
  });

  test('التقرير: المبيعات والمحصّل لكل طريقة والمنتجات والمصروفات', async () => {
    const day = (await owner.get('/reports/today')).body.data;
    assert.ok(day.methods.some((m) => m.code === 'instapay' && m.net === 10000));
    assert.equal(day.tips, 1000);
    assert.equal(day.refunds, 4000);
    assert.equal(day.expenses, 500);
    assert.equal(day.discounts, 3000);
    assert.ok(day.products.find((p) => p.name === 'جِل').qty >= 5);
    assert.equal(day.net_revenue, day.revenue - day.refunds);

    const range = (await owner.get('/reports/range', { from: day.business_date, to: day.business_date })).body.data;
    assert.equal(range.revenue, day.revenue);
    assert.equal(range.days.length, 1);
  });

  test('الكاشير ما يشوفش التقفيل ولا الحساب ولا يعدّل المنتجات', async () => {
    assert.equal((await cashier.get('/payroll/barbers')).status, 403);
    assert.equal((await cashier.post('/products', { name: 'شمع', price: 100 })).status, 403);
    assert.equal((await cashier.post(`/products/${gel.id}/stock`, { type: 'purchase', qty: 1 })).status, 403);
  });
});

describe('عزل المحلات', () => {
  test('محل تاني ما يشوفش فواتير المحل ده', async () => {
    const other = await bootstrapOwner(http, { email: 'other-owner@test.local', shop: { slug: 'other-billing' } });
    const [{ id }] = await query('SELECT id FROM bills WHERE shop_id = ? LIMIT 1', [ctx.shopId]);
    assert.equal((await as(other.token).get(`/bills/${id}`)).status, 404);
    assert.equal((await as(other.token).post(`/bills/${id}/items`, { product_id: gel.id })).status, 404);
    await execute('UPDATE shops SET status = status WHERE id = ?', [other.shopId]);
  });
});
