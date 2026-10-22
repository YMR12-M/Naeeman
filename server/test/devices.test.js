import { test, before, after, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execute, queryOne } from '../src/config/db.js';
import { checkinCode } from '../src/queue/checkin.js';
import { displayName } from '../src/modules/devices/display.routes.js';
import { API, bearer, bootstrapOwner, makeApp, resetDatabase, shutdown, staffToken } from './helpers.js';

const { http } = makeApp();
let ctx;
let cut;
let beard;
let hassan;
let mahmoud;

const staffPost = (path, body = {}) => http.post(`${API}${path}`).set(bearer(ctx.token)).send(body);
const device = (token) => ({
  get: (path) => http.get(`${API}${path}`).set('X-Device-Token', token),
  post: (path, body = {}) => http.post(`${API}${path}`).set('X-Device-Token', token).send(body),
});

async function pairDevice(type, name) {
  const code = (await staffPost('/devices/pairing-code', { type, name })).body.data.code;
  const paired = await http.post(`${API}/devices/pair`).send({ code });
  assert.equal(paired.status, 201, JSON.stringify(paired.body));
  return paired.body.data.token;
}

async function clearQueue() {
  await execute("UPDATE queue_tickets SET status = 'cancelled' WHERE status IN ('waiting','serving')");
  await execute("UPDATE barbers SET status = 'available', break_until = NULL, failed_pins = 0, pin_locked_until = NULL WHERE archived_at IS NULL");
  await execute('UPDATE devices SET current_barber_id = NULL');
}

before(async () => {
  await resetDatabase();
  ctx = await bootstrapOwner(http, { shop: { name: 'صالون الأمل', slug: 'elamal' } });
  await http.put(`${API}/shop/hours`).set(bearer(ctx.token))
    .send({ periods: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens_at: '00:00', closes_at: '00:00' })) });
  [cut, beard] = (await staffPost('/services/bulk', {
    items: [{ name: 'قص', price: 9000, default_minutes: 25 }, { name: 'دقن', price: 4000, default_minutes: 15 }],
  })).body.data;
  hassan = (await staffPost('/barbers', { name: 'حسن', chair_no: 1, pin: '4821' })).body.data;
  mahmoud = (await staffPost('/barbers', { name: 'محمود', chair_no: 2, pin: '1357' })).body.data;
  for (const barber of [hassan, mahmoud]) await staffPost(`/barbers/${barber.id}/status`, { status: 'available' });
});
after(shutdown);

describe('ربط الأجهزة', () => {
  test('المالك بس يطلّع كود، والكود يتستعمل مرّة واحدة', async () => {
    const manager = await staffToken(http, ctx.shopId, 'manager');
    assert.equal((await http.post(`${API}/devices/pairing-code`).set(bearer(manager)).send({ type: 'display' })).status, 403);

    const pairing = await staffPost('/devices/pairing-code', { type: 'display', name: 'تلفزيون الصالة' });
    assert.equal(pairing.status, 201);
    assert.match(pairing.body.data.code, /^\d{6}$/);

    const paired = await http.post(`${API}/devices/pair`).send({ code: pairing.body.data.code });
    assert.equal(paired.status, 201);
    assert.ok(paired.body.data.token.length > 40);
    assert.equal(paired.body.data.device.type, 'display');
    assert.equal(paired.body.data.device.shop.name, 'صالون الأمل');

    const reused = await http.post(`${API}/devices/pair`).send({ code: pairing.body.data.code });
    assert.equal(reused.status, 404);
    assert.equal(reused.body.code, 'PAIRING_INVALID');
  });

  test('الكود اللي عدّى 10 دقايق مرفوض', async () => {
    const { code } = (await staffPost('/devices/pairing-code', { type: 'kiosk' })).body.data;
    await execute('UPDATE device_pairings SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE used_at IS NULL');
    assert.equal((await http.post(`${API}/devices/pair`).send({ code })).status, 404);
  });

  test('كل جهاز ليه شغلانة واحدة، والملغي مرفوض فورًا', async () => {
    const token = await pairDevice('display');
    assert.equal((await device(token).get('/display/queue')).status, 200);
    const wrong = await device(token).get('/kiosk/options');
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.code, 'WRONG_DEVICE_TYPE');

    const list = (await http.get(`${API}/devices`).set(bearer(ctx.token))).body.data;
    const mine = list.at(-1);
    assert.ok(mine.last_seen_at);
    assert.equal((await http.delete(`${API}/devices/${mine.id}`).set(bearer(ctx.token))).status, 204);
    const revoked = await device(token).get('/display/queue');
    assert.equal(revoked.status, 401);
    assert.equal(revoked.body.code, 'DEVICE_REVOKED');
  });

  test('من غير توكن أو بتوكن عشوائي', async () => {
    assert.equal((await http.get(`${API}/display/queue`)).status, 401);
    assert.equal((await device('x'.repeat(64)).get('/display/queue')).status, 401);
  });
});

