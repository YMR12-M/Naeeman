import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { query, execute } from '../src/config/db.js';
import {
  API, PASSWORD, bearer, login, makeApp, resetDatabase, seedShop, seedUser, shutdown,
} from './helpers.js';

const { http } = makeApp();
let shopId;

before(async () => {
  await resetDatabase();
  shopId = await seedShop();
});
after(shutdown);

describe('تسجيل الدخول', () => {
  before(() => seedUser({ shopId, email: 'a@test.local' }));

  test('نجاح: توكن دخول + كوكي httpOnly للويب، بلا توكن تجديد في الجسم', async () => {
    const { status, body, response } = await login(http, 'a@test.local');
    assert.equal(status, 200);
    assert.ok(body.data.tokens.access_token);
    assert.equal(body.data.tokens.refresh_token, undefined);
    const cookie = response.headers['set-cookie'][0];
    assert.match(cookie, /naeeman_rt=/);
    assert.match(cookie, /HttpOnly/i);
    assert.equal(body.data.user.role, 'owner');
    assert.ok(body.data.user.permissions.includes('queue.manage'));
    assert.equal(body.data.user.shop.name, 'صالون الاختبار');
    assert.equal(body.data.user.password_hash, undefined);
  });

  test('التطبيقات تستلم توكن التجديد في الجسم ولا تستلم كوكي', async () => {
    const { body, response } = await login(http, 'a@test.local', PASSWORD, 'mobile');
    assert.ok(body.data.tokens.refresh_token);
    assert.equal(response.headers['set-cookie'], undefined);
  });

  test('فشل: نفس الرسالة لبريد غير موجود وكلمة خاطئة', async () => {
    const unknown = await login(http, 'nobody@test.local', 'whatever-123');
    const wrong = await login(http, 'a@test.local', 'wrong-password-1');
    assert.equal(unknown.status, 401);
    assert.equal(wrong.status, 401);
    assert.equal(unknown.body.message, wrong.body.message);
    assert.equal(unknown.body.code, 'BAD_CREDENTIALS');
  });

  test('التحقّق من المدخلات برسائل عربية', async () => {
    const response = await http.post(`${API}/auth/login`).send({ email: 'not-an-email' });
    assert.equal(response.status, 422);
    assert.equal(response.body.code, 'VALIDATION_ERROR');
    assert.equal(response.body.errors.email, 'بريد إلكتروني غير صالح');
    assert.equal(response.body.errors.password, 'الحقل مطلوب');
  });
});

describe('قفل الحساب', () => {
  before(() => seedUser({ shopId, email: 'lock@test.local' }));

  test('بعد 5 محاولات فاشلة يُقفل حتى لو الكلمة الصحيحة', async () => {
    for (let i = 0; i < 5; i += 1) {
      const attempt = await login(http, 'lock@test.local', 'wrong-password-1');
      assert.equal(attempt.status, 401);
    }
    const locked = await login(http, 'lock@test.local', PASSWORD);
    assert.equal(locked.status, 423);
    assert.equal(locked.body.code, 'ACCOUNT_LOCKED');
  });

  test('ينفكّ القفل بعد انتهاء المدّة', async () => {
    await execute("UPDATE users SET locked_until = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE email = 'lock@test.local'");
    const ok = await login(http, 'lock@test.local', PASSWORD);
    assert.equal(ok.status, 200);
  });
});

