/* ============================================
   نعيمًا التجريبي - المسارات
   نفس مسارات server/src/routes/index.js وأشكال ردودها، لكل جمهور:
   الموظفين (Bearer st.*)، والزبون (Bearer cu.*)، والأجهزة (X-Device-Token)،
   والعام من غير حساب.
   ============================================ */
import { ok, created, paged, noContent, file, stream } from '../core.js';
import {
  ApiError, MINUTE, V, audit, byId, check, customerPasswordIssue, insert, normalizePhone, nowIso, openState, optText,
  pageOf, permissionsOf, phoneOrNull, photoBlob, staffPasswordIssue, todayOf,
} from './base.js';
import {
  CHECKIN_WINDOW_MS, checkinCode, checkinExpiresAt, estimate, getTicket, loadState, probeStart, queue, roundedWait,
  staffView, sweep, ticketMinutes, touch,
} from './queue.js';
import {
  billing, cardSummaries, cards, customerCards, dailySales, dayClose, drawer, markBarberDay, methods, payroll,
  products, summary,
} from './money.js';
import { diffDays } from '../../../server/src/utils/dates.js';

const appUrl = () => `${window.location.origin}/app`;
const ACCESS_TTL = 3600;

/* ═══════════════════ الراوتر ═══════════════════ */

const table = [];
function on(method, pattern, handler) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:[a-zA-Z]+/g, (m) => {
    keys.push(m.slice(1));
    return '([^/]+)';
  }) + '/?$');
  table.push({ method, rx, keys, handler });
}

export function handle(req, db) {
  // المهل اللي فاتت (السيرفر بيشغّلها كمهمة دورية)
  sweep(db);
  for (const route of table) {
    if (route.method !== req.method) continue;
    const m = route.rx.exec(req.path);
    if (!m) continue;
    req.params = {};
    route.keys.forEach((k, i) => { req.params[k] = decodeURIComponent(m[i + 1]); });
    return route.handler(req, db);
  }
  return null;
}

const id = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw ApiError.unprocessable('تحقّق من البيانات المُدخلة', { code: 'VALIDATION_ERROR', details: { id: 'رقم غير صالح' } });
  return n;
};
const body = (req) => req.body || {};

/* ═══════════════════ المصادقة ═══════════════════ */

const bearer = (req) => {
  const h = req.header('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
};

function staff(req, db, permission) {
  const token = bearer(req);
  if (!token) throw ApiError.unauthorized('تسجيل الدخول مطلوب', { code: 'NO_TOKEN' });
  const parts = token.split('.');
  const user = parts[0] === 'st' ? byId(db.users, parts[1]) : null;
  if (!user || user.deleted_at) throw ApiError.unauthorized('انتهت الجلسة', { code: 'TOKEN_EXPIRED' });
  if (user.status !== 'active') throw ApiError.forbidden('الحساب موقوف', { code: 'ACCOUNT_SUSPENDED' });
  if (permission && !permissionsOf(user.role).includes(permission)) throw ApiError.forbidden('لا تملك صلاحية لهذا الإجراء', { code: 'FORBIDDEN' });
  return user;
}
const can = (user, permission) => permissionsOf(user.role).includes(permission);

function customer(req, db) {
  const token = bearer(req);
  if (!token) throw ApiError.unauthorized('تسجيل الدخول مطلوب', { code: 'NO_TOKEN' });
  const parts = token.split('.');
  const c = parts[0] === 'cu' ? byId(db.customers, parts[1]) : null;
  if (!c) throw ApiError.unauthorized('انتهت الجلسة', { code: 'TOKEN_EXPIRED' });
  if (c.status !== 'active') throw ApiError.forbidden('الحساب موقوف', { code: 'CUSTOMER_BLOCKED' });
  return c;
}

function device(req, db, type) {
  const token = req.header('X-Device-Token');
  if (!token) throw ApiError.unauthorized('الجهاز مش مربوط', { code: 'NO_DEVICE_TOKEN' });
  const d = db.devices.find((x) => x.token === token);
  if (!d || d.revoked_at) throw ApiError.unauthorized('الجهاز ده اتلغى — اربطه تاني بكود من المالك', { code: 'DEVICE_REVOKED' });
  if (d.type !== type) throw ApiError.forbidden('الجهاز ده مش للشاشة دي', { code: 'WRONG_DEVICE_TYPE' });
  d.last_seen_at = nowIso();
  return d;
}

const token = (kind, who) => `${kind}.${who}.${Math.random().toString(36).slice(2, 10)}`;

export function publicUser(db, u) {
  return {
    id: u.id, uuid: u.uuid, full_name: u.full_name, email: u.email, phone: u.phone, role: u.role,
    must_change_password: Boolean(u.must_change_password), shop: { id: 1, name: db.shop.name, slug: db.shop.slug },
    permissions: permissionsOf(u.role),
  };
}

export function staffSession(db, u) {
  db.cookies.staff = u.id;
  u.last_login_at = nowIso();
  return { user: publicUser(db, u), tokens: { access_token: token('st', u.id), token_type: 'Bearer', expires_in: ACCESS_TTL } };
}

export const publicCustomer = (c) => ({ id: c.id, uuid: c.uuid, name: c.name, phone: c.phone, email: c.email, created_at: c.created_at });

export function customerSession(db, c) {
  db.cookies.customer = c.id;
  return { customer: publicCustomer(c), tokens: { access_token: token('cu', c.id), token_type: 'Bearer', expires_in: ACCESS_TTL } };
}

/* ═══════════════════ الموظفين: الدخول والحساب ═══════════════════ */

on('POST', '/auth/login', (req, db) => {
  const b = body(req);
  check({ email: V.email(b.email, { required: true }), password: V.text(b.password, { required: true, max: 128 }) });
  const u = db.users.find((x) => x.email === String(b.email).trim().toLowerCase() && !x.deleted_at);
  if (!u || u.password !== b.password) throw ApiError.unauthorized('البريد أو كلمة المرور غير صحيحة', { code: 'BAD_CREDENTIALS' });
  if (u.status !== 'active') throw ApiError.forbidden('الحساب موقوف — كلّم صاحب المحل', { code: 'ACCOUNT_SUSPENDED' });
  audit(db, u, 'auth.login', 'user', u.id);
  return ok(staffSession(db, u));
});

on('POST', '/auth/refresh', (req, db) => {
  const u = db.cookies.staff ? byId(db.users, db.cookies.staff) : null;
  if (!u || u.deleted_at || u.status !== 'active') {
    db.cookies.staff = null;
    throw ApiError.unauthorized('مفيش جلسة — سجّل الدخول', { code: 'NO_SESSION' });
  }
  return ok(staffSession(db, u));
});

on('POST', '/auth/logout', (req, db) => {
  db.cookies.staff = null;
  return noContent();
});
on('POST', '/auth/logout-all', (req, db) => {
  staff(req, db);
  db.cookies.staff = null;
  return noContent();
});

on('GET', '/auth/me', (req, db) => ok(publicUser(db, staff(req, db))));
on('PATCH', '/auth/me', (req, db) => {
  const u = staff(req, db);
  const b = body(req);
  check({ full_name: b.full_name !== undefined ? V.text(b.full_name, { required: true, min: 2, max: 120 }) : null, phone: V.phone(b.phone) });
  if (b.full_name !== undefined) u.full_name = b.full_name.trim();
  if (b.phone !== undefined) u.phone = phoneOrNull(b.phone);
  return ok(publicUser(db, u));
});

on('POST', '/auth/change-password', (req, db) => {
  const u = staff(req, db);
  const b = body(req);
  if (b.current_password !== u.password) throw ApiError.badRequest('كلمة المرور الحالية غير صحيحة', { code: 'WRONG_PASSWORD', details: { current_password: 'غير صحيحة' } });
  check({ new_password: staffPasswordIssue(b.new_password) });
  u.password = b.new_password;
  u.must_change_password = false;
  audit(db, u, 'auth.password_changed', 'user', u.id);
  return ok(staffSession(db, u));
});

on('POST', '/auth/forgot-password', (req) => {
  check({ email: V.email(body(req).email, { required: true }) });
  return ok({ message: 'لو البريد مسجّل عندنا هيوصلك رابط الاستعادة خلال دقائق' });
});
on('POST', '/auth/reset-password', () => {
  throw ApiError.badRequest('الرابط غير صالح أو انتهت صلاحيته — في النسخة التجريبية البريد مش بيتبعت', { code: 'RESET_INVALID' });
});

on('GET', '/auth/sessions', (req, db) => {
  staff(req, db);
  return ok([{ id: 'demo', client_type: 'web', user_agent: navigator.userAgent, ip_address: '127.0.0.1', started_at: nowIso(Date.now() - 3600_000), last_active_at: nowIso(), current: true }]);
});
on('DELETE', '/auth/sessions/:familyId', (req, db) => {
  staff(req, db);
  return noContent();
});

/* ═══════════════════ الفريق ═══════════════════ */

const userRow = (u) => ({
  id: u.id, uuid: u.uuid, full_name: u.full_name, email: u.email, phone: u.phone, role: u.role, status: u.status,
  must_change_password: Boolean(u.must_change_password), last_login_at: u.last_login_at, created_at: u.created_at,
});

function findUser(db, uid) {
  const u = byId(db.users, uid);
  if (!u || u.deleted_at) throw ApiError.notFound('المستخدم غير موجود');
  return u;
}
const otherOwners = (db, exceptId) => db.users.filter((u) => u.role === 'owner' && u.status === 'active' && !u.deleted_at && u.id !== exceptId).length;
const tempPassword = () => `${Math.random().toString(36).slice(2, 8)}Ab${Math.floor(Math.random() * 90 + 10)}#7`;

on('GET', '/users', (req, db) => {
  staff(req, db, 'users.read');
  const q = req.query;
  const order = { owner: 0, manager: 1, cashier: 2 };
  return ok(db.users
    .filter((u) => !u.deleted_at && (!q.role || u.role === q.role) && (!q.status || u.status === q.status)
      && (!q.q || u.full_name.includes(q.q) || u.email.includes(q.q)))
    .sort((a, b) => order[a.role] - order[b.role] || a.full_name.localeCompare(b.full_name, 'ar'))
    .map(userRow));
});
on('GET', '/users/:id', (req, db) => {
  staff(req, db, 'users.read');
  return ok(userRow(findUser(db, id(req.params.id))));
});
on('POST', '/users', (req, db) => {
  const me = staff(req, db, 'users.write');
  const b = body(req);
  check({
    full_name: V.text(b.full_name, { required: true, min: 2, max: 120 }), email: V.email(b.email, { required: true }),
    phone: V.phone(b.phone), role: V.oneOf(b.role, ['owner', 'manager', 'cashier'], { required: true }),
    password: b.password ? staffPasswordIssue(b.password) : null,
  });
  const email = String(b.email).trim().toLowerCase();
  if (db.users.some((u) => u.email === email)) throw ApiError.conflict('البريد ده مستخدم بالفعل', { code: 'EMAIL_TAKEN', details: { email: 'مستخدم بالفعل' } });
  const invite = b.send_invite !== false && !b.password;
  const plain = b.password || tempPassword();
  const u = insert(db, 'users', {
    uuid: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), full_name: b.full_name.trim(), email, phone: phoneOrNull(b.phone),
    role: b.role, status: 'active', password: plain, must_change_password: true, last_login_at: null, created_at: nowIso(), deleted_at: null,
  });
  audit(db, me, 'user.create', 'user', u.id, undefined, userRow(u));
  return created({ user: userRow(u), temp_password: invite || b.password ? null : plain });
});
on('PATCH', '/users/:id', (req, db) => {
  const me = staff(req, db, 'users.write');
  const u = findUser(db, id(req.params.id));
  const b = body(req);
  check({
    full_name: b.full_name !== undefined ? V.text(b.full_name, { required: true, min: 2, max: 120 }) : null, phone: V.phone(b.phone),
    role: V.oneOf(b.role, ['owner', 'manager', 'cashier']), status: V.oneOf(b.status, ['active', 'suspended']),
  });
  const before = userRow(u);
  if (u.role === 'owner' && ((b.role && b.role !== 'owner') || b.status === 'suspended') && otherOwners(db, u.id) === 0) {
    throw ApiError.conflict('لازم يفضل مالك واحد على الأقل', { code: 'LAST_OWNER' });
  }
  if (u.id === me.id && b.status === 'suspended') throw ApiError.conflict('مينفعش توقف حسابك', { code: 'SELF_SUSPEND' });
  ['full_name', 'role', 'status'].forEach((k) => { if (b[k] !== undefined) u[k] = typeof b[k] === 'string' ? b[k].trim() : b[k]; });
  if (b.phone !== undefined) u.phone = phoneOrNull(b.phone);
  audit(db, me, 'user.update', 'user', u.id, before, userRow(u));
  return ok(userRow(u));
});
on('DELETE', '/users/:id', (req, db) => {
  const me = staff(req, db, 'users.write');
  const u = findUser(db, id(req.params.id));
  if (u.id === me.id) throw ApiError.conflict('مينفعش تمسح حسابك', { code: 'SELF_DELETE' });
  if (u.role === 'owner' && otherOwners(db, u.id) === 0) throw ApiError.conflict('لازم يفضل مالك واحد على الأقل', { code: 'LAST_OWNER' });
  u.deleted_at = nowIso();
  audit(db, me, 'user.delete', 'user', u.id, userRow(u));
  return noContent();
});
on('POST', '/users/:id/temp-password', (req, db) => {
  const me = staff(req, db, 'users.write');
  const u = findUser(db, id(req.params.id));
  const plain = tempPassword();
  u.password = plain;
  u.must_change_password = true;
  audit(db, me, 'user.temp_password', 'user', u.id);
  return ok({ temp_password: plain });
});