describe('شاشة التلفزيون', () => {
  let display;
  before(async () => { display = await pairDevice('display'); });
  beforeEach(clearQueue);

  test('اللي على كل كرسي والجايين، بالاسم الأوّل وحرف، من غير موبايلات', async () => {
    await staffPost('/queue/tickets', { name: 'كريم عادل', phone: '01022223333', service_ids: [cut.id] });
    await staffPost('/queue/tickets', { name: 'أحمد محمود', service_ids: [cut.id] });
    await staffPost('/queue/tickets', { name: 'عمر', service_ids: [cut.id] });
    await staffPost(`/queue/barbers/${hassan.id}/next`);

    const view = (await device(display).get('/display/queue')).body.data;
    assert.equal(view.shop.name, 'صالون الأمل');
    const onChair = view.barbers.find((b) => b.id === hassan.id).serving;
    assert.equal(onChair.name, 'كريم ع.');
    assert.ok(Number.isInteger(onChair.number));
    assert.deepEqual(view.next.map((t) => t.name), ['أحمد م.', 'عمر']);
    assert.equal(JSON.stringify(view).includes('2222'), false);
  });

  test('الكود المتغيّر هو نفسه اللي الزبون بيمسحه', async () => {
    const view = (await device(display).get('/display/queue')).body.data;
    const { checkin_secret: secret } = await queryOne('SELECT checkin_secret FROM shops WHERE id = ?', [ctx.shopId]);
    assert.equal(view.checkin.code, checkinCode(secret, ctx.shopId));
    assert.match(view.checkin.url, /\/checkin\/elamal\?code=\d{6}$/);
    assert.ok(new Date(view.checkin.expires_at) > new Date());
    assert.match(view.take_url, /\/s\/elamal$/);
  });

  test('المحل عايز الرقم بس', async () => {
    await http.patch(`${API}/shop/settings`).set(bearer(ctx.token)).send({ display_name_style: 'number_only' });
    await staffPost('/queue/tickets', { name: 'كريم عادل', service_ids: [cut.id] });
    const view = (await device(display).get('/display/queue')).body.data;
    assert.equal(view.next[0].name, null);
    assert.equal(JSON.stringify(view).includes('كريم'), false);
    await http.patch(`${API}/shop/settings`).set(bearer(ctx.token)).send({ display_name_style: 'first_initial' });
  });

  test('الحلاق «مش موجود» ما بيظهرش', async () => {
    await staffPost(`/barbers/${mahmoud.id}/status`, { status: 'off' });
    const view = (await device(display).get('/display/queue')).body.data;
    assert.deepEqual(view.barbers.map((b) => b.name), ['حسن']);
  });
});

test('الأسماء على التلفزيون', () => {
  assert.equal(displayName('أحمد محمود علي', 'first_initial'), 'أحمد م.');
  assert.equal(displayName('عمر', 'first_initial'), 'عمر');
  assert.equal(displayName('أحمد محمود', 'number_only'), null);
});

