import { test, before, after, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execute, query, queryOne } from '../src/config/db.js';
import { queueService } from '../src/modules/queue/queue.service.js';
import {
  API, bearer, bootstrapOwner, makeApp, resetDatabase, shutdown, staffToken,
} from './helpers.js';

const { app, http } = makeApp();
let ctx;
let cut;
let beard;
let hassan;
let mahmoud;
let customerSeq = 0;

const post = (path, body = {}, token = ctx.token, headers = {}) =>
  http.post(`${API}${path}`).set(bearer(token)).set(headers).send(body);
const view = async () => (await http.get(`${API}/queue`).set(bearer(ctx.token))).body.data;

async function walkIn(body = {}) {
  const response = await post('/queue/tickets', { service_ids: [cut.id], ...body });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data;
}

async function next(barberId, token = ctx.token) {
  const response = await post(`/queue/barbers/${barberId}/next`, {}, token);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.data;
}

async function makeCustomer(name = 'زبون التطبيق') {
  customerSeq += 1;
  const result = await execute(
    'INSERT INTO customers (uuid, phone, name, password_hash) VALUES (?, ?, ?, ?)',
    [crypto.randomUUID(), `+20100000${String(customerSeq).padStart(4, '0')}`, name, 'x'],
  );
  return result.insertId;
}

const appTicket = (customerId, extra = {}) => queueService.create(ctx.shopId, {
  source: 'app', customer_id: customerId, name: 'زبون التطبيق', service_ids: [cut.id], ...extra,
}, { type: 'customer', id: customerId });

const pushesFor = async (customerId) => (await query(
  "SELECT payload FROM notification_outbox WHERE channel = 'push' AND to_address = ? ORDER BY id",
  [String(customerId)],
)).map((row) => (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload));

const ticketRow = (id) => queryOne('SELECT * FROM queue_tickets WHERE id = ?', [id]);

/** يفضّي الطابور بين المجموعات */
async function clearQueue() {
  await execute("UPDATE queue_tickets SET status = 'cancelled' WHERE status IN ('waiting','serving')");
  await execute("UPDATE barbers SET status = 'available', break_until = NULL WHERE archived_at IS NULL");
}

before(async () => {
  await resetDatabase();
  ctx = await bootstrapOwner(http);
  // فاتح 24 ساعة كل يوم عشان الاختبارات ما تعتمدش على الساعة
  await http.put(`${API}/shop/hours`).set(bearer(ctx.token))
    .send({ periods: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens_at: '00:00', closes_at: '00:00' })) });
  [cut, beard] = (await post('/services/bulk', {
    items: [{ name: 'قص', price: 9000, default_minutes: 25 }, { name: 'دقن', price: 4000, default_minutes: 15 }],
  })).body.data;
  hassan = (await post('/barbers', { name: 'حسن', chair_no: 1 })).body.data;
  mahmoud = (await post('/barbers', { name: 'محمود', chair_no: 2 })).body.data;
  for (const barber of [hassan, mahmoud]) await post(`/barbers/${barber.id}/status`, { status: 'available' });
});
after(shutdown);