describe('تدوير التوكن وكشف السرقة', () => {
  before(() => seedUser({ shopId, email: 'rot@test.local' }));

  const refresh = (token) =>
    http.post(`${API}/auth/refresh`).set('X-Client-Type', 'mobile').send({ refresh_token: token });

  test('التجديد يُصدر توكنًا جديدًا ويُبطل القديم', async () => {
    const first = await login(http, 'rot@test.local', PASSWORD, 'mobile');
    const second = await refresh(first.refreshToken);
    assert.equal(second.status, 200);
    assert.notEqual(second.body.data.tokens.refresh_token, first.refreshToken);
    assert.ok(second.body.data.tokens.access_token);
  });

  test('إعادة استخدام توكن قديم خلال ثوانٍ = سباق مشروع، لا تُلغى الجلسة', async () => {
    const first = await login(http, 'rot@test.local', PASSWORD, 'mobile');
    const second = await refresh(first.refreshToken);
    const raced = await refresh(first.refreshToken);
    assert.equal(raced.status, 401);
    assert.equal(raced.body.code, 'REFRESH_IN_PROGRESS');
    // التوكن الجديد ما زال يعمل
    const third = await refresh(second.body.data.tokens.refresh_token);
    assert.equal(third.status, 200);
  });

  test('إعادة استخدام توكن قديم بعد النافذة = سرقة، تُلغى السلسلة كلها', async () => {
    const first = await login(http, 'rot@test.local', PASSWORD, 'mobile');
    const second = await refresh(first.refreshToken);
    await execute('UPDATE refresh_tokens SET used_at = DATE_SUB(NOW(), INTERVAL 2 MINUTE) WHERE used_at IS NOT NULL');

    const replay = await refresh(first.refreshToken);
    assert.equal(replay.status, 401);
    assert.equal(replay.body.code, 'SESSION_REUSED');

    // حتى التوكن الحديث الصحيح صار مُلغى
    const legit = await refresh(second.body.data.tokens.refresh_token);
    assert.equal(legit.status, 401);
    assert.equal(legit.body.code, 'SESSION_REVOKED');
  });

  test('الكوكي بلا ترويسة X-Client-Type مرفوض (حماية CSRF)', async () => {
    const { cookie } = await login(http, 'rot@test.local');
    const blocked = await http.post(`${API}/auth/refresh`).set('Cookie', cookie).send({});
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'CSRF');

    const allowed = await http.post(`${API}/auth/refresh`).set('Cookie', cookie).set('X-Client-Type', 'web').send({});
    assert.equal(allowed.status, 200);
  });

  test('الخروج يُلغي الجلسة', async () => {
    const session = await login(http, 'rot@test.local', PASSWORD, 'mobile');
    const out = await http.post(`${API}/auth/logout`).set('X-Client-Type', 'mobile').send({ refresh_token: session.refreshToken });
    assert.equal(out.status, 204);
    const after = await refresh(session.refreshToken);
    assert.equal(after.status, 401);
  });
});

describe('الحساب الحالي', () => {
  before(() => seedUser({ shopId, email: 'me@test.local', role: 'cashier', fullName: 'موظف الاستقبال' }));

  test('GET /auth/me يرجّع الصلاحيات حسب الدور', async () => {
    const { token } = await login(http, 'me@test.local');
    const response = await http.get(`${API}/auth/me`).set(bearer(token));
    assert.equal(response.status, 200);
    assert.equal(response.body.data.role, 'cashier');
    assert.ok(response.body.data.permissions.includes('queue.write'));
    assert.ok(!response.body.data.permissions.includes('queue.manage'));
    assert.ok(!response.body.data.permissions.includes('users.write'));
  });

  test('بدون توكن أو بتوكن فاسد', async () => {
    const none = await http.get(`${API}/auth/me`);
    assert.equal(none.status, 401);
    assert.equal(none.body.code, 'NO_TOKEN');
    const bad = await http.get(`${API}/auth/me`).set(bearer('not.a.token'));
    assert.equal(bad.status, 401);
    assert.equal(bad.body.code, 'TOKEN_INVALID');
  });

  test('الحساب الموقوف يُرفض فورًا حتى بتوكن صالح', async () => {
    const { token } = await login(http, 'me@test.local');
    await execute("UPDATE users SET status = 'suspended' WHERE email = 'me@test.local'");
    const response = await http.get(`${API}/auth/me`).set(bearer(token));
    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'USER_SUSPENDED');
    await execute("UPDATE users SET status = 'active' WHERE email = 'me@test.local'");
  });
});