/* ═══════════════════ المحل ═══════════════════ */

const shopRow = (db) => {
  const s = Object.assign({}, db.shop);
  delete s.checkin_secret;
  return s;
};
const hoursNow = (db) => openState(db);

on('GET', '/shop', (req, db) => {
  staff(req, db, 'shop.read');
  return ok(Object.assign(shopRow(db), { settings: Object.assign({}, db.settings), hours: db.hours.slice(), now: hoursNow(db) }));
});
on('PATCH', '/shop', (req, db) => {
  const me = staff(req, db, 'shop.write');
  const b = body(req);
  check({ name: b.name !== undefined ? V.text(b.name, { required: true, max: 120 }) : null, phone: V.phone(b.phone), whatsapp: V.phone(b.whatsapp) });
  const before = shopRow(db);
  ['name', 'address', 'city', 'latitude', 'longitude', 'accepting_tickets'].forEach((k) => { if (b[k] !== undefined) db.shop[k] = b[k]; });
  if (b.phone !== undefined) db.shop.phone = phoneOrNull(b.phone);
  if (b.whatsapp !== undefined) db.shop.whatsapp = phoneOrNull(b.whatsapp);
  db.shop.updated_at = nowIso();
  if (b.accepting_tickets !== undefined) touch(db);
  audit(db, me, 'shop.update', 'shop', 1, before, shopRow(db));
  return ok(shopRow(db));
});
on('GET', '/shop/hours', (req, db) => {
  staff(req, db, 'shop.read');
  return ok({ periods: db.hours.slice(), now: hoursNow(db) });
});
on('PUT', '/shop/hours', (req, db) => {
  const me = staff(req, db, 'shop.write');
  const periods = body(req).periods;
  if (!Array.isArray(periods)) throw ApiError.unprocessable('تحقّق من البيانات المُدخلة', { code: 'VALIDATION_ERROR', details: { periods: 'الحقل مطلوب' } });
  const before = db.hours.slice();
  db.hours = periods.map((p) => ({ weekday: Number(p.weekday), opens_at: String(p.opens_at).slice(0, 5), closes_at: String(p.closes_at).slice(0, 5) }));
  touch(db);
  audit(db, me, 'shop.hours', 'shop', 1, before, db.hours);
  return ok({ periods: db.hours.slice(), now: hoursNow(db) });
});
on('GET', '/shop/settings', (req, db) => {
  staff(req, db, 'shop.read');
  return ok(Object.assign({}, db.settings));
});
on('PATCH', '/shop/settings', (req, db) => {
  const me = staff(req, db, 'shop.write');
  const changes = body(req);
  const before = Object.assign({}, db.settings);
  const merged = Object.assign({}, before, changes);
  if (merged.loyalty_reward_type === 'percent' && (merged.loyalty_reward_value < 1 || merged.loyalty_reward_value > 100)) {
    throw ApiError.unprocessable('نسبة الخصم من 1 لـ 100', { code: 'VALIDATION_ERROR', details: { loyalty_reward_value: 'من 1 لـ 100' } });
  }
  if (merged.loyalty_reward_type === 'amount' && merged.loyalty_reward_value < 1) {
    throw ApiError.unprocessable('اكتب مبلغ الخصم', { code: 'VALIDATION_ERROR', details: { loyalty_reward_value: 'اكتب المبلغ' } });
  }
  if (merged.loyalty_reward_type === 'service' && !(merged.loyalty_reward_service_id && byId(db.services, merged.loyalty_reward_service_id))) {
    throw ApiError.unprocessable('اختار الخدمة اللي هتبقى ببلاش', { code: 'VALIDATION_ERROR', details: { loyalty_reward_service_id: 'اختار خدمة' } });
  }
  Object.keys(changes).forEach((k) => {
    if (k in db.settings) db.settings[k] = k === 'receipt_width' ? Number(changes[k]) : changes[k];
  });
  touch(db);
  audit(db, me, 'shop.settings', 'shop', 1, before, Object.assign({}, db.settings));
  return ok(Object.assign({}, db.settings));
});

/* ═══════════════════ الخدمات ═══════════════════ */

const serviceRow = (s) => ({
  id: s.id, name: s.name, price: s.price, default_minutes: s.default_minutes, active: Boolean(s.active), sort_order: s.sort_order,
  archived_at: s.archived_at, created_at: s.created_at, updated_at: s.updated_at,
});
function findService(db, sid) {
  const s = byId(db.services, sid);
  if (!s) throw ApiError.notFound('الخدمة غير موجودة', { code: 'SERVICE_NOT_FOUND' });
  return s;
}
function serviceErrors(b, partial) {
  return {
    name: partial && b.name === undefined ? null : V.text(b.name, { required: true, max: 80 }),
    price: partial && b.price === undefined ? null : V.money(b.price, { required: true }),
    default_minutes: partial && b.default_minutes === undefined ? null : V.int(b.default_minutes, { required: true, min: 1, max: 480 }),
  };
}
function addService(db, b) {
  const order = db.services.reduce((max, s) => Math.max(max, s.sort_order), 0) + 10;
  return insert(db, 'services', {
    name: b.name.trim(), price: b.price, default_minutes: b.default_minutes, active: b.active ?? true, sort_order: order,
    archived_at: null, created_at: nowIso(), updated_at: nowIso(),
  });
}

on('GET', '/services', (req, db) => {
  staff(req, db, 'services.read');
  const all = req.query.include_archived === 'true' || req.query.include_archived === '1';
  return ok(db.services.filter((s) => all || !s.archived_at)
    .sort((a, b) => (a.archived_at !== null) - (b.archived_at !== null) || a.sort_order - b.sort_order || a.id - b.id).map(serviceRow));
});
on('POST', '/services', (req, db) => {
  const me = staff(req, db, 'services.write');
  check(serviceErrors(body(req)));
  const s = addService(db, body(req));
  audit(db, me, 'service.create', 'service', s.id, undefined, serviceRow(s));
  return created(serviceRow(s));
});
on('POST', '/services/bulk', (req, db) => {
  const me = staff(req, db, 'services.write');
  const items = body(req).items || [];
  items.forEach((item, i) => {
    const errs = serviceErrors(item);
    Object.keys(errs).forEach((k) => { if (errs[k]) check({ [`items.${i}.${k}`]: errs[k] }); });
  });
  const rows = items.map((item) => serviceRow(addService(db, item)));
  audit(db, me, 'service.bulk', 'service', null, undefined, { count: rows.length });
  return created(rows);
});
on('PUT', '/services/order', (req, db) => {
  staff(req, db, 'services.write');
  (body(req).ids || []).forEach((sid, i) => {
    const s = byId(db.services, sid);
    if (s) s.sort_order = (i + 1) * 10;
  });
  return ok(db.services.filter((s) => !s.archived_at).sort((a, b) => a.sort_order - b.sort_order).map(serviceRow));
});
on('PATCH', '/services/:id', (req, db) => {
  const me = staff(req, db, 'services.write');
  const s = findService(db, id(req.params.id));
  const b = body(req);
  check(serviceErrors(b, true));
  const before = serviceRow(s);
  ['name', 'price', 'default_minutes', 'active'].forEach((k) => { if (b[k] !== undefined) s[k] = typeof b[k] === 'string' ? b[k].trim() : b[k]; });
  s.updated_at = nowIso();
  audit(db, me, 'service.update', 'service', s.id, before, serviceRow(s));
  return ok(serviceRow(s));
});
on('DELETE', '/services/:id', (req, db) => {
  const me = staff(req, db, 'services.write');
  const s = findService(db, id(req.params.id));
  s.archived_at = s.archived_at || nowIso();
  audit(db, me, 'service.archive', 'service', s.id, serviceRow(s));
  return noContent();
});
on('POST', '/services/:id/restore', (req, db) => {
  staff(req, db, 'services.write');
  const s = findService(db, id(req.params.id));
  s.archived_at = null;
  return ok(serviceRow(s));
});

