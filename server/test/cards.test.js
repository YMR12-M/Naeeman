import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execute, query, queryOne } from '../src/config/db.js';
import { API, bearer, bootstrapOwner, makeApp, resetDatabase, shutdown, staffToken } from './helpers.js';

const { http } = makeApp();
let ctx;
let owner;
let cashier;
let manager;
let cut;
let beard;
let hassan;

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 1)]);

const as = (token) => ({
  get: (path, q = {}) => http.get(`${API}${path}`).query(q).set(bearer(token)),
  post: (path, body = {}) => http.post(`${API}${path}`).set(bearer(token)).send(body),
  patch: (path, body = {}) => http.patch(`${API}${path}`).set(bearer(token)).send(body),
  del: (path) => http.delete(`${API}${path}`).set(bearer(token)),
  image: (path, buffer, type = 'image/jpeg') => http.post(`${API}${path}`).set(bearer(token)).set('Content-Type', type).send(buffer),
});

async function walkIn(extra = {}, services = [cut.id]) {
  return (await owner.post('/queue/tickets', { service_ids: services, barber_id: hassan.id, ...extra })).body.data;
}
async function serve(ticket) {
  await owner.post(`/queue/barbers/${hassan.id}/next`);
  await owner.post(`/queue/barbers/${hassan.id}/finish`);
  return ticket;
}

async function register(phone, name = 'كريم') {
  const response = await http.post(`${API}/customer-auth/register`).set('X-Client-Type', 'mobile')
    .send({ name, phone, password: 'zaboon-pass-1' });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.tokens.access_token;
}

async function pairChair() {
  const code = (await owner.post('/devices/pairing-code', { type: 'chair', name: 'كرسي 1' })).body.data.code;
  const token = (await http.post(`${API}/devices/pair`).send({ code })).body.data.token;
  await http.put(`${API}/barbers/${hassan.id}/pin`).set(bearer(ctx.token)).send({ pin: '4321' });
  const device = {
    get: (path) => http.get(`${API}${path}`).set('X-Device-Token', token),
    post: (path, body = {}) => http.post(`${API}${path}`).set('X-Device-Token', token).send(body),
    image: (path, buffer) => http.post(`${API}${path}`).set('X-Device-Token', token).set('Content-Type', 'image/jpeg').send(buffer),
  };
  assert.equal((await device.post('/chair/login', { barber_id: hassan.id, pin: '4321' })).status, 200);
  return device;
}

before(async () => {
  await resetDatabase();
  ctx = await bootstrapOwner(http, { shop: { name: 'صالون الكروت', slug: 'cards-shop' } });
  owner = as(ctx.token);
  cashier = as(await staffToken(http, ctx.shopId, 'cashier'));
  manager = as(await staffToken(http, ctx.shopId, 'manager'));
  await owner.patch('/shop/settings', { loyalty_enabled: true, loyalty_stamps_required: 2 });
  await http.put(`${API}/shop/hours`).set(bearer(ctx.token))
    .send({ periods: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens_at: '00:00', closes_at: '00:00' })) });
  [cut, beard] = (await owner.post('/services/bulk', {
    items: [{ name: 'قص', price: 10000, default_minutes: 25 }, { name: 'دقن', price: 5000, default_minutes: 15 }],
  })).body.data;
  hassan = (await owner.post('/barbers', { name: 'حسن' })).body.data;
  await owner.post(`/barbers/${hassan.id}/status`, { status: 'available' });
});
after(shutdown);

