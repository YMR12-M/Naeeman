import { test, before, after, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execute, query, queryOne } from '../src/config/db.js';
import { checkinCode } from '../src/queue/checkin.js';
import { API, bearer, bootstrapOwner, makeApp, resetDatabase, shutdown } from './helpers.js';

const { app, http } = makeApp();
let ctx;
let cut;
let hassan;
let mahmoud;
let phoneSeq = 0;

const PASS = 'zaboon-pass-1';
const nextPhone = () => { phoneSeq += 1; return `0101234${String(phoneSeq).padStart(4, '0')}`; };

async function register(overrides = {}, clientType = 'mobile') {
  const body = { name: 'أحمد محمود', phone: nextPhone(), password: PASS, ...overrides };
  const response = await http.post(`${API}/customer-auth/register`).set('X-Client-Type', clientType).send(body);
  return { response, body, token: response.body?.data?.tokens?.access_token, refresh: response.body?.data?.tokens?.refresh_token };
}

const asCustomer = (token) => ({
  get: (path) => http.get(`${API}/me${path}`).set(bearer(token)),
  post: (path, body = {}) => http.post(`${API}/me${path}`).set(bearer(token)).send(body),
  patch: (path, body = {}) => http.patch(`${API}/me${path}`).set(bearer(token)).send(body),
});

const staffPost = (path, body = {}) => http.post(`${API}${path}`).set(bearer(ctx.token)).send(body);

async function clearQueue() {
  await execute("UPDATE queue_tickets SET status = 'cancelled' WHERE status IN ('waiting','serving')");
  await execute("UPDATE barbers SET status = 'available', break_until = NULL WHERE archived_at IS NULL");
}

before(async () => {
  await resetDatabase();
  ctx = await bootstrapOwner(http, { shop: { name: 'صالون الأمل', slug: 'elamal' } });
  await http.put(`${API}/shop/hours`).set(bearer(ctx.token))
    .send({ periods: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens_at: '00:00', closes_at: '00:00' })) });
  [cut] = (await staffPost('/services/bulk', { items: [{ name: 'قص', price: 9000, default_minutes: 25 }] })).body.data;
  hassan = (await staffPost('/barbers', { name: 'حسن', chair_no: 1 })).body.data;
  mahmoud = (await staffPost('/barbers', { name: 'محمود', chair_no: 2 })).body.data;
  for (const barber of [hassan, mahmoud]) await staffPost(`/barbers/${barber.id}/status`, { status: 'available' });
});
after(shutdown);