/* ═══════════════════ الحلاقين ═══════════════════ */

const barberRow = (b) => ({
  id: b.id, name: b.name, chair_no: b.chair_no, status: b.status, break_until: b.break_until, photo_path: b.photo_path || null,
  sort_order: b.sort_order, archived_at: b.archived_at, has_pin: Boolean(b.pin), created_at: b.created_at, updated_at: b.updated_at,
});
function findBarberRow(db, bid) {
  const b = byId(db.barbers, bid);
  if (!b) throw ApiError.notFound('الحلاق غير موجود', { code: 'BARBER_NOT_FOUND' });
  return b;
}
function chairFree(db, chairNo, exceptId = 0) {
  if (chairNo === null || chairNo === undefined) return;
  const taken = db.barbers.find((b) => b.chair_no === chairNo && !b.archived_at && b.id !== exceptId);
  if (taken) throw ApiError.conflict(`الكرسي ${chairNo} عليه ${taken.name}`, { code: 'CHAIR_TAKEN', details: { chair_no: `عليه ${taken.name}` } });
}
const pinError = (pin) => (/^\d{4}$/.test(String(pin || '')) ? null : 'الـ PIN لازم 4 أرقام');

export function setBarberStatus(db, b, status, breakMinutes) {
  if (b.archived_at) throw ApiError.conflict('الحلاق مؤرشف', { code: 'BARBER_ARCHIVED' });
  if (status === 'break') {
    b.status = 'break';
    b.break_until = nowIso(Date.now() + (breakMinutes || 15) * MINUTE);
  } else {
    b.status = status;
    b.break_until = null;
  }
  if (status === 'available') markBarberDay(db, b.id, todayOf(db));
}

on('GET', '/barbers', (req, db) => {
  staff(req, db, 'barbers.read');
  const all = req.query.include_archived === 'true' || req.query.include_archived === '1';
  return ok(db.barbers.filter((b) => all || !b.archived_at)
    .sort((a, b) => (a.archived_at !== null) - (b.archived_at !== null) || a.sort_order - b.sort_order || a.id - b.id).map(barberRow));
});
on('POST', '/barbers', (req, db) => {
  const me = staff(req, db, 'barbers.write');
  const b = body(req);
  check({ name: V.text(b.name, { required: true, max: 60 }), chair_no: V.int(b.chair_no, { min: 1, max: 99 }), pin: b.pin ? pinError(b.pin) : null });
  chairFree(db, b.chair_no);
  const order = db.barbers.reduce((max, x) => Math.max(max, x.sort_order), 0) + 10;
  const row = insert(db, 'barbers', {
    name: b.name.trim(), chair_no: b.chair_no ?? null, status: 'off', break_until: null, photo_path: null, sort_order: order, archived_at: null,
    pin: b.pin || null, failed_pins: 0, pin_locked_until: null, created_at: nowIso(), updated_at: nowIso(),
    pay_type: 'commission', service_pct: 4000, product_pct: 1000, daily_wage: 0, rent_amount: 0, rent_period: 'month', tips_to_barber: true,
  });
  audit(db, me, 'barber.create', 'barber', row.id, undefined, barberRow(row));
  return created(barberRow(row));
});
on('PUT', '/barbers/order', (req, db) => {
  staff(req, db, 'barbers.write');
  const ids = (body(req).ids || []).map(Number);
  const current = db.barbers.filter((b) => !b.archived_at).map((b) => b.id);
  if (ids.length !== current.length || new Set(ids).size !== ids.length || ids.some((x) => !current.includes(x))) {
    throw ApiError.badRequest('الترتيب لازم يشمل كل الحلاقين مرّة واحدة', { code: 'BAD_ORDER' });
  }
  ids.forEach((bid, i) => { byId(db.barbers, bid).sort_order = (i + 1) * 10; });
  touch(db);
  return ok(db.barbers.filter((b) => !b.archived_at).sort((a, b) => a.sort_order - b.sort_order).map(barberRow));
});
on('PATCH', '/barbers/:id', (req, db) => {
  const me = staff(req, db, 'barbers.write');
  const b = findBarberRow(db, id(req.params.id));
  const x = body(req);
  if (b.archived_at) throw ApiError.conflict('الحلاق مؤرشف — رجّعه الأول', { code: 'BARBER_ARCHIVED' });
  check({ name: x.name !== undefined ? V.text(x.name, { required: true, max: 60 }) : null, chair_no: V.int(x.chair_no, { min: 1, max: 99 }) });
  if (x.chair_no !== undefined) chairFree(db, x.chair_no, b.id);
  const before = barberRow(b);
  if (x.name !== undefined) b.name = x.name.trim();
  if (x.chair_no !== undefined) b.chair_no = x.chair_no;
  b.updated_at = nowIso();
  touch(db);
  audit(db, me, 'barber.update', 'barber', b.id, before, barberRow(b));
  return ok(barberRow(b));
});
on('PUT', '/barbers/:id/pin', (req, db) => {
  const me = staff(req, db, 'barbers.write');
  const b = findBarberRow(db, id(req.params.id));
  check({ pin: pinError(body(req).pin) });
  Object.assign(b, { pin: body(req).pin, failed_pins: 0, pin_locked_until: null });
  audit(db, me, 'barber.pin', 'barber', b.id);
  return ok(barberRow(b));
});
on('POST', '/barbers/:id/status', (req, db) => {
  const me = staff(req, db, 'barbers.status');
  const b = findBarberRow(db, id(req.params.id));
  const x = body(req);
  check({ status: V.oneOf(x.status, ['available', 'break', 'off'], { required: true }), break_minutes: V.int(x.break_minutes, { min: 1, max: 240 }) });
  const before = barberRow(b);
  setBarberStatus(db, b, x.status, x.break_minutes);
  touch(db);
  audit(db, me, 'barber.status', 'barber', b.id, before, barberRow(b));
  return ok(barberRow(b));
});
on('DELETE', '/barbers/:id', (req, db) => {
  const me = staff(req, db, 'barbers.write');
  const b = findBarberRow(db, id(req.params.id));
  if (db.tickets.some((t) => t.status === 'serving' && t.barber_id === b.id)) {
    throw ApiError.conflict('الحلاق معاه زبون على الكرسي — خلّص الأول', { code: 'BARBER_BUSY' });
  }
  audit(db, me, 'barber.archive', 'barber', b.id, barberRow(b));
  Object.assign(b, { archived_at: b.archived_at || nowIso(), status: 'off', break_until: null, chair_no: null });
  db.devices.forEach((d) => { if (d.current_barber_id === b.id) d.current_barber_id = null; });
  touch(db);
  return noContent();
});
on('POST', '/barbers/:id/restore', (req, db) => {
  staff(req, db, 'barbers.write');
  const b = findBarberRow(db, id(req.params.id));
  b.archived_at = null;
  touch(db);
  return ok(barberRow(b));
});

/* ═══════════════════ الطابور (اللوحة) ═══════════════════ */

const staffActor = (u) => ({ type: 'staff', id: u.id });

on('GET', '/queue', (req, db) => {
  staff(req, db, 'queue.read');
  return ok(queue.view(db, { since: req.query.since }));
});
on('GET', '/queue/stream', (req, db) => {
  staff(req, db, 'queue.read');
  return stream({ render: (d) => staffView(d, loadState(d)) });
});
on('GET', '/queue/tickets/:id', (req, db) => {
  staff(req, db, 'queue.read');
  return ok(getTicket(db, id(req.params.id)));
});
on('POST', '/queue/tickets', (req, db) => {
  const u = staff(req, db, 'queue.write');
  const b = body(req);
  check({
    name: V.text(b.name, { max: 60 }), phone: V.phone(b.phone),
    service_ids: Array.isArray(b.service_ids) && b.service_ids.length ? null : 'اختار خدمة واحدة على الأقل',
  });
  return created(queue.create(db, {
    source: 'staff', name: optText(b.name) || 'زبون', phone: phoneOrNull(b.phone), service_ids: b.service_ids, barber_id: b.barber_id ?? null,
  }, staffActor(u)));
});
on('POST', '/queue/tickets/:id/arrive', (req, db) => ok(queue.arrive(db, id(req.params.id), staffActor(staff(req, db, 'queue.write')))));
on('POST', '/queue/tickets/:id/cancel', (req, db) => ok(queue.cancel(db, id(req.params.id), staffActor(staff(req, db, 'queue.write')), optText(body(req).reason))));
on('POST', '/queue/tickets/:id/no-show', (req, db) => ok(queue.noShow(db, id(req.params.id), staffActor(staff(req, db, 'queue.write')))));
on('POST', '/queue/tickets/:id/assign', (req, db) => {
  const u = staff(req, db, 'queue.write');
  return ok(queue.assign(db, id(req.params.id), body(req).barber_id ?? null, staffActor(u)));
});
on('POST', '/queue/tickets/:id/services', (req, db) => {
  const u = staff(req, db, 'queue.write');
  return ok(queue.addService(db, id(req.params.id), id(body(req).service_id), staffActor(u)));
});
on('POST', '/queue/tickets/:id/move', (req, db) => {
  const u = staff(req, db, 'queue.manage');
  const b = body(req);
  check({ reason: V.text(b.reason, { required: true, min: 2, max: 190 }) });
  const result = queue.move(db, id(req.params.id), b.after_ticket_id ?? null, staffActor(u), b.reason.trim());
  audit(db, u, 'queue.move', 'ticket', id(req.params.id), undefined, Object.assign({}, result, { reason: b.reason }));
  return ok(result);
});
on('POST', '/queue/barbers/:barberId/next', (req, db) => ok(queue.next(db, id(req.params.barberId), staffActor(staff(req, db, 'queue.write')))));
on('POST', '/queue/barbers/:barberId/finish', (req, db) => ok(queue.finish(db, id(req.params.barberId), staffActor(staff(req, db, 'queue.write')))));