describe('كارت الزبون', () => {
  let cardId;

  test('زبون شارع بموبايل = كارت، ونفس الرقم المرّة الجاية = نفس الكارت', async () => {
    const first = await serve(await walkIn({ name: 'كريم', phone: '01011112222' }));
    const queued = await walkIn({ name: 'كريم سعيد', phone: '01011112222' });
    const row = await queryOne('SELECT shop_customer_id FROM queue_tickets WHERE id = ?', [first.id]);
    const second = await queryOne('SELECT shop_customer_id FROM queue_tickets WHERE id = ?', [queued.id]);
    assert.ok(row.shop_customer_id);
    assert.equal(second.shop_customer_id, row.shop_customer_id);
    cardId = row.shop_customer_id;

    const queue = (await owner.get('/queue')).body.data;
    const waiting = queue.waiting.find((ticket) => ticket.id === queued.id);
    assert.equal(waiting.card.id, cardId);
    assert.equal(waiting.card.visits, 1);
    assert.deepEqual(waiting.card.loyalty, { enabled: true, stamps: 1, required: 2, eligible: false, left: 1, reward: 'أغلى خدمة في الزيارة ببلاش' });
    await serve(queued);
  });

  test('زبون من غير موبايل مالوش كارت', async () => {
    const ticket = await serve(await walkIn({ name: 'عابر' }));
    const row = await queryOne('SELECT shop_customer_id FROM queue_tickets WHERE id = ?', [ticket.id]);
    assert.equal(row.shop_customer_id, null);
  });

  test('نزّل التطبيق بنفس الرقم: الكارت نفسه بيترَبط بحسابه بأختامه', async () => {
    const token = await register('01011112222', 'كريم');
    const take = await http.post(`${API}/me/tickets`).set(bearer(token)).send({ shop_slug: 'cards-shop', service_ids: [cut.id] });
    assert.equal(take.status, 201, JSON.stringify(take.body));
    const card = await queryOne('SELECT id, customer_id, stamps, visits FROM shop_customers WHERE id = ?', [cardId]);
    assert.ok(card.customer_id);
    assert.equal(card.stamps, 2);
    assert.equal(card.visits, 2);

    const mine = (await http.get(`${API}/me/cards`).set(bearer(token))).body.data;
    assert.equal(mine.length, 1);
    assert.equal(mine[0].shop_name, 'صالون الكروت');
    assert.equal(mine[0].loyalty.eligible, true);
    await http.post(`${API}/me/tickets/${take.body.data.ticket.id}/cancel`).set(bearer(token));
  });

  test('الملاحظات والبحث بالاسم والموبايل', async () => {
    const updated = await cashier.patch(`/cards/${cardId}`, { notes: 'درجة 2 على الجناب، ما بيحبش الجِل' });
    assert.equal(updated.status, 200);
    const byPhone = (await cashier.get('/cards', { q: '1111222' })).body;
    assert.equal(byPhone.data[0].id, cardId);
    assert.equal(byPhone.meta.total, 1);
    const card = (await cashier.get(`/cards/${cardId}`)).body.data;
    assert.equal(card.notes, 'درجة 2 على الجناب، ما بيحبش الجِل');
    assert.equal(card.visits_list.length, 2);
    assert.equal(card.visits_list[0].barber_name, 'حسن');
    assert.equal(card.loyalty_events.length, 2);
  });

  test('المكافأة: أغلى خدمة ببلاش، والزيارة دي ما بتاخدش ختم', async () => {
    await owner.patch('/shop/settings', { cashier_enabled: true });
    await cashier.post('/drawer/open', { opening_float: 0 });
    const ticket = await serve(await walkIn({ name: 'كريم', phone: '01011112222' }, [cut.id, beard.id]));
    const bill = (await cashier.post(`/bills/for-ticket/${ticket.id}`)).body.data;
    assert.equal(bill.card.loyalty.eligible, true);

    const paid = await cashier.post(`/bills/${bill.id}/checkout`, { redeem_reward: true, payments: [{ method: 'cash', amount: 5000 }] });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    assert.equal(paid.body.data.reward_discount, 10000);
    assert.equal(paid.body.data.total, 5000);
    assert.equal(paid.body.data.stamp_awarded, false);
    const card = await queryOne('SELECT stamps, rewards_redeemed FROM shop_customers WHERE id = ?', [cardId]);
    assert.deepEqual(card, { stamps: 0, rewards_redeemed: 1 });

    // مفيش أختام كفاية دلوقتي
    const next = await serve(await walkIn({ name: 'كريم', phone: '01011112222' }));
    const nextBill = (await cashier.post(`/bills/for-ticket/${next.id}`)).body.data;
    const refused = await cashier.post(`/bills/${nextBill.id}/checkout`, { redeem_reward: true, payments: [{ method: 'cash', amount: 10000 }] });
    assert.equal(refused.body.code, 'REWARD_NOT_EARNED');
    const normal = await cashier.post(`/bills/${nextBill.id}/checkout`, { payments: [{ method: 'cash', amount: 10000 }] });
    assert.equal(normal.body.data.stamp_awarded, true);
  });

  test('تعديل الأختام يدوي للمدير بسبب، والإعداد: خدمة معيّنة لازم تتحدّد', async () => {
    assert.equal((await cashier.post(`/cards/${cardId}/stamps`, { delta: 1, note: 'ختم ناسي' })).status, 403);
    const adjusted = await manager.post(`/cards/${cardId}/stamps`, { delta: 1, note: 'ختم ناسي' });
    assert.equal(adjusted.body.data.stamps, 2);
    const bad = await owner.patch('/shop/settings', { loyalty_reward_type: 'service' });
    assert.equal(bad.status, 422);
    assert.ok(bad.body.errors.loyalty_reward_service_id);
    const good = await owner.patch('/shop/settings', { loyalty_reward_type: 'service', loyalty_reward_service_id: beard.id });
    assert.equal(good.status, 200);
    const card = (await cashier.get(`/cards/${cardId}`)).body.data;
    assert.equal(card.loyalty.reward, '«دقن» ببلاش');
    await owner.patch('/shop/settings', { loyalty_reward_type: 'percent', loyalty_reward_value: 150 }).then((r) => assert.equal(r.status, 422));
  });
});

