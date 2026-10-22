import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../src/config/db.js';
import { API, bearer, bootstrapOwner, makeApp, resetDatabase, shutdown, staffToken } from './helpers.js';

const { http } = makeApp();
let ctx;
let cut;
let beard;
let hassan;
let mahmoud;

const staffPost = (path, body = {}) => http.post(`${API}${path}`).set(bearer(ctx.token)).send(body);
const walkIn = async (body) => (await staffPost('/queue/tickets', body)).body.data;

before(async () => {
  await resetDatabase();
  ctx = await bootstrapOwner(http);
  [cut, beard] = (await staffPost('/services/bulk', {
    items: [{ name: 'قص', price: 9000, default_minutes: 25 }, { name: 'دقن', price: 4000, default_minutes: 15 }],
  })).body.data;
  hassan = (await staffPost('/barbers', { name: 'حسن' })).body.data;
  mahmoud = (await staffPost('/barbers', { name: 'محمود' })).body.data;
  for (const barber of [hassan, mahmoud]) await staffPost(`/barbers/${barber.id}/status`, { status: 'available' });
});
after(shutdown);

test('ملخّص اليوم: الأعداد والإيراد ومتوسّطات الانتظار والخدمة ولكل حلاق', async () => {
  const a = await walkIn({ service_ids: [cut.id, beard.id] });
  const b = await walkIn({ service_ids: [cut.id] });
  const c = await walkIn({ service_ids: [cut.id] });
  const d = await walkIn({ service_ids: [beard.id] });
  await walkIn({ service_ids: [cut.id] });

  await staffPost(`/queue/barbers/${hassan.id}/next`);
  await staffPost(`/queue/barbers/${mahmoud.id}/next`);
  // a: استنّى 10 دقايق وخد 20 عند حسن. b: استنّى 20 وخد 30 عند محمود
  await execute(`UPDATE queue_tickets SET arrived_at = DATE_SUB(NOW(), INTERVAL 30 MINUTE),
                 started_at = DATE_SUB(NOW(), INTERVAL 20 MINUTE) WHERE id = ?`, [a.id]);
  await execute(`UPDATE queue_tickets SET arrived_at = DATE_SUB(NOW(), INTERVAL 50 MINUTE),
                 started_at = DATE_SUB(NOW(), INTERVAL 30 MINUTE) WHERE id = ?`, [b.id]);
  await staffPost(`/queue/barbers/${hassan.id}/finish`);
  await staffPost(`/queue/barbers/${mahmoud.id}/finish`);
  await staffPost(`/queue/tickets/${c.id}/no-show`);
  await staffPost(`/queue/tickets/${d.id}/cancel`);

  const response = await http.get(`${API}/reports/today`).set(bearer(ctx.token));
  assert.equal(response.status, 200);
  const day = response.body.data;
  assert.equal(day.tickets, 5);
  assert.equal(day.done, 2);
  assert.equal(day.no_show, 1);
  assert.equal(day.cancelled, 1);
  assert.equal(day.active, 1);
  assert.deepEqual(day.by_source, { app: 0, kiosk: 0, staff: 5 });
  assert.equal(day.revenue, 13000 + 9000);
  assert.equal(day.avg_wait_minutes, 15);
  assert.equal(day.avg_service_minutes, 25);
  assert.deepEqual(day.barbers.map((row) => [row.name, row.done, row.revenue, row.avg_service_minutes]), [
    ['حسن', 1, 13000, 20],
    ['محمود', 1, 9000, 30],
  ]);
  assert.deepEqual(day.services, [{ name: 'قص', count: 2, revenue: 18000 }, { name: 'دقن', count: 1, revenue: 4000 }]);
});

test('يوم تاني فاضي، والاستقبال ما يشوفش التقارير', async () => {
  const old = await http.get(`${API}/reports/today?date=2020-01-01`).set(bearer(ctx.token));
  assert.equal(old.body.data.tickets, 0);
  assert.equal(old.body.data.avg_wait_minutes, null);

  const cashier = await staffToken(http, ctx.shopId, 'cashier');
  assert.equal((await http.get(`${API}/reports/today`).set(bearer(cashier))).status, 403);
  const manager = await staffToken(http, ctx.shopId, 'manager');
  assert.equal((await http.get(`${API}/reports/today`).set(bearer(manager))).status, 200);
});