/* ═══════════════════ التقارير والسجل ═══════════════════ */

on('GET', '/reports/today', (req, db) => {
  staff(req, db, 'reports.read');
  const date = req.query.date || todayOf(db);
  return ok(summary(db, date, date));
});
on('GET', '/reports/range', (req, db) => {
  staff(req, db, 'reports.read');
  const { from, to } = req.query;
  check({ from: V.date(from, { required: true }), to: V.date(to, { required: true }) });
  if (to < from) throw ApiError.unprocessable('تحقّق من البيانات المُدخلة', { code: 'VALIDATION_ERROR', details: { to: '«لحد» لازم بعد «من»' } });
  if (diffDays(from, to) > 370) throw ApiError.unprocessable('أقصى فترة سنة', { code: 'VALIDATION_ERROR', details: { to: 'أقصى فترة سنة' } });
  return ok(Object.assign(summary(db, from, to), { days: dailySales(db, from, to) }));
});

on('GET', '/audit', (req, db) => {
  staff(req, db, 'audit.read');
  const q = req.query;
  const { page, pageSize } = pageOf(q, 25);
  const rows = db.audit
    .filter((a) => (!q.entity || a.entity === q.entity) && (!q.entity_id || a.entity_id === Number(q.entity_id))
      && (!q.action || a.action.startsWith(q.action)) && (!q.user_id || a.user_id === Number(q.user_id))
      && (!q.from || a.created_at.slice(0, 10) >= q.from) && (!q.to || a.created_at.slice(0, 10) <= q.to))
    .sort((a, b) => b.id - a.id);
  return paged(rows.slice((page - 1) * pageSize, page * pageSize).map((a) => {
    const u = a.user_id ? byId(db.users, a.user_id) : null;
    return {
      id: a.id, action: a.action, entity: a.entity, entity_id: a.entity_id, before_json: a.before_json, after_json: a.after_json,
      ip: a.ip, created_at: a.created_at, user_name: u ? u.full_name : null, user_role: u ? u.role : null,
    };
  }), { page, page_size: pageSize, total: rows.length, total_pages: Math.max(1, Math.ceil(rows.length / pageSize)) });
});

/* ═══════════════════ الكاشير ═══════════════════ */

function lineErrors(b) {
  if (b.product_id) return { product_id: null, qty: V.int(b.qty, { min: 1, max: 999 }) };
  return { service_id: b.service_id ? null : 'الحقل مطلوب' };
}

on('GET', '/bills', (req, db) => {
  staff(req, db, 'billing.use');
  const { rows, meta } = billing.list(db, req.query);
  return paged(rows, meta);
});
on('POST', '/bills', (req, db) => {
  const u = staff(req, db, 'billing.use');
  const b = body(req);
  check({ customer_name: V.text(b.customer_name, { max: 60 }), customer_phone: V.phone(b.customer_phone) });
  return created(billing.createCounter(db, {
    customer_name: optText(b.customer_name), customer_phone: phoneOrNull(b.customer_phone), barber_id: b.barber_id ?? null, items: b.items || [],
  }, u.id));
});
on('POST', '/bills/for-ticket/:ticketId', (req, db) => ok(billing.openForTicket(db, id(req.params.ticketId), staff(req, db, 'billing.use').id)));
on('GET', '/bills/:id', (req, db) => {
  staff(req, db, 'billing.use');
  return ok(billing.get(db, id(req.params.id)));
});
on('POST', '/bills/:id/items', (req, db) => {
  staff(req, db, 'billing.use');
  check(lineErrors(body(req)));
  return ok(billing.addItem(db, id(req.params.id), body(req)));
});
on('DELETE', '/bills/:id/items/:itemId', (req, db) => {
  const u = staff(req, db, 'billing.use');
  return ok(billing.removeItem(db, id(req.params.id), id(req.params.itemId), { canDiscount: can(u, 'billing.discount') }));
});
on('POST', '/bills/:id/checkout', (req, db) => {
  const u = staff(req, db, 'billing.use');
  const b = body(req);
  check({ discount: V.money(b.discount), tip: V.money(b.tip), discount_reason: V.text(b.discount_reason, { max: 190 }) });
  (b.payments || []).forEach((p, i) => check({ [`payments.${i}.amount`]: V.money(p.amount, { required: true, positive: true }) }));
  const bill = billing.checkout(db, id(req.params.id), Object.assign({}, b, { discount_reason: optText(b.discount_reason) }), u, { canDiscount: can(u, 'billing.discount') });
  audit(db, u, 'bill.checkout', 'bill', bill.id, undefined, { total: bill.total, tip: bill.tip, discount: bill.discount, reward: bill.reward_discount, payments: b.payments });
  return ok(bill);
});
on('POST', '/bills/:id/void', (req, db) => {
  const u = staff(req, db, 'billing.use');
  check({ reason: V.text(body(req).reason, { required: true }) });
  const { before, after } = billing.void(db, id(req.params.id), body(req).reason.trim(), u, { canRefund: can(u, 'billing.refund') });
  audit(db, u, 'bill.void', 'bill', after.id, { subtotal: before.subtotal, items: before.items.length }, { reason: body(req).reason });
  return ok(after);
});
on('POST', '/bills/:id/refund', (req, db) => {
  const u = staff(req, db, 'billing.refund');
  const b = body(req);
  check({ amount: V.money(b.amount, { required: true, positive: true }), method: V.text(b.method, { required: true, max: 24 }), reason: V.text(b.reason, { required: true }) });
  const bill = billing.refund(db, id(req.params.id), b, u);
  audit(db, u, 'bill.refund', 'bill', bill.id, undefined, b);
  return ok(bill);
});
on('GET', '/bills/:id/receipt', (req, db) => {
  staff(req, db, 'billing.use');
  return ok(billing.receipt(db, id(req.params.id)));
});

on('GET', '/payment-methods', (req, db) => {
  staff(req, db, 'billing.use');
  return ok(methods.list(db));
});
on('POST', '/payment-methods', (req, db) => {
  const u = staff(req, db, 'payments.manage');
  const b = body(req);
  check({ label: V.text(b.label, { required: true, max: 40 }), kind: V.oneOf(b.kind, ['card', 'wallet', 'transfer', 'other'], { required: true }) });
  const row = methods.create(db, { label: b.label.trim(), kind: b.kind });
  audit(db, u, 'payment_method.create', 'payment_method', row.id, undefined, row);
  return created(row);
});
on('PATCH', '/payment-methods/:id', (req, db) => {
  const u = staff(req, db, 'payments.manage');
  const { before, after } = methods.update(db, id(req.params.id), body(req));
  audit(db, u, 'payment_method.update', 'payment_method', after.id, before, after);
  return ok(after);
});

on('GET', '/drawer/current', (req, db) => {
  staff(req, db, 'billing.use');
  return ok(drawer.current(db));
});
on('GET', '/drawer/sessions', (req, db) => {
  staff(req, db, 'billing.use');
  return ok(drawer.sessions(db));
});
on('GET', '/drawer/sessions/:id', (req, db) => {
  staff(req, db, 'billing.use');
  return ok(drawer.get(db, id(req.params.id)));
});
on('POST', '/drawer/open', (req, db) => {
  const u = staff(req, db, 'billing.use');
  check({ opening_float: V.money(body(req).opening_float, { required: true }) });
  const s = drawer.open(db, body(req).opening_float, u.id);
  audit(db, u, 'drawer.open', 'drawer', s.id, undefined, { opening_float: s.opening_float });
  return created(s);
});
on('POST', '/drawer/movements', (req, db) => {
  const u = staff(req, db, 'billing.use');
  if (!can(u, 'drawer.expense')) throw ApiError.forbidden('لا تملك صلاحية لهذا الإجراء', { code: 'FORBIDDEN' });
  const b = body(req);
  check({
    type: V.oneOf(b.type, ['expense', 'advance', 'cash_in', 'cash_out'], { required: true }), amount: V.money(b.amount, { required: true, positive: true }),
    note: ['expense', 'cash_out'].includes(b.type) && !optText(b.note) ? 'اكتب الحركة دي إيه' : V.text(b.note, { max: 190 }),
  });
  const result = drawer.movement(db, Object.assign({}, b, { note: optText(b.note) }), u, { canAdvance: can(u, 'drawer.advance') });
  audit(db, u, `drawer.${b.type}`, 'drawer', result.session.id, undefined, b);
  return created(result.session);
});
on('POST', '/drawer/close', (req, db) => {
  const u = staff(req, db, 'billing.use');
  check({ counted_cash: V.money(body(req).counted_cash, { required: true }) });
  const s = drawer.close(db, body(req).counted_cash, optText(body(req).note), u.id);
  audit(db, u, 'drawer.close', 'drawer', s.id, undefined, { expected: s.expected_cash, counted: s.counted_cash, variance: s.variance });
  return ok(s);
});

on('GET', '/day-close/preview', (req, db) => {
  staff(req, db, 'dayclose.close');
  return ok(dayClose.preview(db));
});
on('POST', '/day-close', (req, db) => {
  const u = staff(req, db, 'dayclose.close');
  const close = dayClose.close(db, optText(body(req).note), u.id);
  audit(db, u, 'dayclose.close', 'day_close', close.id, undefined, { number: close.number, sales: close.summary.sales });
  return created(close);
});
on('GET', '/day-close', (req, db) => {
  staff(req, db, 'dayclose.close');
  return ok(dayClose.list(db));
});
on('GET', '/day-close/:id', (req, db) => {
  staff(req, db, 'dayclose.close');
  return ok(dayClose.get(db, id(req.params.id)));
});

/* ═══════════════════ المنتجات ═══════════════════ */

