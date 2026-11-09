import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { query } from '../src/config/db.js';
import { allocate, applyRate, weightedCost } from '../src/utils/money.js';
import { API, bearer, bootstrapOwner, makeApp, resetDatabase, shutdown, staffToken } from './helpers.js';

const { http } = makeApp();
let ctx;
let cashierToken;

const post = (path, body = {}, token = ctx.token) => http.post(`${API}${path}`).set(bearer(token)).send(body);
const get = (path, token = ctx.token) => http.get(`${API}${path}`).set(bearer(token));

before(async () => {
  await resetDatabase();
  ctx = await bootstrapOwner(http, { shop: { slug: 'stock-shop' } });
  cashierToken = await staffToken(http, ctx.shopId, 'cashier');
});
after(shutdown);

describe('حسابات الفلوس', () => {
  test('التوزيع بالقرش: المجموع مظبوط دايمًا', () => {
    assert.deepEqual(allocate(1000, [3333, 3333, 3334]), [333, 333, 334]);
    assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
    assert.deepEqual(allocate(0, [5, 5]), [0, 0]);
    assert.deepEqual(allocate(500, [0, 0]), [0, 0]);
    for (let i = 0; i < 50; i += 1) {
      const weights = Array.from({ length: 1 + (i % 6) }, (_, k) => (k * 1373 + i * 97) % 9000 + 1);
      const amount = (i * 7919) % 50_000;
      assert.equal(allocate(amount, weights).reduce((a, b) => a + b, 0), amount);
    }
  });

  test('النسبة × 100 والمتوسّط المرجّح', () => {
    assert.equal(applyRate(15000, 4000), 6000);
    assert.equal(applyRate(9999, 1250), 1250);
    assert.equal(weightedCost(10, 2000, 10, 3000), 2500);
    assert.equal(weightedCost(-3, 2000, 5, 3000), 3000, 'المخزن السالب ما يدخلش في المتوسّط');
  });
});

describe('المنتجات', () => {
  let gel;

  test('منتج جديد برصيد أوّل، والباركود فريد', async () => {
    const created = await post('/products', { name: 'جِل', barcode: '111', price: 5000, cost: 3000, initial_qty: 10, low_stock_at: 3 });
    assert.equal(created.status, 201);
    gel = created.body.data;
    assert.equal(gel.stock_qty, 10);
    assert.equal(gel.low_stock, false);
    const dup = await post('/products', { name: 'جِل تاني', barcode: '111', price: 100 });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'BARCODE_TAKEN');
    assert.equal((await post('/products', { name: 'شمع', price: 100 }, cashierToken)).status, 403);
  });

  test('شراء بيحدّث متوسّط التكلفة، والاستهلاك والجرد بفرق وبسبب', async () => {
    const bought = await post(`/products/${gel.id}/stock`, { type: 'purchase', qty: 10, unit_cost: 4000 });
    assert.equal(bought.body.data.stock_qty, 20);
    assert.equal(bought.body.data.cost, 3500);

    const used = await post(`/products/${gel.id}/stock`, { type: 'use', qty: 2, note: 'للمحل' });
    assert.equal(used.body.data.stock_qty, 18);

    const noReason = await post(`/products/${gel.id}/stock`, { type: 'adjust', counted_qty: 15 });
    assert.equal(noReason.status, 422);
    const counted = await post(`/products/${gel.id}/stock`, { type: 'adjust', counted_qty: 2, note: 'جرد آخر الشهر' });
    assert.equal(counted.body.data.stock_qty, 2);
    assert.equal(counted.body.data.low_stock, true);

    const moves = (await get(`/products/${gel.id}/movements`)).body.data;
    assert.deepEqual(moves.map((m) => [m.type, m.qty, m.stock_after]), [
      ['adjust', -16, 2], ['use', -2, 18], ['purchase', 10, 20], ['purchase', 10, 10],
    ]);
  });

  test('البحث والباركود والأرشفة', async () => {
    assert.equal((await get('/products/lookup?barcode=111', cashierToken)).body.data.id, gel.id);
    assert.equal((await get('/products/lookup?barcode=999', cashierToken)).status, 404);
    assert.equal((await get('/products?q=جِل', cashierToken)).body.data.length, 1);
    await http.delete(`${API}/products/${gel.id}`).set(bearer(ctx.token));
    assert.equal((await get('/products')).body.data.length, 0);
    assert.equal((await get('/products/lookup?barcode=111')).status, 404);
    await post(`/products/${gel.id}/restore`);
    assert.equal((await get('/products')).body.data.length, 1);
  });

  test('منتج من غير تتبّع مخزن: البيع ما بيسجّلش حركة', async () => {
    const tea = (await post('/products', { name: 'شاي', price: 1000, track_stock: false })).body.data;
    assert.equal((await post(`/products/${tea.id}/stock`, { type: 'purchase', qty: 1 })).body.code, 'STOCK_NOT_TRACKED');
    const bill = (await post('/bills', { items: [{ product_id: tea.id, qty: 3 }] }, cashierToken)).body.data;
    await post(`/bills/${bill.id}/checkout`, { payments: [] }, cashierToken).then((r) => assert.equal(r.body.code, 'PAYMENT_MISMATCH'));
    await post('/drawer/open', { opening_float: 0 }, cashierToken);
    const paid = await post(`/bills/${bill.id}/checkout`, { payments: [{ method: 'cash', amount: 3000 }] }, cashierToken);
    assert.equal(paid.status, 200);
    const rows = await query('SELECT id FROM stock_movements WHERE product_id = ?', [tea.id]);
    assert.equal(rows.length, 0);
  });
});