describe('تغيير كلمة المرور', () => {
  before(() => seedUser({ shopId, email: 'pw@test.local' }));

  test('يُنهي الجلسات الأخرى ويُبقي هذه', async () => {
    const other = await login(http, 'pw@test.local', PASSWORD, 'mobile');
    const here = await login(http, 'pw@test.local', PASSWORD, 'mobile');

    const changed = await http.post(`${API}/auth/change-password`)
      .set(bearer(here.token)).set('X-Client-Type', 'mobile')
      .send({ current_password: PASSWORD, new_password: 'N3w-Better-Pass-456' });
    assert.equal(changed.status, 200);
    assert.ok(changed.body.data.tokens.refresh_token);

    const old = await http.post(`${API}/auth/refresh`).set('X-Client-Type', 'mobile').send({ refresh_token: other.refreshToken });
    assert.equal(old.status, 401);

    const fresh = await login(http, 'pw@test.local', 'N3w-Better-Pass-456');
    assert.equal(fresh.status, 200);
  });

  test('رفض الكلمة الحالية الخاطئة والضعيفة', async () => {
    const { token } = await login(http, 'pw@test.local', 'N3w-Better-Pass-456');
    const wrong = await http.post(`${API}/auth/change-password`).set(bearer(token))
      .send({ current_password: 'nope-nope-nope', new_password: 'An0ther-Pass-789' });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.code, 'WRONG_PASSWORD');

    const weak = await http.post(`${API}/auth/change-password`).set(bearer(token))
      .send({ current_password: 'N3w-Better-Pass-456', new_password: 'short' });
    assert.equal(weak.status, 422);
  });
});

describe('كلمة مرور مؤقتة', () => {
  before(() => seedUser({ shopId, email: 'temp@test.local', mustChangePassword: true }));

  test('الحساب يُحجَز على تغيير الكلمة قبل أي شيء آخر', async () => {
    const { token } = await login(http, 'temp@test.local');
    assert.ok(token);
    const me = await http.get(`${API}/auth/me`).set(bearer(token));
    assert.equal(me.status, 200);
    assert.equal(me.body.data.must_change_password, true);

    const blocked = await http.get(`${API}/shop`).set(bearer(token));
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED');

    const changed = await http.post(`${API}/auth/change-password`).set(bearer(token))
      .send({ current_password: PASSWORD, new_password: 'Perm4nent-Pass-321' });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.data.user.must_change_password, false);
  });
});

describe('استعادة كلمة المرور', () => {
  before(() => seedUser({ shopId, email: 'forgot@test.local' }));

  test('نفس الرد لبريد موجود وغير موجود، والرابط في الصندوق يعمل مرّة واحدة', async () => {
    const known = await http.post(`${API}/auth/forgot-password`).send({ email: 'forgot@test.local' });
    const unknown = await http.post(`${API}/auth/forgot-password`).send({ email: 'ghost@test.local' });
    assert.equal(known.status, 200);
    assert.deepEqual(known.body, unknown.body);

    const [mail] = await query("SELECT payload FROM notification_outbox WHERE template = 'password_reset'");
    assert.ok(mail, 'لازم يتسجّل بريد الاستعادة في الصندوق');
    const payload = typeof mail.payload === 'string' ? JSON.parse(mail.payload) : mail.payload;
    const token = new URL(payload.link).searchParams.get('token');

    const reset = await http.post(`${API}/auth/reset-password`).send({ token, new_password: 'Reset-Pass-Is-Good-9' });
    assert.equal(reset.status, 200);
    assert.equal((await login(http, 'forgot@test.local', 'Reset-Pass-Is-Good-9')).status, 200);

    const again = await http.post(`${API}/auth/reset-password`).send({ token, new_password: 'Another-Good-Pass-8' });
    assert.equal(again.status, 400);
    assert.equal(again.body.code, 'RESET_INVALID');
  });
});

test('الجلسات: عرض وإلغاء جهاز بعينه', async () => {
  await seedUser({ shopId, email: 'sess@test.local' });
  const phone = await login(http, 'sess@test.local', PASSWORD, 'mobile');
  await login(http, 'sess@test.local', PASSWORD, 'desktop');

  const list = await http.get(`${API}/auth/sessions`).set(bearer(phone.token));
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 2);

  const target = list.body.data.find((session) => session.client_type === 'desktop');
  const revoke = await http.delete(`${API}/auth/sessions/${target.id}`).set(bearer(phone.token));
  assert.equal(revoke.status, 204);

  const after = await http.get(`${API}/auth/sessions`).set(bearer(phone.token));
  assert.equal(after.body.data.length, 1);
});