describe('زبون من الشارع و«التالي»', () => {
  beforeEach(clearQueue);

  test('الدور بيتسجّل واصل، بنمرة يومية، وبالوقت المتوقّع', async () => {
    const first = await walkIn({ name: 'كريم' });
    const second = await walkIn({ name: 'أحمد', service_ids: [cut.id, beard.id] });
    assert.ok(first.number >= 1);
    assert.equal(second.number, first.number + 1);
    assert.equal(first.arrived, true);
    assert.equal(second.total, 13000);
    assert.deepEqual(second.services.map((service) => service.name), ['قص', 'دقن']);

    const queue = await view();
    assert.deepEqual(queue.waiting.map((t) => t.name), ['كريم', 'أحمد']);
    // حلاقين فاضيين: الاتنين يبدأوا دلوقتي
    assert.deepEqual(queue.waiting.map((t) => t.ahead), [0, 0]);
  });

  test('من غير اسم: «زبون»، ومن غير خدمة: مرفوض', async () => {
    assert.equal((await walkIn()).name, 'زبون');
    const empty = await post('/queue/tickets', { service_ids: [] });
    assert.equal(empty.status, 422);
    const archived = await post('/services', { name: 'مؤقتة', price: 100, default_minutes: 5 });
    await http.delete(`${API}/services/${archived.body.data.id}`).set(bearer(ctx.token));
    const stale = await post('/queue/tickets', { service_ids: [archived.body.data.id] });
    assert.equal(stale.status, 422);
    assert.equal(stale.body.code, 'BAD_SERVICE');
  });

  test('«التالي» بيقعّد الأوّل، والتانية بتقفله وتقعّد اللي بعده', async () => {
    const a = await walkIn({ name: 'أ' });
    const b = await walkIn({ name: 'ب' });
    const first = await next(hassan.id);
    assert.equal(first.started_id, a.id);
    assert.equal(first.finished_id, null);

    const second = await next(hassan.id);
    assert.equal(second.finished_id, a.id);
    assert.equal(second.started_id, b.id);
    assert.equal((await ticketRow(a.id)).status, 'done');

    const queue = await view();
    assert.equal(queue.barbers.find((barber) => barber.id === hassan.id).serving.id, b.id);
    assert.equal(queue.waiting.length, 0);
  });

  test('اللي طالب حلاق معيّن ما يروحش لغيره', async () => {
    const forMahmoud = await walkIn({ name: 'لمحمود', barber_id: mahmoud.id });
    const anyone = await walkIn({ name: 'أي حد' });
    const result = await next(hassan.id);
    assert.equal(result.started_id, anyone.id);
    assert.equal((await ticketRow(forMahmoud.id)).status, 'waiting');
    assert.equal((await next(mahmoud.id)).started_id, forMahmoud.id);
  });

  test('«خلّصت» من غير ما ينادي حد', async () => {
    await walkIn();
    await walkIn();
    await next(hassan.id);
    const done = await post(`/queue/barbers/${hassan.id}/finish`);
    assert.equal(done.status, 200);
    assert.equal((await view()).waiting.length, 1);
    const nothing = await post(`/queue/barbers/${hassan.id}/finish`);
    assert.equal(nothing.status, 409);
    assert.equal(nothing.body.code, 'NOTHING_SERVING');
  });

  test('«التالي» بيرجّع الحلاق متاح لو كان في استراحة', async () => {
    await post(`/barbers/${hassan.id}/status`, { status: 'break', break_minutes: 30 });
    await walkIn();
    await next(hassan.id);
    assert.equal((await queryOne('SELECT status FROM barbers WHERE id = ?', [hassan.id])).status, 'available');
  });
});

describe('تعلّم مدّة الحلاق', () => {
  beforeEach(clearQueue);

  test('خدمة واحدة خلصت في 20 دقيقة: المتوسّط يقرّب ناحيتها', async () => {
    await execute('DELETE FROM barber_service_stats');
    const ticket = await walkIn();
    await next(hassan.id);
    await execute('UPDATE queue_tickets SET started_at = DATE_SUB(NOW(), INTERVAL 20 MINUTE) WHERE id = ?', [ticket.id]);
    await next(hassan.id);
    const stat = await queryOne('SELECT avg_minutes, samples FROM barber_service_stats WHERE barber_id = ? AND service_id = ?', [hassan.id, cut.id]);
    assert.equal(Number(stat.avg_minutes), 24);
    assert.equal(stat.samples, 1);
  });

  test('خدمتين في دور واحد، أو مدّة شاذّة: ما بيتعلّمش', async () => {
    await execute('DELETE FROM barber_service_stats');
    await walkIn({ service_ids: [cut.id, beard.id] });
    await next(hassan.id);
    await next(hassan.id);
    const quick = await walkIn();
    await next(hassan.id);
    await execute('UPDATE queue_tickets SET started_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?', [quick.id]);
    await next(hassan.id);
    assert.equal((await query('SELECT * FROM barber_service_stats')).length, 0);
  });
});