describe('صور القصّات', () => {
  let cardId;
  let chair;
  let photoId;

  test('الحلاق يصوّر من الكرسي الزبون اللي لسه خالص، والملف لازم صورة', async () => {
    await owner.patch('/shop/settings', { cashier_enabled: false });
    chair = await pairChair();
    const ticket = await walkIn({ name: 'سامح', phone: '01099990000' });
    await chair.post('/chair/next');
    let view = (await chair.get('/chair/queue')).body.data;
    assert.equal(view.serving.id, ticket.id);
    assert.ok(view.serving.card);
    cardId = view.serving.card.id;
    await chair.post('/chair/finish');
    view = (await chair.get('/chair/queue')).body.data;
    assert.equal(view.recent.id, ticket.id);
    assert.equal(view.recent.has_photo, false);

    const fake = await chair.image(`/chair/photo?ticket_id=${ticket.id}`, Buffer.from('GIF89a-not-allowed-here'));
    assert.equal(fake.status, 422);
    assert.equal(fake.body.code, 'PHOTO_TYPE');

    const uploaded = await chair.image(`/chair/photo?ticket_id=${ticket.id}`, JPEG);
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
    photoId = uploaded.body.data.photo.id;
    assert.equal(uploaded.body.data.view.recent.has_photo, true);

    const wrongTicket = await chair.image('/chair/photo?ticket_id=999999', JPEG);
    assert.equal(wrongTicket.body.code, 'PHOTO_TICKET');
  });

  test('الموظفين يشوفوا الصورة من الكارت، والاستقبال يرفع صورة PNG', async () => {
    const file = await http.get(`${API}/cards/${cardId}/photos/${photoId}`).set(bearer(ctx.token)).buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(file.status, 200);
    assert.equal(file.headers['content-type'], 'image/jpeg');
    assert.ok(file.body.equals(JPEG));

    const png = await cashier.image(`/cards/${cardId}/photos`, PNG, 'image/png');
    assert.equal(png.status, 201);
    const card = (await cashier.get(`/cards/${cardId}`)).body.data;
    assert.equal(card.photos.length, 2);
    assert.equal(card.photos[1].barber_name, 'حسن');
  });

  test('الزبون يشوف صوره هو بس ويقدر يمسحها', async () => {
    const token = await register('01099990000', 'سامح');
    // الكارت بيترَبط بالحساب أوّل ما ياخد دور
    const take = await http.post(`${API}/me/tickets`).set(bearer(token)).send({ shop_slug: 'cards-shop', service_ids: [cut.id] });
    await http.post(`${API}/me/tickets/${take.body.data.ticket.id}/cancel`).set(bearer(token));

    const photos = (await http.get(`${API}/me/photos`).set(bearer(token))).body.data;
    assert.equal(photos.length, 2);
    assert.equal(photos[0].shop_name, 'صالون الكروت');
    const mine = await http.get(`${API}/me/photos/${photoId}`).set(bearer(token));
    assert.equal(mine.status, 200);

    const stranger = await register('01077776666', 'غريب');
    assert.equal((await http.get(`${API}/me/photos/${photoId}`).set(bearer(stranger))).status, 404);

    const history = (await http.get(`${API}/me/tickets`).set(bearer(token))).body.data;
    assert.ok(history.length >= 1);

    assert.equal((await http.delete(`${API}/me/photos/${photoId}`).set(bearer(token))).status, 204);
    assert.equal((await http.get(`${API}/cards/${cardId}/photos/${photoId}`).set(bearer(ctx.token))).status, 404);
  });

  test('فاتورة الدور بتظهر للزبون في «دوري» من غير العمولة', async () => {
    const token = await register('01055554444', 'مازن');
    const take = await http.post(`${API}/me/tickets`).set(bearer(token)).send({ shop_slug: 'cards-shop', service_ids: [cut.id], barber_id: hassan.id });
    await execute('UPDATE queue_tickets SET arrived_at = NOW() WHERE id = ?', [take.body.data.ticket.id]);
    await serve(take.body.data.ticket);
    const view = (await http.get(`${API}/me/tickets/${take.body.data.ticket.id}`).set(bearer(token))).body.data;
    assert.equal(view.ticket.status, 'done');
    assert.equal(view.ticket.bill.total, 10000);
    assert.equal(view.ticket.bill.items[0].name, 'قص');
    assert.equal(view.ticket.bill.items[0].commission, undefined);
    assert.equal(view.ticket.bill.stamp_awarded, true);
  });
});