function productErrors(b, partial) {
  const need = (k) => !(partial && b[k] === undefined);
  return {
    name: need('name') ? V.text(b.name, { required: true, max: 80 }) : null,
    price: need('price') ? V.money(b.price, { required: true }) : null,
    cost: V.money(b.cost),
    barcode: b.barcode ? V.text(b.barcode, { max: 40 }) : null,
    low_stock_at: V.int(b.low_stock_at, { min: 0, max: 100000 }),
    initial_qty: V.int(b.initial_qty, { min: 0, max: 100000 }),
  };
}

on('GET', '/products', (req, db) => {
  staff(req, db, 'products.read');
  const all = req.query.include_archived === 'true' || req.query.include_archived === '1';
  return ok(products.list(db, { includeArchived: all, q: (req.query.q || '').trim() || undefined }));
});
on('GET', '/products/lookup', (req, db) => {
  staff(req, db, 'products.read');
  check({ barcode: V.text(req.query.barcode, { required: true, max: 40 }) });
  return ok(products.lookup(db, req.query.barcode.trim()));
});
on('POST', '/products', (req, db) => {
  const u = staff(req, db, 'products.write');
  check(productErrors(body(req)));
  const b = body(req);
  const row = products.create(db, Object.assign({}, b, { name: b.name.trim(), barcode: optText(b.barcode) }), u.id);
  audit(db, u, 'product.create', 'product', row.id, undefined, row);
  return created(row);
});
on('GET', '/products/:id', (req, db) => {
  staff(req, db, 'products.read');
  return ok(products.get(db, id(req.params.id)));
});
on('PATCH', '/products/:id', (req, db) => {
  const u = staff(req, db, 'products.write');
  check(productErrors(body(req), true));
  const b = Object.assign({}, body(req));
  if (b.barcode !== undefined) b.barcode = optText(b.barcode);
  const { before, after } = products.update(db, id(req.params.id), b);
  audit(db, u, 'product.update', 'product', after.id, before, after);
  return ok(after);
});
on('DELETE', '/products/:id', (req, db) => {
  const u = staff(req, db, 'products.write');
  const before = products.archive(db, id(req.params.id));
  audit(db, u, 'product.archive', 'product', before.id, before);
  return noContent();
});
on('POST', '/products/:id/restore', (req, db) => {
  staff(req, db, 'products.write');
  return ok(products.restore(db, id(req.params.id)));
});
on('POST', '/products/:id/stock', (req, db) => {
  const u = staff(req, db, 'stock.write');
  const b = body(req);
  check({
    type: V.oneOf(b.type, ['purchase', 'use', 'adjust'], { required: true }),
    qty: b.type === 'adjust' ? null : V.int(b.qty, { required: true, min: 1, max: 100000 }),
    counted_qty: b.type === 'adjust' ? V.int(b.counted_qty, { required: true, min: -100000, max: 100000 }) : null,
    note: b.type === 'adjust' ? V.text(b.note, { required: true }) : null,
    unit_cost: V.money(b.unit_cost),
  });
  const row = products.stock(db, id(req.params.id), b, u.id);
  audit(db, u, `stock.${b.type}`, 'product', row.id, undefined, b);
  return ok(row);
});
on('GET', '/products/:id/movements', (req, db) => {
  staff(req, db, 'products.read');
  return ok(products.movements(db, id(req.params.id)));
});

/* ═══════════════════ حساب الحلاقين ═══════════════════ */

on('GET', '/payroll/barbers', (req, db) => {
  staff(req, db, 'payroll.read');
  return ok(payroll.barbers(db));
});
on('PUT', '/payroll/barbers/:id', (req, db) => {
  const u = staff(req, db, 'payroll.write');
  const b = body(req);
  check({
    pay_type: V.oneOf(b.pay_type, ['commission', 'salary', 'chair_rent'], { required: true }),
    rent_period: V.oneOf(b.rent_period, ['day', 'week', 'month'], { required: true }),
    service_pct: V.int(b.service_pct, { required: true, min: 0, max: 10000 }), product_pct: V.int(b.product_pct, { required: true, min: 0, max: 10000 }),
    daily_wage: V.money(b.daily_wage, { required: true }), rent_amount: V.money(b.rent_amount, { required: true }),
  });
  const { before, after } = payroll.setPay(db, id(req.params.id), b);
  audit(db, u, 'payroll.pay', 'barber', after.id, before, after);
  return ok(after);
});
on('GET', '/payroll/preview', (req, db) => {
  staff(req, db, 'payroll.read');
  check({ barber_id: req.query.barber_id ? null : 'الحقل مطلوب', to: V.date(req.query.to) });
  return ok(payroll.preview(db, id(req.query.barber_id), req.query.to));
});
on('POST', '/payroll/settlements', (req, db) => {
  const u = staff(req, db, 'payroll.write');
  const b = body(req);
  check({ barber_id: b.barber_id ? null : 'الحقل مطلوب', via: V.oneOf(b.via, ['drawer', 'outside'], { required: true }), to: V.date(b.to) });
  const s = payroll.settle(db, id(b.barber_id), b, u);
  audit(db, u, 'payroll.settle', 'barber_settlement', s.id, undefined, { net: s.net, via: s.settled_via });
  return created(s);
});
on('GET', '/payroll/settlements', (req, db) => {
  staff(req, db, 'payroll.read');
  return ok(payroll.list(db, req.query.barber_id));
});
on('GET', '/payroll/settlements/:id', (req, db) => {
  staff(req, db, 'payroll.read');
  return ok(payroll.get(db, id(req.params.id)));
});

/* ═══════════════════ كروت الزباين ═══════════════════ */

on('GET', '/cards', (req, db) => {
  staff(req, db, 'cards.read');
  const { rows, meta } = cards.list(db, req.query);
  return paged(rows, meta);
});
on('GET', '/cards/reminders', (req, db) => {
  staff(req, db, 'cards.read');
  return ok(cards.dueReminders(db));
});
on('GET', '/cards/:id', (req, db) => {
  staff(req, db, 'cards.read');
  return ok(cards.get(db, id(req.params.id)));
});
on('PATCH', '/cards/:id', (req, db) => {
  const u = staff(req, db, 'cards.write');
  const b = body(req);
  check({ name: b.name !== undefined ? V.text(b.name, { required: true, max: 60 }) : null, notes: V.text(b.notes, { max: 1000 }) });
  const changes = {};
  if (b.name !== undefined) changes.name = b.name.trim();
  if (b.notes !== undefined) changes.notes = optText(b.notes);
  if (b.reminders_off !== undefined) changes.reminders_off = Boolean(b.reminders_off);
  const { before, after } = cards.update(db, id(req.params.id), changes);
  audit(db, u, 'card.update', 'card', after.id, before, after);
  return ok(after);
});
on('POST', '/cards/:id/stamps', (req, db) => {
  const u = staff(req, db, 'cards.stamps');
  const b = body(req);
  check({ delta: b.delta === 0 ? 'التعديل مينفعش يبقى صفر' : V.int(b.delta, { required: true, min: -50, max: 50 }), note: V.text(b.note, { required: true }) });
  const result = cards.adjustStamps(db, id(req.params.id), b.delta, b.note.trim(), u.id);
  audit(db, u, 'card.stamps', 'card', id(req.params.id), undefined, Object.assign({}, b, { stamps: result.stamps }));
  return ok(result);
});
on('POST', '/cards/:id/link-code', (req, db) => {
  const u = staff(req, db, 'cards.write');
  const result = cards.issueLinkCode(db, id(req.params.id), u.id);
  audit(db, u, 'card.link_code', 'card', result.card.id, undefined, { name: result.card.name });
  return ok(result);
});
on('POST', '/cards/:id/reminded', (req, db) => {
  staff(req, db, 'cards.write');
  return ok(cards.markReminded(db, id(req.params.id)));
});
on('GET', '/cards/:id/photos/:photoId', (req, db) => {
  staff(req, db, 'cards.read');
  const p = cards.photo(db, id(req.params.photoId), { cardId: id(req.params.id) });
  return file(photoBlob(p));
});
on('POST', '/cards/:id/photos', (req, db) => {
  const u = staff(req, db, 'cards.write');
  const photo = cards.addPhoto(db, id(req.params.id), req.upload, {
    ticketId: req.query.ticket_id ? Number(req.query.ticket_id) : null, takenBy: 'staff', takenById: u.id,
  });
  return created(photo);
});
on('DELETE', '/cards/:id/photos/:photoId', (req, db) => {
  const u = staff(req, db, 'cards.write');
  cards.deletePhoto(db, id(req.params.photoId), id(req.params.id));
  audit(db, u, 'card.photo_delete', 'card', id(req.params.id));
  return noContent();
});

/* ═══════════════════ وضع المحل (برنامج الكمبيوتر بس) ═══════════════════ */

on('GET', '/hub', (req, db) => {
  staff(req, db, 'hub.manage');
  return ok({
    enabled: false, addresses: [], api_port: 4030, customer_port: null, serves_panel: false, serves_customer: false,
    backup: { enabled: false, every_hours: 6, keep: 28, copy_dir: null, latest: null },
  });
});
on('GET', '/hub/backups', (req, db) => {
  staff(req, db, 'hub.manage');
  return ok([]);
});
const hubOnly = () => {
  throw ApiError.conflict('النسخ الاحتياطية في برنامج الكمبيوتر بس (وضع المحل) — مش في النسخة التجريبية', { code: 'HUB_DISABLED' });
};
on('POST', '/hub/backups', (req, db) => {
  staff(req, db, 'hub.manage');
  return hubOnly();
});
on('POST', '/hub/backups/restore', (req, db) => {
  staff(req, db, 'hub.manage');
  return hubOnly();
});

/* ═══════════════════ الأجهزة: الربط ═══════════════════ */

const TYPE_LABELS = { display: 'شاشة التلفزيون', kiosk: 'تابلت الباب', chair: 'تابلت الكرسي' };