describe('اللي اتنادى وما وصلش', () => {
  beforeEach(clearQueue);

  test('بيتنادى ومكانه محفوظ، وبعد المهلة يتأخّر خطوتين، والتانية ما جاش', async () => {
    const customer = await makeCustomer();
    const remote = await appTicket(customer);
    const w1 = await walkIn({ name: 'و1' });
    const w2 = await walkIn({ name: 'و2' });
    const w3 = await walkIn({ name: 'و3' });

    const result = await next(hassan.id);
    assert.deepEqual(result.called_ids, [remote.id]);
    assert.equal(result.started_id, w1.id);
    assert.ok((await ticketRow(remote.id)).called_at);
    assert.ok((await pushesFor(customer)).some((push) => push.title === 'دورك جه'));
    assert.equal((await view()).waiting[0].id, remote.id, 'مكانه محفوظ في أول الطابور');

    // المهلة خلصت (10 دقايق افتراضي)
    await execute('UPDATE queue_tickets SET called_at = DATE_SUB(NOW(), INTERVAL 11 MINUTE) WHERE id = ?', [remote.id]);
    assert.equal(await queueService.sweep(ctx.shopId), true);
    const delayed = await ticketRow(remote.id);
    assert.equal(delayed.auto_delayed, 1);
    assert.equal(delayed.called_at, null);
    assert.deepEqual((await view()).waiting.map((t) => t.id), [w2.id, w3.id, remote.id]);
    assert.ok((await pushesFor(customer)).some((push) => push.title === 'اتأخّرت خطوتين'));

    // اتنادى تاني وما جاش تاني
    await next(mahmoud.id);
    await next(mahmoud.id);
    await next(hassan.id);
    assert.ok((await ticketRow(remote.id)).called_at);
    await execute('UPDATE queue_tickets SET called_at = DATE_SUB(NOW(), INTERVAL 11 MINUTE) WHERE id = ?', [remote.id]);
    await queueService.sweep(ctx.shopId);
    assert.equal((await ticketRow(remote.id)).status, 'no_show');
  });

  test('وصل: الاستقبال يعلّمه، والحلاق الجاي ياخده', async () => {
    const customer = await makeCustomer();
    const remote = await appTicket(customer);
    await next(hassan.id);
    assert.equal((await post(`/queue/tickets/${remote.id}/arrive`)).status, 200);
    assert.equal((await next(mahmoud.id)).started_id, remote.id);
  });

  test('مفيش حد وراه: ما بيتأخّرش (مش معطّل حد)', async () => {
    const customer = await makeCustomer();
    const remote = await appTicket(customer);
    await next(hassan.id);
    await execute('UPDATE queue_tickets SET called_at = DATE_SUB(NOW(), INTERVAL 11 MINUTE) WHERE id = ?', [remote.id]);
    assert.equal(await queueService.sweep(ctx.shopId), false);
    assert.equal((await ticketRow(remote.id)).status, 'waiting');
  });
});

describe('«أخّرني»', () => {
  beforeEach(clearQueue);

  test('خطوتين لورا، وليه حدّ، ومينفعش لو آخر واحد', async () => {
    const customer = await makeCustomer();
    const mine = await appTicket(customer);
    const others = [await walkIn(), await walkIn(), await walkIn()];
    const actor = { type: 'customer', id: customer };

    assert.deepEqual(await queueService.delay(ctx.shopId, mine.id, actor), { delays_left: 1 });
    assert.deepEqual((await view()).waiting.map((t) => t.id), [others[0].id, others[1].id, mine.id, others[2].id]);

    await queueService.delay(ctx.shopId, mine.id, actor);
    assert.equal((await view()).waiting.at(-1).id, mine.id);

    await assert.rejects(queueService.delay(ctx.shopId, mine.id, actor), { code: 'NO_DELAYS_LEFT' });
    await execute('UPDATE queue_tickets SET delays_used = 0 WHERE id = ?', [mine.id]);
    await assert.rejects(queueService.delay(ctx.shopId, mine.id, actor), { code: 'NOTHING_BEHIND' });
  });
});