describe('التذكير «بقالك 3 أسابيع»', () => {
  test('اللي عدّى عليه عدد الأيام بيظهر مرّة واحدة لكل زيارة', async () => {
    assert.equal((await cashier.get('/cards/reminders')).body.data.enabled, false);
    await owner.patch('/shop/settings', { reminder_enabled: true, reminder_days: 21 });
    await execute('UPDATE shop_customers SET last_visit_at = DATE_SUB(NOW(), INTERVAL 25 DAY) WHERE shop_id = ?', [ctx.shopId]);
    const due = (await cashier.get('/cards/reminders')).body.data;
    assert.equal(due.enabled, true);
    assert.ok(due.rows.length >= 2);
    assert.match(due.shop_url, /\/s\/cards-shop$/);
    const first = due.rows[0];
    assert.ok(first.days_since >= 25);

    await cashier.post(`/cards/${first.id}/reminded`);
    const after = (await cashier.get('/cards/reminders')).body.data;
    assert.ok(!after.rows.some((row) => row.id === first.id));

    await cashier.patch(`/cards/${after.rows[0].id}`, { reminders_off: true });
    const off = (await cashier.get('/cards/reminders')).body.data;
    assert.ok(!off.rows.some((row) => row.id === after.rows[0].id));
  });

  test('المهمة الدورية بتبعت إشعار لصاحب التطبيق اللي عنده اشتراك، مرّة واحدة', async () => {
    const { sendReminders } = await import('../src/jobs/reminders.js');
    const card = await queryOne('SELECT id, customer_id FROM shop_customers WHERE shop_id = ? AND customer_id IS NOT NULL AND reminders_off = 0 AND reminded_at IS NULL LIMIT 1', [ctx.shopId]);
    assert.ok(card, 'محتاج كارت مربوط بحساب');
    await execute(
      'INSERT INTO push_subscriptions (customer_id, endpoint, endpoint_hash, p256dh, auth) VALUES (?, ?, SHA2(?, 256), ?, ?)',
      [card.customer_id, 'https://push.example/abc', 'https://push.example/abc', 'p'.repeat(20), 'a'.repeat(20)],
    );
    const sent = await sendReminders({ now: new Date('2026-11-09T12:00:00Z'), force: true });
    assert.ok(sent >= 1);
    const outbox = await query("SELECT payload FROM notification_outbox WHERE template = 'reminder'");
    assert.equal(outbox.length, sent);
    const payload = typeof outbox[0].payload === 'string' ? JSON.parse(outbox[0].payload) : outbox[0].payload;
    assert.match(payload.body, /بقالك/);
    assert.equal(await sendReminders({ now: new Date('2026-11-09T12:00:00Z'), force: true }), 0);
  });
});