on('GET', '/devices', (req, db) => {
  staff(req, db, 'devices.manage');
  return ok(db.devices.filter((d) => !d.revoked_at).sort((a, b) => a.type.localeCompare(b.type) || a.id - b.id).map((d) => ({
    id: d.id, type: d.type, name: d.name, last_seen_at: d.last_seen_at, created_at: d.created_at, current_barber_id: d.current_barber_id,
    current_barber_name: d.current_barber_id ? (byId(db.barbers, d.current_barber_id) || {}).name || null : null,
  })));
});
on('POST', '/devices/pairing-code', (req, db) => {
  const u = staff(req, db, 'devices.manage');
  const b = body(req);
  check({ type: V.oneOf(b.type, ['display', 'kiosk', 'chair'], { required: true }), name: V.text(b.name, { max: 60 }) });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  db.pairings.push({ code, type: b.type, name: optText(b.name) || TYPE_LABELS[b.type], expires_at: nowIso(Date.now() + 10 * MINUTE), used_at: null });
  audit(db, u, 'device.pairing_code', 'device', null, undefined, { type: b.type });
  return created({ code, type: b.type, expires_in_minutes: 10 });
});
export function pairDevice(db, { type, name }) {
  return insert(db, 'devices', {
    type, name, token: `dv.${type}.${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`, created_at: nowIso(), last_seen_at: nowIso(),
    current_barber_id: null, revoked_at: null,
  });
}
on('POST', '/devices/pair', (req, db) => {
  const code = String(body(req).code || '');
  check({ code: /^\d{6}$/.test(code) ? null : 'الكود 6 أرقام' });
  const p = db.pairings.find((x) => x.code === code && !x.used_at && x.expires_at > nowIso());
  if (!p) throw ApiError.notFound('الكود غلط أو انتهى — اطلب كود جديد من المالك', { code: 'PAIRING_INVALID' });
  p.used_at = nowIso();
  const d = pairDevice(db, p);
  return created({ token: d.token, device: { id: d.id, type: d.type, name: d.name, shop: { name: db.shop.name, slug: db.shop.slug } } });
});
on('PATCH', '/devices/:id', (req, db) => {
  staff(req, db, 'devices.manage');
  check({ name: V.text(body(req).name, { required: true, max: 60 }) });
  const d = byId(db.devices, id(req.params.id));
  if (!d || d.revoked_at) throw ApiError.notFound('الجهاز غير موجود', { code: 'DEVICE_NOT_FOUND' });
  d.name = body(req).name.trim();
  return noContent();
});
on('DELETE', '/devices/:id', (req, db) => {
  const u = staff(req, db, 'devices.manage');
  const d = byId(db.devices, id(req.params.id));
  if (!d || d.revoked_at) throw ApiError.notFound('الجهاز غير موجود', { code: 'DEVICE_NOT_FOUND' });
  d.revoked_at = nowIso();
  d.current_barber_id = null;
  audit(db, u, 'device.revoke', 'device', d.id, { type: d.type, name: d.name });
  touch(db);
  return noContent();
});

/* ═══════════════════ شاشة التلفزيون ═══════════════════ */