describe('تحريك وإلغاء وتغيير حلاق', () => {
  beforeEach(clearQueue);

  test('التحريك محتاج سبب وصلاحية المدير، وبيتسجّل', async () => {
    const a = await walkIn();
    const b = await walkIn();
    const c = await walkIn();
    const noReason = await post(`/queue/tickets/${c.id}/move`, { after_ticket_id: null });
    assert.equal(noReason.status, 422);

    const moved = await post(`/queue/tickets/${c.id}/move`, { after_ticket_id: null, reason: 'راجل كبير' });
    assert.equal(moved.status, 200);
    assert.deepEqual((await view()).waiting.map((t) => t.id), [c.id, a.id, b.id]);
    assert.ok(await queryOne("SELECT id FROM audit_logs WHERE action = 'queue.move'"));

    await post(`/queue/tickets/${c.id}/move`, { after_ticket_id: a.id, reason: 'رجوع' });
    assert.deepEqual((await view()).waiting.map((t) => t.id), [a.id, c.id, b.id]);

    const cashier = await staffToken(http, ctx.shopId, 'cashier');
    assert.equal((await post(`/queue/tickets/${a.id}/move`, { after_ticket_id: b.id, reason: 'x y' }, cashier)).status, 403);
  });

  test('إلغاء اللي على الكرسي محتاج سبب، والزبون يوصله إشعار', async () => {
    const customer = await makeCustomer();
    const remote = await appTicket(customer);
    await post(`/queue/tickets/${remote.id}/arrive`);
    await next(hassan.id);
    const noReason = await post(`/queue/tickets/${remote.id}/cancel`);
    assert.equal(noReason.status, 422);
    assert.equal((await post(`/queue/tickets/${remote.id}/cancel`, { reason: 'الماكينة باظت' })).status, 200);
    assert.equal((await ticketRow(remote.id)).status, 'cancelled');
    assert.ok((await pushesFor(customer)).some((push) => push.body.includes('الماكينة باظت')));
  });

  test('ما جاش، وتغيير الحلاق، وزيادة خدمة', async () => {
    const ticket = await walkIn();
    assert.equal((await post(`/queue/tickets/${ticket.id}/assign`, { barber_id: mahmoud.id })).status, 200);
    assert.equal((await view()).waiting[0].preferred_barber_id, mahmoud.id);
    assert.equal((await post(`/queue/tickets/${ticket.id}/services`, { service_id: beard.id })).status, 200);
    assert.equal(Number((await ticketRow(ticket.id)).total), 13000);
    assert.equal((await post(`/queue/tickets/${ticket.id}/no-show`)).status, 200);
    const again = await post(`/queue/tickets/${ticket.id}/no-show`);
    assert.equal(again.status, 404);
    assert.equal(again.body.code, 'TICKET_NOT_ACTIVE');
  });
});

