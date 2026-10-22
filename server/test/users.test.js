import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { query, queryOne } from '../src/config/db.js';
import {
  API, PASSWORD, bearer, bootstrapOwner, login, makeApp, resetDatabase, seedShop, seedUser, shutdown,
} from './helpers.js';

const { http } = makeApp();
let ctx;

before(async () => {
  await resetDatabase();
  ctx = await bootstrapOwner(http);
});
after(shutdown);

const createUser = (token, body) => http.post(`${API}/users`).set(bearer(token)).send(body);

describe('إنشاء موظف', () => {
  test('دعوة بالبريد: رابط في الصندوق، بلا كلمة مرور في الرد ولا في البريد', async () => {
    const response = await createUser(ctx.token, {
      full_name: 'مدير المحل', email: 'manager@test.local', role: 'manager',
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.data.temp_password, null);
    assert.equal(response.body.data.user.must_change_password, true);

    const [mail] = await query("SELECT payload FROM notification_outbox WHERE template = 'staff_invite'");
    const payload = typeof mail.payload === 'string' ? JSON.parse(mail.payload) : mail.payload;
    assert.match(payload.link, /reset-password\?token=/);
    assert.equal(JSON.stringify(payload).includes('Pass'), false);

    // الموظف يحدّد كلمته من الرابط ثم يدخل
    const token = new URL(payload.link).searchParams.get('token');
    const reset = await http.post(`${API}/auth/reset-password`).send({ token, new_password: 'Manager-Own-Pass-77' });
    assert.equal(reset.status, 200);
    assert.equal((await login(http, 'manager@test.local', 'Manager-Own-Pass-77')).status, 200);
  });

  test('بدون دعوة: كلمة مؤقتة تُعرض مرّة واحدة ويُجبَر على تغييرها', async () => {
    const response = await createUser(ctx.token, {
      full_name: 'موظف استقبال', email: 'desk@test.local', role: 'cashier', send_invite: false,
    });
    assert.equal(response.status, 201);
    const temp = response.body.data.temp_password;
    assert.ok(temp && temp.length >= 12);

    const session = await login(http, 'desk@test.local', temp);
    assert.equal(session.status, 200);
    assert.equal(session.body.data.user.must_change_password, true);
  });

  test('بريد مكرّر → 409', async () => {
    const response = await createUser(ctx.token, { full_name: 'تاني', email: 'desk@test.local', role: 'cashier' });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'EMAIL_TAKEN');
  });

  test('الفريق للمالك بس: المدير والاستقبال لا يضيفون ولا يرون الفريق', async () => {
    await seedUser({ shopId: ctx.shopId, role: 'manager', email: 'm2@test.local' });
    await seedUser({ shopId: ctx.shopId, role: 'cashier', email: 'fd2@test.local' });

    const manager = await login(http, 'm2@test.local');
    const blocked = await createUser(manager.token, { full_name: 'مالك مزيّف', email: 'fake@test.local', role: 'owner' });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'FORBIDDEN');
    assert.equal((await http.get(`${API}/users`).set(bearer(manager.token))).status, 403);

    const desk = await login(http, 'fd2@test.local');
    const list = await http.get(`${API}/users`).set(bearer(desk.token));
    assert.equal(list.status, 403);
  });
});

