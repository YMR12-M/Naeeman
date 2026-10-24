import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { queryOne } from '../src/config/db.js';
import { API, bearer, bootstrapOwner, makeApp, resetDatabase, shutdown, staffToken } from './helpers.js';

const { http } = makeApp();
let ctx;
let cashier;
let phoneSeq = 0;
const PASS = 'zaboon-pass-1';
const NEW_PASS = 'gedida-pass-2';
const nextPhone = () => { phoneSeq += 1; return `0109876${String(phoneSeq).padStart(4, '0')}`; };

async function customer() {
  const phone = nextPhone();
  const response = await http.post(`${API}/customer-auth/register`).set('X-Client-Type', 'mobile')
    .send({ name: 'زبون من غير بريد', phone, password: PASS });
  return { phone, refresh: response.body.data.tokens.refresh_token };
}

const issue = (phone, token = cashier) => http.post(`${API}/customers/recovery-code`).set(bearer(token)).send({ phone });
const reset = (body) => http.post(`${API}/customer-auth/reset-with-code`).send(body);
const loginAs = (phone, password) => http.post(`${API}/customer-auth/login`).set('X-Client-Type', 'mobile').send({ phone, password });

before(async () => {
  await resetDatabase();
  ctx = await bootstrapOwner(http, { shop: { slug: 'recovery' } });
  cashier = await staffToken(http, ctx.shopId, 'cashier');
});
after(shutdown);

describe('استعادة كلمة السر من المحل', () => {
  test('الاستقبال بيطلّع كود، والزبون بيغيّر كلمة السر بيه، وجلساته القديمة بتتقفل', async () => {
    const { phone, refresh } = await customer();
    const issued = await issue(phone);
    assert.equal(issued.status, 200);
    assert.match(issued.body.data.code, /^\d{6}$/);
    assert.equal(issued.body.data.expires_in_minutes, 15);
    assert.equal(issued.body.data.customer.name, 'زبون من غير بريد');

    const row = await queryOne("SELECT code_hash FROM customer_password_resets WHERE kind = 'shop' ORDER BY id DESC LIMIT 1");
    assert.notEqual(row.code_hash, issued.body.data.code, 'الكود نفسه ما بيتخزّنش');

    const done = await reset({ phone, code: issued.body.data.code, new_password: NEW_PASS });
    assert.equal(done.status, 200);
    assert.equal((await loginAs(phone, PASS)).status, 401);
    assert.equal((await loginAs(phone, NEW_PASS)).status, 200);

    const old = await http.post(`${API}/customer-auth/refresh`).send({ refresh_token: refresh });
    assert.equal(old.status, 401);

    const again = await reset({ phone, code: issued.body.data.code, new_password: 'talta-pass-3' });
    assert.equal(again.status, 400, 'الكود مرّة واحدة بس');
  });

  test('الكود بيتحرق بعد 5 محاولات غلط، حتى لو الصح جه بعدها', async () => {
    const { phone } = await customer();
    const { code } = (await issue(phone)).body.data;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const response = await reset({ phone, code: wrong, new_password: NEW_PASS });
      assert.equal(response.status, 400);
      assert.equal(response.body.code, 'RESET_INVALID');
    }
    assert.equal((await reset({ phone, code, new_password: NEW_PASS })).status, 400);
    assert.equal((await loginAs(phone, PASS)).status, 200, 'كلمة السر القديمة لسه شغّالة');
  });

  test('كود جديد بيلغي القديم', async () => {
    const { phone } = await customer();
    const first = (await issue(phone)).body.data.code;
    const second = (await issue(phone)).body.data.code;
    if (first !== second) assert.equal((await reset({ phone, code: first, new_password: NEW_PASS })).status, 400);
    assert.equal((await reset({ phone, code: second, new_password: NEW_PASS })).status, 200);
  });

  test('كود رقم تاني ما يفتحش الحساب ده', async () => {
    const a = await customer();
    const b = await customer();
    const { code } = (await issue(b.phone)).body.data;
    assert.equal((await reset({ phone: a.phone, code, new_password: NEW_PASS })).status, 400);
  });

  test('رقم مالوش حساب: الموظف بيعرف، والطلب بيتسجّل في السجل لما ينجح', async () => {
    assert.equal((await issue('01000000999')).status, 404);
    const { phone } = await customer();
    await issue(phone);
    const log = await queryOne("SELECT user_id, entity FROM audit_logs WHERE action = 'customer.recovery_code' ORDER BY id DESC LIMIT 1");
    assert.equal(log.entity, 'customer');
    assert.ok(log.user_id);
  });

  test('من غير دخول موظف أو بتوكن زبون: مرفوض', async () => {
    const { phone } = await customer();
    assert.equal((await http.post(`${API}/customers/recovery-code`).send({ phone })).status, 401);
    const session = await loginAs(phone, PASS);
    assert.equal((await issue(phone, session.body.data.tokens.access_token)).status, 401);
  });
});