describe('قواعد أخد الدور من التطبيق', () => {
  beforeEach(clearQueue);
  const setRule = (body) => http.patch(`${API}/shop/settings`).set(bearer(ctx.token)).send(body);

  test('المحل موقّف الأدوار، أو قافل', async () => {
    const customer = await makeCustomer();
    await http.patch(`${API}/shop`).set(bearer(ctx.token)).send({ accepting_tickets: false });
    await assert.rejects(appTicket(customer), { code: 'QUEUE_PAUSED' });
    // الاستقبال بيضيف عادي
    await walkIn();
    await http.patch(`${API}/shop`).set(bearer(ctx.token)).send({ accepting_tickets: true });

    const saved = await query('SELECT weekday, opens_at, closes_at FROM shop_hours WHERE shop_id = ?', [ctx.shopId]);
    await execute('DELETE FROM shop_hours WHERE shop_id = ?', [ctx.shopId]);
    await assert.rejects(appTicket(customer), { code: 'SHOP_CLOSED' });
    for (const row of saved) {
      await execute('INSERT INTO shop_hours (shop_id, weekday, opens_at, closes_at) VALUES (?, ?, ?, ?)', [ctx.shopId, row.weekday, row.opens_at, row.closes_at]);
    }
  });

  test('الأدوار عن بُعد مقفولة', async () => {
    await setRule({ remote_tickets_enabled: false });
    await assert.rejects(appTicket(await makeCustomer()), { code: 'REMOTE_DISABLED' });
    await setRule({ remote_tickets_enabled: true });
  });

  test('دور واحد شغّال لكل زبون', async () => {
    const customer = await makeCustomer();
    await appTicket(customer);
    await assert.rejects(appTicket(customer), { code: 'ACTIVE_TICKET_EXISTS' });
  });

  test('حدّ أدوار اليوم', async () => {
    const { n } = await queryOne('SELECT COUNT(*) AS n FROM queue_tickets WHERE shop_id = ?', [ctx.shopId]);
    await setRule({ max_tickets_per_day: Math.max(1, n) });
    await assert.rejects(appTicket(await makeCustomer()), { code: 'DAY_FULL' });
    await setRule({ max_tickets_per_day: null });
  });

  test('مفيش حلاقين شغّالين، أو الحلاق المطلوب مش موجود', async () => {
    await execute("UPDATE barbers SET status = 'off'");
    await assert.rejects(appTicket(await makeCustomer()), { code: 'NO_BARBERS' });
    await execute("UPDATE barbers SET status = 'available'");
    await execute("UPDATE barbers SET status = 'off' WHERE id = ?", [mahmoud.id]);
    await assert.rejects(appTicket(await makeCustomer(), { barber_id: mahmoud.id }), { code: 'BARBER_OFF' });
    await execute("UPDATE barbers SET status = 'available'");
  });

  test('الطابور أطول من الوقت الفاضل قبل القفل', async () => {
    // المحل يقفل بعد 30 دقيقة، وقبل القفل بـ 15 دقيقة بيبطّل يقبل
    const saved = await query('SELECT weekday, opens_at, closes_at FROM shop_hours WHERE shop_id = ?', [ctx.shopId]);
    const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
    const parts = (date) => Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
    const nowParts = parts(new Date());
    const closeParts = parts(new Date(Date.now() + 30 * 60_000));
    if (closeParts.hour < nowParts.hour) return; // قريب من نص الليل: الاختبار ده ما ينفعش دلوقتي
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(nowParts.weekday);
    await execute('DELETE FROM shop_hours WHERE shop_id = ?', [ctx.shopId]);
    await execute('INSERT INTO shop_hours (shop_id, weekday, opens_at, closes_at) VALUES (?, ?, ?, ?)',
      [ctx.shopId, weekday, '00:00', `${closeParts.hour}:${closeParts.minute}`]);

    for (let i = 0; i < 2; i += 1) await walkIn();
    await assert.rejects(appTicket(await makeCustomer()), { code: 'TOO_LATE' });

    await execute('DELETE FROM shop_hours WHERE shop_id = ?', [ctx.shopId]);
    for (const row of saved) {
      await execute('INSERT INTO shop_hours (shop_id, weekday, opens_at, closes_at) VALUES (?, ?, ?, ?)', [ctx.shopId, row.weekday, row.opens_at, row.closes_at]);
    }
  });

  test('زبون غاب مرّتين: لازم يأكّد لما يقرّب، وإلا الدور يتلغي', async () => {
    const customer = await makeCustomer('بيغيب');
    for (let i = 0; i < 2; i += 1) {
      const ticket = await appTicket(customer);
      await execute("UPDATE queue_tickets SET status = 'no_show' WHERE id = ?", [ticket.id]);
    }
    const fillers = [await walkIn(), await walkIn(), await walkIn(), await walkIn(), await walkIn()];
    const ticket = await appTicket(customer);
    assert.equal((await ticketRow(ticket.id)).trust_confirm_required, 1);
    // نخلّي الدور «قديم» عشان ما يتحسبش إنه لسه واخده
    await execute('UPDATE queue_tickets SET created_at = DATE_SUB(NOW(), INTERVAL 30 MINUTE) WHERE id = ?', [ticket.id]);

    await next(hassan.id);
    await next(mahmoud.id);
    await next(hassan.id);
    const row = await ticketRow(ticket.id);
    assert.ok(row.near_notified_at, 'اتبعت له «قرّب دورك»');
    assert.equal(row.confirmed_at, null);
    assert.ok((await pushesFor(customer)).some((push) => push.title === 'قرّب دورك' && push.body.includes('دوس «جاي»')));

    await execute('UPDATE queue_tickets SET near_notified_at = DATE_SUB(NOW(), INTERVAL 11 MINUTE) WHERE id = ?', [ticket.id]);
    await queueService.sweep(ctx.shopId);
    const cancelled = await ticketRow(ticket.id);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.end_reason, 'not_confirmed');
    assert.ok(fillers.length);
  });

  test('اللي أكّد «جاي» ما يتلغيش', async () => {
    const customer = await makeCustomer();
    const ticket = await appTicket(customer);
    await execute('UPDATE queue_tickets SET trust_confirm_required = 1, confirmed_at = NULL, near_notified_at = DATE_SUB(NOW(), INTERVAL 5 MINUTE) WHERE id = ?', [ticket.id]);
    await queueService.confirmComing(ctx.shopId, ticket.id, { type: 'customer', id: customer });
    await execute('UPDATE queue_tickets SET near_notified_at = DATE_SUB(NOW(), INTERVAL 11 MINUTE) WHERE id = ?', [ticket.id]);
    await queueService.sweep(ctx.shopId);
    assert.equal((await ticketRow(ticket.id)).status, 'waiting');
  });
});