describe('حماية المحل من نفسه', () => {
  test('لا أحد يعدّل دوره أو يحذف نفسه (فلا يتقفل المحل بالخطأ)', async () => {
    const me = await queryOne('SELECT id FROM users WHERE email = ?', ['owner@test.local']);

    const selfRole = await http.patch(`${API}/users/${me.id}`).set(bearer(ctx.token)).send({ role: 'manager' });
    assert.equal(selfRole.status, 403);
    assert.equal(selfRole.body.code, 'SELF_CHANGE');

    const selfSuspend = await http.patch(`${API}/users/${me.id}`).set(bearer(ctx.token)).send({ status: 'suspended' });
    assert.equal(selfSuspend.status, 403);

    const selfDelete = await http.delete(`${API}/users/${me.id}`).set(bearer(ctx.token));
    assert.equal(selfDelete.status, 403);
  });

  test('مالك يوقف مالكًا آخر: جلسته تموت فورًا ويعود بإعادة التفعيل', async () => {
    const second = await seedUser({ shopId: ctx.shopId, role: 'owner', email: 'owner2@test.local' });
    const secondSession = await login(http, 'owner2@test.local', PASSWORD, 'mobile');

    await http.patch(`${API}/users/${second.id}`).set(bearer(ctx.token)).send({ status: 'suspended' }).expect(200);

    const blocked = await http.get(`${API}/auth/me`).set(bearer(secondSession.token));
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'USER_SUSPENDED');
    const refresh = await http.post(`${API}/auth/refresh`).set('X-Client-Type', 'mobile').send({ refresh_token: secondSession.refreshToken });
    assert.equal(refresh.status, 401);

    await http.patch(`${API}/users/${second.id}`).set(bearer(ctx.token)).send({ status: 'active' }).expect(200);
    assert.equal((await login(http, 'owner2@test.local')).status, 200);
  });
});

describe('الإيقاف والحذف', () => {
  test('إيقاف الموظف يُنهي جلساته فورًا، والحذف يحرّر بريده', async () => {
    const created = await createUser(ctx.token, {
      full_name: 'مؤقت', email: 'temp-staff@test.local', role: 'cashier', send_invite: false,
    });
    const id = created.body.data.user.id;
    const staffToken = await login(http, 'temp-staff@test.local', created.body.data.temp_password, 'mobile');
    assert.ok(staffToken.refreshToken);

    await http.patch(`${API}/users/${id}`).set(bearer(ctx.token)).send({ status: 'suspended' }).expect(200);
    const refresh = await http.post(`${API}/auth/refresh`).set('X-Client-Type', 'mobile').send({ refresh_token: staffToken.refreshToken });
    assert.equal(refresh.status, 401);

    await http.delete(`${API}/users/${id}`).set(bearer(ctx.token)).expect(204);
    assert.equal((await login(http, 'temp-staff@test.local', created.body.data.temp_password)).status, 401);

    const reuse = await createUser(ctx.token, { full_name: 'جديد', email: 'temp-staff@test.local', role: 'cashier' });
    assert.equal(reuse.status, 201);
  });

  test('كلمة مؤقتة جديدة لموظف نسي', async () => {
    const created = await createUser(ctx.token, {
      full_name: 'ناسي', email: 'forgot-staff@test.local', role: 'manager', send_invite: false,
    });
    const id = created.body.data.user.id;
    const reissued = await http.post(`${API}/users/${id}/temp-password`).set(bearer(ctx.token));
    assert.equal(reissued.status, 200);
    assert.notEqual(reissued.body.data.temp_password, created.body.data.temp_password);
    assert.equal((await login(http, 'forgot-staff@test.local', created.body.data.temp_password)).status, 401);
    assert.equal((await login(http, 'forgot-staff@test.local', reissued.body.data.temp_password)).status, 200);
  });
});

describe('عزل المحلات', () => {
  test('مالك محل تاني لا يرى ولا يعدّل موظفينا', async () => {
    const otherShop = await seedShop({ name: 'محل تاني' });
    await seedUser({ shopId: otherShop, role: 'owner', email: 'other-owner@test.local', password: PASSWORD });
    const other = await login(http, 'other-owner@test.local');

    const mine = await queryOne('SELECT id FROM users WHERE email = ?', ['manager@test.local']);
    assert.equal((await http.get(`${API}/users/${mine.id}`).set(bearer(other.token))).status, 404);
    assert.equal((await http.patch(`${API}/users/${mine.id}`).set(bearer(other.token)).send({ status: 'suspended' })).status, 404);

    const list = await http.get(`${API}/users`).set(bearer(other.token));
    assert.equal(list.body.data.length, 1);
  });

  test('البريد بيوصل باسم المحل', async () => {
    const [mail] = await query("SELECT payload FROM notification_outbox WHERE template = 'staff_invite'");
    const payload = typeof mail.payload === 'string' ? JSON.parse(mail.payload) : mail.payload;
    assert.equal(payload.shopName, 'صالون الاختبار');
  });
});