export function displayName(name, style) {
  if (style === 'number_only' || !name) return null;
  const parts = String(name).trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${Array.from(parts[1])[0]}.` : parts[0];
}

export function displayView(db) {
  const now = new Date();
  const state = loadState(db, now);
  const style = db.settings.display_name_style;
  const serving = new Map(state.tickets.filter((t) => t.status === 'serving').map((t) => [t.barber_id, t]));
  const code = checkinCode(db, now);
  const anyone = probeStart(state);
  return {
    version: `${state.version}:${Math.floor(now.getTime() / CHECKIN_WINDOW_MS)}`,
    now: now.toISOString(),
    shop: { name: db.shop.name, slug: db.shop.slug },
    open: openState(db, now),
    accepting_tickets: Boolean(db.shop.accepting_tickets),
    wait_minutes: roundedWait(anyone && anyone.start ? anyone.start : null, now),
    waiting_count: state.waiting().length,
    barbers: state.barbers.filter((b) => b.status !== 'off' || serving.has(b.id)).map((b) => {
      const t = serving.get(b.id);
      return {
        id: b.id, name: b.name, chair_no: b.chair_no, status: b.status, break_until: b.break_until ? b.break_until.toISOString() : null,
        photo_path: b.photo_path, serving: t ? { number: t.number, name: displayName(t.name, style) } : null,
      };
    }),
    next: state.waiting().slice(0, 5).map((t) => ({
      number: t.number, name: displayName(t.name, style), barber_id: t.preferred_barber_id, called: Boolean(t.called_at) && !t.arrived_at,
    })),
    checkin: { code, expires_at: checkinExpiresAt(now).toISOString(), url: `${appUrl()}/checkin/${db.shop.slug}?code=${code}` },
    take_url: `${appUrl()}/s/${db.shop.slug}`,
  };
}

on('GET', '/display/queue', (req, db) => {
  device(req, db, 'display');
  return ok(displayView(db));
});
on('GET', '/display/stream', (req, db) => {
  device(req, db, 'display');
  return stream({ render: (d) => displayView(d), tickMs: 5000 });
});

/* ═══════════════════ صفحة المحل العامة والكشك ═══════════════════ */

export function publicShopView(db) {
  const state = loadState(db);
  const { now } = state;
  const s = db.shop;
  const anyone = probeStart(state, null);
  return {
    version: state.version,
    id: 1, name: s.name, slug: s.slug, phone: s.phone, whatsapp: s.whatsapp, address: s.address, city: s.city,
    latitude: s.latitude, longitude: s.longitude,
    now: now.toISOString(),
    open: openState(db, now),
    accepting_tickets: Boolean(s.accepting_tickets),
    remote_tickets_enabled: Boolean(db.settings.remote_tickets_enabled),
    hours: db.hours.slice(),
    services: db.services.filter((x) => !x.archived_at && x.active).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
      .map((x) => ({ id: x.id, name: x.name, price: x.price, default_minutes: x.default_minutes })),
    waiting_count: state.waiting().length,
    wait_minutes: roundedWait(anyone && anyone.start ? anyone.start : null, now),
    barbers: state.barbers.filter((b) => b.status !== 'off').map((b) => {
      const p = probeStart(state, b.id);
      return { id: b.id, name: b.name, chair_no: b.chair_no, status: b.status, photo_path: b.photo_path, wait_minutes: roundedWait(p && p.start ? p.start : null, now) };
    }),
  };
}

function findShop(db, slug) {
  if (slug !== db.shop.slug) throw ApiError.notFound('المحل غير موجود', { code: 'SHOP_NOT_FOUND' });
}

on('GET', '/public/push-key', () => ok({ public_key: null }));
on('GET', '/public/shops/:slug', (req, db) => {
  findShop(db, req.params.slug);
  return ok(publicShopView(db));
});
on('GET', '/public/shops/:slug/stream', (req, db) => {
  findShop(db, req.params.slug);
  return stream({ render: (d) => publicShopView(d) });
});

on('GET', '/kiosk/options', (req, db) => {
  device(req, db, 'kiosk');
  return ok(publicShopView(db));
});
on('POST', '/kiosk/tickets', (req, db) => {
  const d = device(req, db, 'kiosk');
  const b = body(req);
  check({ name: V.text(b.name, { max: 60 }), phone: V.phone(b.phone), service_ids: Array.isArray(b.service_ids) && b.service_ids.length ? null : 'اختار خدمة واحدة على الأقل' });
  const t = queue.create(db, {
    source: 'kiosk', name: optText(b.name) || 'زبون', phone: phoneOrNull(b.phone), service_ids: b.service_ids, barber_id: b.barber_id ?? null,
  }, { type: 'kiosk', id: d.id });
  return created({
    id: t.id, number: t.number, name: t.name, services: t.services.map((s) => s.name), total: t.total, ahead: t.ahead,
    wait_minutes: roundedWait(t.eta ? new Date(t.eta) : null, new Date()),
  });
});
on('POST', '/kiosk/tickets/:id/cancel', (req, db) => {
  const d = device(req, db, 'kiosk');
  const tid = id(req.params.id);
  const mine = db.ticketEvents.find((e) => e.ticket_id === tid && e.type === 'created' && e.actor_type === 'kiosk' && e.actor_id === d.id);
  if (!mine) throw ApiError.notFound('الدور غير موجود', { code: 'TICKET_NOT_FOUND' });
  return ok(queue.cancel(db, tid, { type: 'kiosk', id: d.id }, 'kiosk_undo'));
});

/* ═══════════════════ تابلت الكرسي ═══════════════════ */

export function chairView(db, barberId) {
  const now = new Date();
  const state = loadState(db, now);
  const barber = state.barbers.find((b) => b.id === barberId);
  if (!barber) throw ApiError.conflict('الحلاق ده اتشال — اخرج وادخل تاني', { code: 'CHAIR_SIGNED_OUT' });
  const current = state.tickets.find((t) => t.status === 'serving' && t.barber_id === barberId);
  const mine = state.waiting().filter((t) => t.preferred_barber_id === null || t.preferred_barber_id === barberId);
  const halfHourAgo = nowIso(Date.now() - 30 * MINUTE);
  const recent = db.tickets
    .filter((t) => t.barber_id === barberId && t.status === 'done' && t.shop_customer_id && t.finished_at > halfHourAgo)
    .sort((a, b) => b.finished_at.localeCompare(a.finished_at) || b.id - a.id)[0];
  const summaries = cardSummaries(db, [current && current.shop_customer_id].concat(mine.slice(0, 2).map((t) => t.shop_customer_id)));
  const cardFor = (cid) => {
    const c = summaries.get(cid);
    return c ? { id: c.id, notes: c.notes, visits: c.visits, last_photo_id: c.last_photo_id, loyalty: c.loyalty } : null;
  };
  return {
    version: state.version,
    now: now.toISOString(),
    barber: { id: barber.id, name: barber.name, chair_no: barber.chair_no, status: barber.status, break_until: barber.break_until ? barber.break_until.toISOString() : null },
    serving: current ? {
      id: current.id, number: current.number, name: current.name, services: current.services.map((s) => s.name), total: current.total,
      started_at: current.started_at ? current.started_at.toISOString() : null,
      expected_minutes: Math.round(ticketMinutes(current, barberId, state.stats)), card: cardFor(current.shop_customer_id),
    } : null,
    recent: recent ? {
      id: recent.id, number: recent.number, name: recent.name, card_id: recent.shop_customer_id,
      has_photo: db.photos.some((p) => p.ticket_id === recent.id && !p.deleted_at),
    } : null,
    next: mine.slice(0, 2).map((t) => ({
      id: t.id, number: t.number, name: t.name, arrived: Boolean(t.arrived_at), called: Boolean(t.called_at),
      for_me: t.preferred_barber_id === barberId, card: cardFor(t.shop_customer_id),
    })),
    waiting_for_me: mine.length,
    services: db.services.filter((s) => !s.archived_at && s.active).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
      .map((s) => ({ id: s.id, name: s.name, price: s.price })),
  };
}

function requireBarber(d) {
  if (!d.current_barber_id) throw ApiError.conflict('مفيش حلاق داخل على التابلت ده — اختار اسمك واكتب الـ PIN', { code: 'CHAIR_SIGNED_OUT' });
  return d.current_barber_id;
}
const chairActor = (d) => ({ type: 'chair', id: d.id });

on('GET', '/chair/barbers', (req, db) => {
  const d = device(req, db, 'chair');
  return ok({
    current_barber_id: d.current_barber_id,
    barbers: db.barbers.filter((b) => !b.archived_at).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id).map((b) => ({
      id: b.id, name: b.name, chair_no: b.chair_no, status: b.status, has_pin: Boolean(b.pin),
      locked: Boolean(b.pin_locked_until && b.pin_locked_until > nowIso()),
    })),
  });
});
on('POST', '/chair/login', (req, db) => {
  const d = device(req, db, 'chair');
  const b = body(req);
  check({ barber_id: b.barber_id ? null : 'الحقل مطلوب', pin: /^\d{4}$/.test(String(b.pin || '')) ? null : 'الـ PIN لازم 4 أرقام' });
  const barber = db.barbers.find((x) => x.id === Number(b.barber_id) && !x.archived_at);
  if (!barber) throw ApiError.notFound('الحلاق غير موجود', { code: 'BARBER_NOT_FOUND' });
  if (!barber.pin) throw ApiError.conflict('المالك لسه ما حطّش PIN للحلاق ده', { code: 'NO_PIN' });
  if (barber.pin_locked_until && barber.pin_locked_until > nowIso()) {
    const minutes = Math.max(1, Math.ceil((Date.parse(barber.pin_locked_until) - Date.now()) / MINUTE));
    throw ApiError.locked(`الـ PIN مقفول — جرّب بعد ${minutes} دقيقة أو اطلب من المالك PIN جديد`, { code: 'PIN_LOCKED' });
  }
  if (barber.pin !== b.pin) {
    barber.failed_pins += 1;
    if (barber.failed_pins >= 5) {
      barber.failed_pins = 0;
      barber.pin_locked_until = nowIso(Date.now() + 15 * MINUTE);
    }
    throw ApiError.unauthorized('الـ PIN غلط', { code: 'BAD_PIN' });
  }
  barber.failed_pins = 0;
  barber.pin_locked_until = null;
  db.devices.forEach((x) => { if (x.current_barber_id === barber.id && x.id !== d.id) x.current_barber_id = null; });
  d.current_barber_id = barber.id;
  if (barber.status === 'off') {
    barber.status = 'available';
    barber.break_until = null;
  }
  markBarberDay(db, barber.id, todayOf(db));
  touch(db);
  return ok(chairView(db, barber.id));
});
on('POST', '/chair/logout', (req, db) => {
  const d = device(req, db, 'chair');
  d.current_barber_id = null;
  return ok({ signed_out: true });
});
on('GET', '/chair/queue', (req, db) => {
  const d = device(req, db, 'chair');
  return ok(chairView(db, requireBarber(d)));
});
on('GET', '/chair/stream', (req, db) => {
  const d = device(req, db, 'chair');
  const barberId = requireBarber(d);
  return stream({ render: (x) => chairView(x, barberId) });
});
on('POST', '/chair/next', (req, db) => {
  const d = device(req, db, 'chair');
  const barberId = requireBarber(d);
  const result = queue.next(db, barberId, chairActor(d));
  return ok(Object.assign({}, result, { view: chairView(db, barberId) }));
});
on('POST', '/chair/finish', (req, db) => {
  const d = device(req, db, 'chair');
  const barberId = requireBarber(d);
  const result = queue.finish(db, barberId, chairActor(d));
  return ok(Object.assign({}, result, { view: chairView(db, barberId) }));
});
on('POST', '/chair/services', (req, db) => {
  const d = device(req, db, 'chair');
  const barberId = requireBarber(d);
  const view = chairView(db, barberId);
  if (!view.serving) throw ApiError.conflict('مفيش زبون على الكرسي', { code: 'NOTHING_SERVING' });
  queue.addService(db, view.serving.id, id(body(req).service_id), chairActor(d));
  return ok(chairView(db, barberId));
});
on('POST', '/chair/photo', (req, db) => {
  const d = device(req, db, 'chair');
  const barberId = requireBarber(d);
  const view = chairView(db, barberId);
  const ticketId = Number(req.query.ticket_id);
  let target = null;
  if (view.serving && view.serving.id === ticketId) target = { cardId: view.serving.card && view.serving.card.id };
  else if (view.recent && view.recent.id === ticketId) target = { cardId: view.recent.card_id };
  if (!target) throw ApiError.conflict('الصورة للزبون اللي على الكرسي أو اللي لسه خالص بس', { code: 'PHOTO_TICKET' });
  if (!target.cardId) throw ApiError.conflict('الزبون ده مالوش كارت (من غير موبايل)', { code: 'NO_CARD' });
  const photo = cards.addPhoto(db, target.cardId, req.upload, { ticketId, barberId, takenBy: 'chair', takenById: d.id });
  return created({ photo, view: chairView(db, barberId) });
});
on('GET', '/chair/photos/:id', (req, db) => {
  const d = device(req, db, 'chair');
  const view = chairView(db, requireBarber(d));
  const allowed = new Set([view.serving && view.serving.card && view.serving.card.id, view.recent && view.recent.card_id]
    .concat(view.next.map((t) => t.card && t.card.id)).filter(Boolean));
  const p = cards.photo(db, id(req.params.id));
  if (!allowed.has(p.shop_customer_id)) throw ApiError.notFound('الصورة غير موجودة', { code: 'PHOTO_NOT_FOUND' });
  return file(photoBlob(p));
});
on('POST', '/chair/status', (req, db) => {
  const d = device(req, db, 'chair');
  const barberId = requireBarber(d);
  const b = body(req);
  check({ status: V.oneOf(b.status, ['available', 'break'], { required: true }), break_minutes: V.int(b.break_minutes, { min: 1, max: 240 }) });
  if (b.status === 'break' && chairView(db, barberId).serving) throw ApiError.conflict('دوس «خلّصت» الأول، وبعدين خُد استراحة', { code: 'FINISH_FIRST' });
  setBarberStatus(db, byId(db.barbers, barberId), b.status, b.break_minutes);
  touch(db);
  return ok(chairView(db, barberId));
});

/* ═══════════════════ الزبون: الدخول ═══════════════════ */

const BAD_CREDENTIALS = 'رقم الموبايل أو كلمة السر غلط';

on('POST', '/customer-auth/register', (req, db) => {
  const b = body(req);
  check({
    name: V.text(b.name, { required: true, min: 2, max: 60 }), phone: V.phone(b.phone, { required: true }),
    password: customerPasswordIssue(b.password), email: V.email(b.email),
  });
  const phone = normalizePhone(b.phone);
  if (db.customers.some((c) => c.phone === phone)) {
    throw ApiError.conflict('الرقم ده عليه حساب بالفعل — سجّل دخول', { code: 'PHONE_TAKEN', details: { phone: 'عليه حساب بالفعل' } });
  }
  const c = insert(db, 'customers', {
    uuid: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), name: b.name.trim(), phone, email: optText(b.email),
    password: b.password, status: 'active', created_at: nowIso(), push: false,
  });
  return created(customerSession(db, c));
});
on('POST', '/customer-auth/login', (req, db) => {
  const b = body(req);
  check({ phone: V.phone(b.phone, { required: true }), password: V.text(b.password, { required: true, max: 128 }) });
  const c = db.customers.find((x) => x.phone === normalizePhone(b.phone));
  if (!c || c.password !== b.password) throw ApiError.unauthorized(BAD_CREDENTIALS, { code: 'BAD_CREDENTIALS' });
  if (c.status !== 'active') throw ApiError.forbidden('الحساب موقوف', { code: 'CUSTOMER_BLOCKED' });
  return ok(customerSession(db, c));
});
on('POST', '/customer-auth/refresh', (req, db) => {
  const c = db.cookies.customer ? byId(db.customers, db.cookies.customer) : null;
  if (!c || c.status !== 'active') {
    db.cookies.customer = null;
    throw ApiError.unauthorized('مفيش جلسة — سجّل الدخول', { code: 'NO_SESSION' });
  }
  return ok(customerSession(db, c));
});
on('POST', '/customer-auth/logout', (req, db) => {
  db.cookies.customer = null;
  return noContent();
});
on('POST', '/customer-auth/forgot-password', (req) => {
  check({ phone: V.phone(body(req).phone, { required: true }) });
  return ok({ message: 'لو الرقم عليه حساب وفيه بريد، هيوصلك رابط الاستعادة خلال دقايق. لو مفيش بريد، كلّم المحل.' });
});
on('POST', '/customer-auth/reset-password', () => {
  throw ApiError.badRequest('الرابط غير صالح أو انتهت صلاحيته — في النسخة التجريبية البريد مش بيتبعت', { code: 'RESET_INVALID' });
});
on('POST', '/customer-auth/reset-with-code', (req, db) => {
  const b = body(req);
  check({ phone: V.phone(b.phone, { required: true }), code: /^\d{6}$/.test(String(b.code || '').trim()) ? null : 'الكود 6 أرقام', new_password: customerPasswordIssue(b.new_password) });
  const c = db.customers.find((x) => x.phone === normalizePhone(b.phone));
  const record = c && db.recoveryCodes.filter((r) => r.customer_id === c.id && !r.used_at && r.expires_at > nowIso()).sort((x, y) => y.id - x.id)[0];
  const bad = () => ApiError.badRequest('الكود غلط أو انتهى — اطلب كود جديد من المحل', { code: 'CODE_INVALID' });
  if (!record) throw bad();
  if (record.code !== String(b.code).trim()) {
    record.attempts += 1;
    if (record.attempts >= 5) record.used_at = nowIso();
    throw bad();
  }
  record.used_at = nowIso();
  c.password = b.new_password;
  if (db.cookies.customer === c.id) db.cookies.customer = null;
  return ok({ message: 'كلمة السر اتغيّرت — سجّل الدخول' });
});

/** الاستقبال بيطلّع كود استعادة لزبون واقف قدّامه */
on('POST', '/customers/recovery-code', (req, db) => {
  const u = staff(req, db, 'queue.write');
  check({ phone: V.phone(body(req).phone, { required: true }) });
  const c = db.customers.find((x) => x.phone === normalizePhone(body(req).phone));
  if (!c) throw ApiError.notFound('مفيش حساب زبون بالرقم ده', { code: 'CUSTOMER_NOT_FOUND' });
  db.recoveryCodes.forEach((r) => { if (r.customer_id === c.id && !r.used_at) r.used_at = nowIso(); });
  const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
  insert(db, 'recoveryCodes', { customer_id: c.id, code, expires_at: nowIso(Date.now() + 15 * MINUTE), used_at: null, attempts: 0 });
  audit(db, u, 'customer.recovery_code', 'customer', c.id, undefined, { name: c.name, phone: c.phone });
  return ok({ customer: { id: c.id, name: c.name, phone: c.phone }, code, expires_in_minutes: 15 });
});

/* ═══════════════════ الزبون: «دوري» ═══════════════════ */

function customerBill(db, ticketId) {
  const bill = db.bills.find((b) => b.ticket_id === ticketId && b.status !== 'void');
  if (!bill) return null;
  return {
    number: bill.number, status: bill.status, subtotal: bill.subtotal, discount: bill.discount, reward_discount: bill.reward_discount,
    total: bill.total, tip: bill.tip, paid: bill.paid, refunded: bill.refunded, stamp_awarded: Boolean(bill.stamp_awarded),
    reward_redeemed: Boolean(bill.reward_redeemed), paid_at: bill.paid_at,
    items: bill.items.map((i) => ({ kind: i.kind, name: i.name, qty: i.qty, unit_price: i.unit_price, line_total: i.line_total })),
    payments: db.payments.filter((p) => p.bill_id === bill.id).map((p) => ({ label: p.method_label, amount: p.amount, kind: p.kind })),
  };
}

function customerTicketView(db, row) {
  const now = new Date();
  let e = null;
  let version = 0;
  if (row.status === 'waiting' || row.status === 'serving') {
    const state = loadState(db, now);
    version = state.version;
    e = row.status === 'waiting' ? estimate(state).tickets.get(row.id) ?? null : null;
  }
  const s = db.shop;
  const barberCard = (bid) => {
    const b = bid ? byId(db.barbers, bid) : null;
    return b ? { id: b.id, name: b.name, chair_no: b.chair_no } : null;
  };
  const settings = db.settings;
  return {
    version,
    ticket: {
      id: row.id, number: row.number, status: row.status,
      shop: { id: 1, name: s.name, slug: s.slug, phone: s.phone, whatsapp: s.whatsapp, address: s.address, city: s.city },
      services: row.services.map((x) => ({ name: x.name, price: x.price })),
      total: row.total,
      preferred_barber: barberCard(row.preferred_barber_id),
      barber: barberCard(row.barber_id),
      ahead: e ? e.ahead ?? null : null,
      eta: e && e.start ? e.start.toISOString() : null,
      wait_minutes: roundedWait(e && e.start ? e.start : null, now),
      unavailable: Boolean(e && e.unavailable),
      arrived: Boolean(row.arrived_at),
      called: Boolean(row.called_at) && !row.arrived_at && row.status === 'waiting',
      called_at: row.called_at,
      grace_minutes: settings.grace_minutes,
      delays_left: Math.max(0, settings.max_delays - row.delays_used),
      must_confirm: Boolean(row.trust_confirm_required) && !row.confirmed_at && Boolean(row.near_notified_at),
      confirmed: Boolean(row.confirmed_at),
      created_at: row.created_at,
      started_at: row.started_at,
      finished_at: row.finished_at,
      end_reason: row.end_reason,
      bill: row.status === 'done' || row.status === 'serving' ? customerBill(db, row.id) : null,
      photo_ids: row.status === 'done' ? db.photos.filter((p) => p.ticket_id === row.id && !p.deleted_at).map((p) => p.id) : [],
    },
  };
}

function ownTicket(db, c, ticketId, { history = false } = {}) {
  const cardIds = new Set(db.cards.filter((x) => x.customer_id === c.id).map((x) => x.id));
  const row = db.tickets.find((t) => t.id === ticketId && (t.customer_id === c.id || (history && cardIds.has(t.shop_customer_id))));
  if (!row) throw ApiError.notFound('الدور غير موجود', { code: 'TICKET_NOT_FOUND' });
  return row;
}

const activeTicket = (db, c) => db.tickets.filter((t) => t.customer_id === c.id && (t.status === 'waiting' || t.status === 'serving')).sort((a, b) => b.id - a.id)[0];
const meActor = (c) => ({ type: 'customer', id: c.id });

on('GET', '/me', (req, db) => ok(publicCustomer(customer(req, db))));
on('PATCH', '/me', (req, db) => {
  const c = customer(req, db);
  const b = body(req);
  check({ name: b.name !== undefined ? V.text(b.name, { required: true, min: 2, max: 60 }) : null, email: V.email(b.email) });
  if (b.name !== undefined) c.name = b.name.trim();
  if (b.email !== undefined) c.email = optText(b.email);
  return ok(publicCustomer(c));
});
on('POST', '/me/change-password', (req, db) => {
  const c = customer(req, db);
  const b = body(req);
  if (b.current_password !== c.password) throw ApiError.badRequest('كلمة السر الحالية غلط', { code: 'WRONG_PASSWORD', details: { current_password: 'غلط' } });
  check({ new_password: customerPasswordIssue(b.new_password) });
  c.password = b.new_password;
  return ok(customerSession(db, c));
});
on('POST', '/me/push-subscriptions', (req, db) => {
  customer(req, db).push = true;
  return noContent();
});
on('DELETE', '/me/push-subscriptions', (req, db) => {
  customer(req, db).push = false;
  return noContent();
});
on('GET', '/me/cards', (req, db) => ok(customerCards.list(db, customer(req, db).id)));
on('POST', '/me/cards/link', (req, db) => {
  const c = customer(req, db);
  check({ code: /^\d{6}$/.test(String(body(req).code || '')) ? null : 'الكود 6 أرقام' });
  return ok(customerCards.linkWithCode(db, c.id, String(body(req).code)));
});
on('PATCH', '/me/cards/:shopId', (req, db) => ok(customerCards.setReminders(db, customer(req, db).id, Boolean(body(req).reminders_off))));
on('GET', '/me/photos', (req, db) => ok(customerCards.photos(db, customer(req, db).id)));
on('GET', '/me/photos/:id', (req, db) => file(photoBlob(customerCards.photo(db, customer(req, db).id, id(req.params.id)))));
on('DELETE', '/me/photos/:id', (req, db) => {
  const p = customerCards.photo(db, customer(req, db).id, id(req.params.id));
  p.deleted_at = nowIso();
  p.data = null;
  return noContent();
});

on('GET', '/me/tickets', (req, db) => {
  const c = customer(req, db);
  const cardIds = new Set(db.cards.filter((x) => x.customer_id === c.id).map((x) => x.id));
  return ok(db.tickets.filter((t) => t.customer_id === c.id || cardIds.has(t.shop_customer_id)).sort((a, b) => b.id - a.id).slice(0, 50).map((t) => {
    const bill = db.bills.find((b) => b.ticket_id === t.id && b.status !== 'void');
    const barber = t.barber_id ? byId(db.barbers, t.barber_id) : null;
    return {
      id: t.id, number: t.number, status: t.status, business_date: t.business_date, total: t.total, created_at: t.created_at,
      finished_at: t.finished_at, end_reason: t.end_reason, shop_name: db.shop.name, shop_slug: db.shop.slug,
      barber_name: barber ? barber.name : null, services: t.services.map((s) => s.name).join('، ') || null,
      bill_total: bill ? bill.total : null, bill_status: bill ? bill.status : null,
    };
  }));
});
on('GET', '/me/tickets/active', (req, db) => {
  const row = activeTicket(db, customer(req, db));
  return ok(row ? customerTicketView(db, row) : { version: 0, ticket: null });
});
on('GET', '/me/tickets/:id', (req, db) => ok(customerTicketView(db, ownTicket(db, customer(req, db), id(req.params.id), { history: true }))));
on('POST', '/me/tickets', (req, db) => {
  const c = customer(req, db);
  const b = body(req);
  check({ shop_slug: V.text(b.shop_slug, { required: true }), service_ids: Array.isArray(b.service_ids) && b.service_ids.length ? null : 'اختار خدمة واحدة على الأقل' });
  findShop(db, String(b.shop_slug).trim().toLowerCase());
  const t = queue.create(db, {
    source: 'app', customer_id: c.id, name: c.name, phone: c.phone, service_ids: b.service_ids, barber_id: b.barber_id ?? null,
  }, meActor(c));
  return created(customerTicketView(db, byId(db.tickets, t.id)));
});

function meAction(fn) {
  return (req, db) => {
    const c = customer(req, db);
    const tid = id(req.params.id);
    ownTicket(db, c, tid);
    fn(req, db, c, tid);
    return ok(customerTicketView(db, byId(db.tickets, tid)));
  };
}
on('POST', '/me/tickets/:id/coming', meAction((req, db, c, tid) => queue.confirmComing(db, tid, meActor(c))));
on('POST', '/me/tickets/:id/delay', meAction((req, db, c, tid) => queue.delay(db, tid, meActor(c))));
on('POST', '/me/tickets/:id/cancel', meAction((req, db, c, tid) => queue.cancel(db, tid, meActor(c))));
on('POST', '/me/tickets/:id/check-in', meAction((req, db, c, tid) => {
  check({ code: /^\d{6}$/.test(String(body(req).code || '')) ? null : 'الكود 6 أرقام' });
  queue.checkIn(db, tid, String(body(req).code), meActor(c));
}));

on('GET', '/me/stream', (req, db) => {
  const c = customer(req, db);
  const row = activeTicket(db, c);
  if (!row) return stream({ render: () => ({ version: 0, ticket: null }), once: true });
  const tid = row.id;
  return stream({ render: (d) => customerTicketView(d, byId(d.tickets, tid)), versionOf: (v) => [v.version, v.ticket && v.ticket.status] });
});