describe('يوم الشغل خلص', () => {
  beforeEach(clearQueue);

  test('أدوار امبارح اللي لسه مستنية بتتلغي، واللي على الكرسي بيخلص', async () => {
    const waiting = await walkIn();
    const serving = await walkIn();
    await post(`/queue/tickets/${serving.id}/move`, { after_ticket_id: null, reason: 'ترتيب' });
    await next(hassan.id);
    await execute('UPDATE queue_tickets SET business_date = DATE_SUB(business_date, INTERVAL 1 DAY) WHERE id IN (?, ?)', [waiting.id, serving.id]);
    await queueService.sweep(ctx.shopId);
    assert.equal((await ticketRow(waiting.id)).status, 'cancelled');
    assert.equal((await ticketRow(waiting.id)).end_reason, 'day_closed');
    assert.equal((await ticketRow(serving.id)).status, 'done');
  });
});

describe('«قرّب دورك»', () => {
  beforeEach(clearQueue);

  test('بيتبعت مرّة واحدة لما يفضل قدّامه 2', async () => {
    await execute("UPDATE barbers SET status = 'off' WHERE id = ?", [mahmoud.id]);
    for (let i = 0; i < 4; i += 1) await walkIn();
    const customer = await makeCustomer();
    const ticket = await appTicket(customer);
    await execute('UPDATE queue_tickets SET created_at = DATE_SUB(NOW(), INTERVAL 30 MINUTE) WHERE id = ?', [ticket.id]);

    await next(hassan.id); // قدّامه 3
    assert.equal((await pushesFor(customer)).filter((push) => push.title === 'قرّب دورك').length, 0);
    await next(hassan.id); // قدّامه 2
    await next(hassan.id); // قدّامه 1
    const near = (await pushesFor(customer)).filter((push) => push.title === 'قرّب دورك');
    assert.equal(near.length, 1);
    assert.match(near[0].body, /قدّامك 2/);
    await execute("UPDATE barbers SET status = 'available'");
  });

  test('الدور اللي خلص: «نعيمًا»', async () => {
    const customer = await makeCustomer();
    const ticket = await appTicket(customer);
    await post(`/queue/tickets/${ticket.id}/arrive`);
    await next(hassan.id);
    await next(hassan.id);
    assert.ok((await pushesFor(customer)).some((push) => push.title === 'نعيمًا'));
  });
});