describe('حساب الزبون', () => {
  test('تسجيل برقم الموبايل: الرقم بيتوحّد، ومفيش كلمة سر في الرد', async () => {
    const { response, body } = await register({ email: 'ahmed@test.local' });
    assert.equal(response.status, 201);
    const { customer } = response.body.data;
    assert.equal(customer.phone, `+20${body.phone.slice(1)}`);
    assert.equal(customer.email, 'ahmed@test.local');
    assert.equal(customer.password_hash, undefined);
    assert.ok(response.body.data.tokens.refresh_token);
  });

  test('نفس الرقم بصيغة تانية = نفس الحساب', async () => {
    const { body } = await register();
    const again = await http.post(`${API}/customer-auth/register`).send({ ...body, phone: `+20${body.phone.slice(1)}` });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'PHONE_TAKEN');
  });

  test('كلمة سر ضعيفة، ورقم غلط', async () => {
    assert.equal((await register({ password: '1234' })).response.status, 422);
    assert.equal((await register({ password: '12345678' })).response.status, 422);
    assert.equal((await register({ phone: '12' })).response.status, 422);
  });

  test('الدخول: نفس الرسالة لرقم مش موجود وكلمة سر غلط، والقفل بعد 5 محاولات', async () => {
    const { body } = await register();
    const login = (phone, password) => http.post(`${API}/customer-auth/login`).send({ phone, password });
    const unknown = await login('01099999999', 'whatever-1');
    const wrong = await login(body.phone, 'wrong-pass-1');
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.message, wrong.body.message);
    assert.equal((await login(body.phone, PASS)).status, 200);
    for (let i = 0; i < 5; i += 1) await login(body.phone, 'wrong-pass-1');
    assert.equal((await login(body.phone, PASS)).status, 423);
  });

  test('التجديد بيدوّر التوكن، والخروج بيلغيه', async () => {
    const { refresh } = await register();
    const renewed = await http.post(`${API}/customer-auth/refresh`).set('X-Client-Type', 'mobile').send({ refresh_token: refresh });
    assert.equal(renewed.status, 200);
    const newer = renewed.body.data.tokens.refresh_token;
    assert.notEqual(newer, refresh);
    await http.post(`${API}/customer-auth/logout`).set('X-Client-Type', 'mobile').send({ refresh_token: newer }).expect(204);
    assert.equal((await http.post(`${API}/customer-auth/refresh`).set('X-Client-Type', 'mobile').send({ refresh_token: newer })).status, 401);
  });

  test('تطبيق الويب: التجديد في كوكي httpOnly، ومحتاج X-Client-Type', async () => {
    const { response } = await register({}, 'web');
    const cookie = response.headers['set-cookie'][0];
    assert.match(cookie, /naeeman_crt=/);
    assert.match(cookie, /HttpOnly/i);
    assert.equal(response.body.data.tokens.refresh_token, undefined);
    const value = cookie.split(';')[0];
    assert.equal((await http.post(`${API}/customer-auth/refresh`).set('Cookie', value).send({})).status, 403);
    assert.equal((await http.post(`${API}/customer-auth/refresh`).set('Cookie', value).set('X-Client-Type', 'web').send({})).status, 200);
  });

  test('توكن الزبون ما يفتحش مسارات الموظفين، والعكس', async () => {
    const { token } = await register();
    const staffRoute = await http.get(`${API}/queue`).set(bearer(token));
    assert.equal(staffRoute.status, 401);
    assert.equal(staffRoute.body.code, 'TOKEN_INVALID');
    const customerRoute = await http.get(`${API}/me`).set(bearer(ctx.token));
    assert.equal(customerRoute.status, 401);
  });

  test('تعديل الاسم والبريد، وتغيير كلمة السر بيقفل الجلسات التانية', async () => {
    const { token, refresh } = await register();
    const me = asCustomer(token);
    const patched = await me.patch('', { name: 'أحمد م.', email: 'new@test.local' });
    assert.equal(patched.body.data.name, 'أحمد م.');
    const changed = await me.post('/change-password', { current_password: PASS, new_password: 'another-pass-2' });
    assert.equal(changed.status, 200);
    assert.equal((await http.post(`${API}/customer-auth/refresh`).set('X-Client-Type', 'mobile').send({ refresh_token: refresh })).status, 401);
  });

  test('نسيت كلمة السر: بالبريد لو موجود، ونفس الرد لو مش موجود', async () => {
    const withEmail = await register({ email: 'forgot@test.local' });
    const without = await register();
    const a = await http.post(`${API}/customer-auth/forgot-password`).send({ phone: withEmail.body.phone });
    const b = await http.post(`${API}/customer-auth/forgot-password`).send({ phone: without.body.phone });
    assert.deepEqual(a.body, b.body);
    const mails = await query("SELECT payload FROM notification_outbox WHERE template = 'customer_password_reset'");
    assert.equal(mails.length, 1);
    const payload = typeof mails[0].payload === 'string' ? JSON.parse(mails[0].payload) : mails[0].payload;
    assert.match(payload.link, /^http:\/\/localhost:5201\/reset-password\?token=/);
    const token = new URL(payload.link).searchParams.get('token');
    assert.equal((await http.post(`${API}/customer-auth/reset-password`).send({ token, new_password: 'reset-pass-3' })).status, 200);
    assert.equal((await http.post(`${API}/customer-auth/login`).send({ phone: withEmail.body.phone, password: 'reset-pass-3' })).status, 200);
  });

  test('اشتراك الإشعارات', async () => {
    const { token } = await register();
    const subscription = { endpoint: 'https://push.example.com/abc123', keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(16) } };
    assert.equal((await asCustomer(token).post('/push-subscriptions', subscription)).status, 204);
    assert.ok(await queryOne('SELECT id FROM push_subscriptions WHERE endpoint = ?', [subscription.endpoint]));
  });
});