describe('تابلت الباب', () => {
  let kiosk;
  before(async () => { kiosk = await pairDevice('kiosk', 'الباب'); });
  beforeEach(clearQueue);

  test('القايمة والحلاقين، وأخد دور واصل', async () => {
    const options = (await device(kiosk).get('/kiosk/options')).body.data;
    assert.deepEqual(options.services.map((s) => s.name), ['قص', 'دقن']);
    const response = await device(kiosk).post('/kiosk/tickets', { service_ids: [cut.id, beard.id], name: 'زبون الباب' });
    assert.equal(response.status, 201);
    assert.equal(response.body.data.total, 13000);
    assert.equal(response.body.data.ahead, 0);
    const row = await queryOne('SELECT source, arrived_at FROM queue_tickets WHERE id = ?', [response.body.data.id]);
    assert.equal(row.source, 'kiosk');
    assert.ok(row.arrived_at);
  });

  test('المحل موقّف الأدوار: الكشك ما ياخدش', async () => {
    await http.patch(`${API}/shop`).set(bearer(ctx.token)).send({ accepting_tickets: false });
    const response = await device(kiosk).post('/kiosk/tickets', { service_ids: [cut.id] });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'QUEUE_PAUSED');
    await http.patch(`${API}/shop`).set(bearer(ctx.token)).send({ accepting_tickets: true });
  });

  test('الإلغاء: دوره هو بس، وخلال دقيقة', async () => {
    const mine = (await device(kiosk).post('/kiosk/tickets', { service_ids: [cut.id] })).body.data;
    assert.equal((await device(kiosk).post(`/kiosk/tickets/${mine.id}/cancel`)).status, 200);

    const late = (await device(kiosk).post('/kiosk/tickets', { service_ids: [cut.id] })).body.data;
    await execute('UPDATE queue_tickets SET created_at = DATE_SUB(NOW(), INTERVAL 2 MINUTE) WHERE id = ?', [late.id]);
    const tooLate = await device(kiosk).post(`/kiosk/tickets/${late.id}/cancel`);
    assert.equal(tooLate.status, 403);
    assert.equal(tooLate.body.code, 'KIOSK_CANCEL_WINDOW');

    const fromStaff = (await staffPost('/queue/tickets', { service_ids: [cut.id] })).body.data;
    assert.equal((await device(kiosk).post(`/kiosk/tickets/${fromStaff.id}/cancel`)).status, 404);
  });
});