describe('السباق ومنع التكرار', () => {
  beforeEach(clearQueue);

  test('8 حلاقين داسوا «التالي» في نفس اللحظة: كل زبون راح لحلاق واحد بالظبط', async () => {
    const barbers = [];
    for (let i = 0; i < 8; i += 1) {
      const barber = (await post('/barbers', { name: `سباق ${i}` })).body.data;
      await post(`/barbers/${barber.id}/status`, { status: 'available' });
      barbers.push(barber);
    }
    const tickets = [];
    for (let i = 0; i < 8; i += 1) tickets.push(await walkIn({ name: `زبون ${i}` }));

    const results = await Promise.all(barbers.map((barber) => post(`/queue/barbers/${barber.id}/next`)));
    for (const response of results) assert.equal(response.status, 200, JSON.stringify(response.body));

    const started = results.map((response) => response.body.data.started_id);
    assert.equal(new Set(started).size, 8, `كل حلاق خد زبون مختلف: ${started}`);
    assert.deepEqual([...started].sort((a, b) => a - b), tickets.map((t) => t.id).sort((a, b) => a - b));

    const rows = await query(
      `SELECT barber_id, COUNT(*) AS n FROM queue_tickets WHERE id IN (${tickets.map(() => '?').join(',')}) GROUP BY barber_id`,
      tickets.map((t) => t.id),
    );
    assert.equal(rows.length, 8);
    assert.ok(rows.every((row) => row.n === 1));

    for (const barber of barbers) await http.delete(`${API}/barbers/${barber.id}`).set(bearer(ctx.token));
  });

  test('نفس Idempotency-Key مرّتين: «التالي» يتنفّذ مرّة واحدة والرد يتكرّر', async () => {
    const a = await walkIn();
    const b = await walkIn();
    const key = { 'Idempotency-Key': `next-${crypto.randomUUID()}` };
    const first = await post(`/queue/barbers/${hassan.id}/next`, {}, ctx.token, key);
    const replay = await post(`/queue/barbers/${hassan.id}/next`, {}, ctx.token, key);
    assert.equal(first.status, 200);
    assert.equal(replay.headers['idempotent-replay'], 'true');
    assert.deepEqual(replay.body, first.body);
    assert.equal(first.body.data.started_id, a.id);
    assert.equal((await ticketRow(b.id)).status, 'waiting', 'الزبون التاني لسه مستني');
  });

  test('مفتاح بشكل غلط مرفوض', async () => {
    const response = await post('/queue/tickets', { service_ids: [cut.id] }, ctx.token, { 'Idempotency-Key': 'x' });
    assert.equal(response.status, 400);
  });
});

describe('الشاشات', () => {
  beforeEach(clearQueue);

  test('since: رد صغير لو مفيش جديد، والصورة كاملة لو اتغيّر', async () => {
    const { version } = await view();
    const same = await http.get(`${API}/queue?since=${version}`).set(bearer(ctx.token));
    assert.deepEqual(same.body.data, { changed: false, version });
    await walkIn();
    const changed = await http.get(`${API}/queue?since=${version}`).set(bearer(ctx.token));
    assert.ok(changed.body.data.version > version);
    assert.equal(changed.body.data.waiting.length, 1);
  });

  test('تغيير حالة الحلاق بيغيّر النسخة (الوقت المتوقّع اتغيّر)', async () => {
    const { version } = await view();
    await post(`/barbers/${hassan.id}/status`, { status: 'break', break_minutes: 10 });
    assert.ok((await view()).version > version);
  });

  test('الـ stream: الصورة أوّل ما يفتح، وصورة جديدة بعد كل تغيير', async () => {
    const server = app.listen(0);
    const { port } = server.address();
    const controller = new AbortController();
    try {
      const response = await fetch(`http://127.0.0.1:${port}${API}/queue/stream`, {
        headers: bearer(ctx.token), signal: controller.signal,
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/event-stream/);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const nextEvent = async () => {
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
          const index = buffer.indexOf('\n\n');
          if (index !== -1) {
            const chunk = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            const data = chunk.split('\n').find((line) => line.startsWith('data: '));
            if (chunk.includes('event: queue') && data) return JSON.parse(data.slice(6));
            continue;
          }
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
        }
        throw new Error('ما وصلش حدث من الـ stream');
      };

      const first = await nextEvent();
      assert.equal(first.waiting.length, 0);
      await walkIn({ name: 'من الـ stream' });
      const second = await nextEvent();
      assert.ok(second.version > first.version);
      assert.equal(second.waiting[0].name, 'من الـ stream');
    } finally {
      controller.abort();
      server.close();
    }
  });

  test('الاستقبال يشوف ويضيف، بس ما يحرّكش', async () => {
    const cashier = await staffToken(http, ctx.shopId, 'cashier');
    assert.equal((await http.get(`${API}/queue`).set(bearer(cashier))).status, 200);
    assert.equal((await post('/queue/tickets', { service_ids: [cut.id] }, cashier)).status, 201);
  });
});