describe('دوري من التطبيق', () => {
  beforeEach(clearQueue);

  test('رحلة كاملة: خُد دور ← جاي ← أخّرني ← وصلت بالكود ← على الكرسي ← نعيمًا', async () => {
    const { token } = await register({ name: 'كريم' });
    const me = asCustomer(token);

    const taken = await me.post('/tickets', { shop_slug: 'elamal', service_ids: [cut.id] });
    assert.equal(taken.status, 201, JSON.stringify(taken.body));
    const { ticket } = taken.body.data;
    assert.equal(ticket.status, 'waiting');
    assert.equal(ticket.shop.name, 'صالون الأمل');
    assert.equal(ticket.arrived, false);
    assert.equal(ticket.ahead, 0);
    assert.equal(ticket.delays_left, 2);
    assert.equal(ticket.wait_minutes % 5, 0);
    assert.equal(JSON.stringify(taken.body).includes('phone":"+20'), false, 'رقم الزبون ما يرجعش في الدور');

    // اتنين من الشارع ورا
    await staffPost('/queue/tickets', { service_ids: [cut.id] });
    await staffPost('/queue/tickets', { service_ids: [cut.id] });

    assert.equal((await me.post(`/tickets/${ticket.id}/coming`)).body.data.ticket.confirmed, true);
    const delayed = await me.post(`/tickets/${ticket.id}/delay`);
    assert.equal(delayed.status, 200);
    assert.equal(delayed.body.data.ticket.delays_left, 1);

    const wrongCode = await me.post(`/tickets/${ticket.id}/check-in`, { code: '000000' });
    assert.equal(wrongCode.status, 422);
    assert.equal(wrongCode.body.code, 'BAD_CHECKIN_CODE');
    const { checkin_secret: secret } = await queryOne('SELECT checkin_secret FROM shops WHERE id = ?', [ctx.shopId]);
    const arrived = await me.post(`/tickets/${ticket.id}/check-in`, { code: checkinCode(secret, ctx.shopId) });
    assert.equal(arrived.status, 200);
    assert.equal(arrived.body.data.ticket.arrived, true);

    await staffPost(`/queue/barbers/${hassan.id}/next`);
    await staffPost(`/queue/barbers/${mahmoud.id}/next`);
    await staffPost(`/queue/barbers/${hassan.id}/next`);
    const onChair = (await me.get('/tickets/active')).body.data.ticket;
    assert.equal(onChair.status, 'serving');
    assert.equal(onChair.barber.name, 'حسن');

    await staffPost(`/queue/barbers/${hassan.id}/next`);
    assert.equal((await me.get('/tickets/active')).body.data.ticket, null);
    const history = (await me.get('/tickets')).body.data;
    assert.equal(history[0].status, 'done');
    assert.equal(history[0].shop_name, 'صالون الأمل');
    assert.equal(history[0].services, 'قص');
  });

  test('كود محل تاني أو كود قديم مرفوض', async () => {
    const { token } = await register();
    const me = asCustomer(token);
    const { ticket } = (await me.post('/tickets', { shop_slug: 'elamal', service_ids: [cut.id] })).body.data;
    const { checkin_secret: secret } = await queryOne('SELECT checkin_secret FROM shops WHERE id = ?', [ctx.shopId]);
    const old = checkinCode(secret, ctx.shopId, new Date(Date.now() - 3 * 60_000));
    const otherShop = checkinCode(secret, ctx.shopId + 1);
    for (const code of [old, otherShop]) {
      if (code === checkinCode(secret, ctx.shopId)) continue; // صدفة نادرة جدًا
      assert.equal((await me.post(`/tickets/${ticket.id}/check-in`, { code })).status, 422);
    }
  });

  test('الزبون يلغي دوره، وما يقدرش يلمس دور حد تاني', async () => {
    const owner = asCustomer((await register()).token);
    const stranger = asCustomer((await register()).token);
    const { ticket } = (await owner.post('/tickets', { shop_slug: 'elamal', service_ids: [cut.id] })).body.data;

    assert.equal((await stranger.get(`/tickets/${ticket.id}`)).status, 404);
    assert.equal((await stranger.post(`/tickets/${ticket.id}/cancel`)).status, 404);

    const cancelled = await owner.post(`/tickets/${ticket.id}/cancel`);
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.data.ticket.status, 'cancelled');
  });

  test('دور واحد شغّال، ومحل مش موجود', async () => {
    const me = asCustomer((await register()).token);
    await me.post('/tickets', { shop_slug: 'elamal', service_ids: [cut.id] });
    const second = await me.post('/tickets', { shop_slug: 'elamal', service_ids: [cut.id] });
    assert.equal(second.status, 409);
    assert.equal(second.body.code, 'ACTIVE_TICKET_EXISTS');
    assert.equal((await me.post('/tickets', { shop_slug: 'no-such-shop', service_ids: [cut.id] })).status, 404);
  });

  test('الحلاق المطلوب بيظهر باسمه، والزبون ما يشوفش أسماء غيره', async () => {
    await staffPost('/queue/tickets', { name: 'سرّي جدًا', service_ids: [cut.id] });
    const me = asCustomer((await register()).token);
    const taken = await me.post('/tickets', { shop_slug: 'elamal', service_ids: [cut.id], barber_id: mahmoud.id });
    assert.equal(taken.body.data.ticket.preferred_barber.name, 'محمود');
    assert.equal(JSON.stringify(taken.body).includes('سرّي'), false);
  });

  test('الـ stream: حالة الدور لايف', async () => {
    const { token } = await register();
    const { ticket } = (await asCustomer(token).post('/tickets', { shop_slug: 'elamal', service_ids: [cut.id] })).body.data;

    const server = app.listen(0);
    const controller = new AbortController();
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${API}/me/stream`, { headers: bearer(token), signal: controller.signal });
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
            if (data) return JSON.parse(data.slice(6));
            continue;
          }
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
        }
        throw new Error('ما وصلش حدث');
      };
      assert.equal((await nextEvent()).ticket.id, ticket.id);
      await staffPost(`/queue/barbers/${hassan.id}/next`);
      const called = await nextEvent();
      assert.equal(called.ticket.called, true);
    } finally {
      controller.abort();
      server.close();
    }
  });
});

describe('صفحة المحل العامة', () => {
  beforeEach(clearQueue);

  test('فاتح، والخدمات، والحلاقين الموجودين بس، والانتظار — من غير بيانات زباين', async () => {
    await staffPost('/queue/tickets', { name: 'زبون سرّي', phone: '01011112222', service_ids: [cut.id] });
    await staffPost(`/barbers/${mahmoud.id}/status`, { status: 'off' });
    const response = await http.get(`${API}/public/shops/elamal`);
    assert.equal(response.status, 200);
    const shop = response.body.data;
    assert.equal(shop.name, 'صالون الأمل');
    assert.equal(shop.open.open, true);
    assert.equal(shop.waiting_count, 1);
    assert.deepEqual(shop.services.map((service) => service.name), ['قص']);
    assert.deepEqual(shop.barbers.map((barber) => barber.name), ['حسن']);
    assert.equal(shop.barbers[0].wait_minutes, 25);
    assert.equal(shop.wait_minutes, 25);
    const text = JSON.stringify(shop);
    assert.equal(text.includes('سرّي'), false);
    assert.equal(text.includes('1111'), false);
    assert.equal(text.includes('checkin_secret'), false);
  });

  test('محل مش موجود، وCORS مفتوح من غير كوكي', async () => {
    assert.equal((await http.get(`${API}/public/shops/nope-shop`)).status, 404);
    const response = await http.get(`${API}/public/shops/elamal`).set('Origin', 'https://any-site.example');
    assert.equal(response.headers['access-control-allow-origin'], 'https://any-site.example');
    assert.equal(response.headers['access-control-allow-credentials'], undefined);
  });
});