describe('تابلت الكرسي', () => {
  let chairA;
  let chairB;
  before(async () => {
    chairA = await pairDevice('chair', 'كرسي 1');
    chairB = await pairDevice('chair', 'كرسي 2');
  });
  beforeEach(clearQueue);

  test('من غير ما الحلاق يدخل: مفيش «التالي»', async () => {
    const response = await device(chairA).post('/chair/next');
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'CHAIR_SIGNED_OUT');
    const barbers = (await device(chairA).get('/chair/barbers')).body.data.barbers;
    assert.deepEqual(barbers.map((b) => [b.name, b.has_pin]), [['حسن', true], ['محمود', true]]);
  });

  test('PIN غلط 5 مرّات يقفل الحلاق، والمالك يفكّه بـ PIN جديد', async () => {
    for (let i = 0; i < 4; i += 1) {
      const wrong = await device(chairA).post('/chair/login', { barber_id: hassan.id, pin: '0000' });
      assert.equal(wrong.status, 401);
      assert.equal(wrong.body.code, 'BAD_PIN');
    }
    await device(chairA).post('/chair/login', { barber_id: hassan.id, pin: '0000' });
    const locked = await device(chairA).post('/chair/login', { barber_id: hassan.id, pin: '4821' });
    assert.equal(locked.status, 423);
    assert.equal(locked.body.code, 'PIN_LOCKED');

    await http.put(`${API}/barbers/${hassan.id}/pin`).set(bearer(ctx.token)).send({ pin: '4821' });
    assert.equal((await device(chairA).post('/chair/login', { barber_id: hassan.id, pin: '4821' })).status, 200);
  });

  test('الوردية: دخول ← التالي ← + خدمة ← خلّصت ← استراحة ← رجعت', async () => {
    await execute("UPDATE barbers SET status = 'off' WHERE id = ?", [hassan.id]);
    const login = await device(chairA).post('/chair/login', { barber_id: hassan.id, pin: '4821' });
    assert.equal(login.status, 200);
    assert.equal(login.body.data.barber.status, 'available', 'أوّل الوردية بيبقى متاح');

    const ticket = (await staffPost('/queue/tickets', { name: 'زبون الكرسي', service_ids: [cut.id] })).body.data;
    const forMahmoud = (await staffPost('/queue/tickets', { service_ids: [cut.id], barber_id: mahmoud.id })).body.data;
    const before = (await device(chairA).get('/chair/queue')).body.data;
    assert.deepEqual(before.next.map((t) => t.id), [ticket.id], 'اللي طالب محمود مش في طابور حسن');
    assert.equal(before.waiting_for_me, 1);
    assert.ok(forMahmoud.id);

    const next = await device(chairA).post('/chair/next');
    assert.equal(next.body.data.started_id, ticket.id);
    assert.equal(next.body.data.view.serving.name, 'زبون الكرسي');
    assert.equal(next.body.data.view.serving.expected_minutes, 25);

    const added = await device(chairA).post('/chair/services', { service_id: beard.id });
    assert.deepEqual(added.body.data.serving.services, ['قص', 'دقن']);

    const busyBreak = await device(chairA).post('/chair/status', { status: 'break' });
    assert.equal(busyBreak.status, 409);
    assert.equal(busyBreak.body.code, 'FINISH_FIRST');

    assert.equal((await device(chairA).post('/chair/finish')).status, 200);
    const onBreak = await device(chairA).post('/chair/status', { status: 'break', break_minutes: 10 });
    assert.equal(onBreak.body.data.barber.status, 'break');
    assert.equal((await device(chairA).post('/chair/status', { status: 'available' })).body.data.barber.status, 'available');

    const event = await queryOne("SELECT actor_type FROM ticket_events WHERE ticket_id = ? AND type = 'started'", [ticket.id]);
    assert.equal(event.actor_type, 'chair');
  });

  test('الحلاق على تابلت واحد: لو دخل من تاني، الأوّل يخرج', async () => {
    await device(chairA).post('/chair/login', { barber_id: mahmoud.id, pin: '1357' });
    await device(chairB).post('/chair/login', { barber_id: mahmoud.id, pin: '1357' });
    assert.equal((await device(chairA).get('/chair/queue')).body.code, 'CHAIR_SIGNED_OUT');
    assert.equal((await device(chairB).get('/chair/queue')).status, 200);
    await device(chairB).post('/chair/logout');
    assert.equal((await device(chairB).get('/chair/queue')).status, 409);
  });

  test('«التالي» مرّتين بنفس المفتاح من التابلت: مرّة واحدة', async () => {
    await device(chairA).post('/chair/login', { barber_id: hassan.id, pin: '4821' });
    const first = (await staffPost('/queue/tickets', { service_ids: [cut.id] })).body.data;
    const second = (await staffPost('/queue/tickets', { service_ids: [cut.id] })).body.data;
    const key = 'chair-next-0001-abcd';
    const a = await http.post(`${API}/chair/next`).set('X-Device-Token', chairA).set('Idempotency-Key', key).send({});
    const b = await http.post(`${API}/chair/next`).set('X-Device-Token', chairA).set('Idempotency-Key', key).send({});
    assert.equal(a.body.data.started_id, first.id);
    assert.equal(b.headers['idempotent-replay'], 'true');
    assert.equal((await queryOne('SELECT status FROM queue_tickets WHERE id = ?', [second.id])).status, 'waiting');
  });
});
