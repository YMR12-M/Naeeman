/* ============================================
   نعيمًا التجريبي - الكروت والفواتير والدرج والتقفيل والمخزن والحساب
   نفس قواعد server/src/modules/{cards,billing,products,payroll}:
   الفاتورة مصدر الحقيقة للفلوس، والعمولة بتتسجّل على السطر وقت الدفع،
   والحساب بيقفل كل اللي ما اتحسبش لحد تاريخ.
   ============================================ */
import { allocate, applyRate, percentOf, weightedCost } from '../../../server/src/utils/money.js';
import { addDays, diffDays } from '../../../server/src/utils/dates.js';
import { ApiError, byId, counter, insert, nowIso, pageOf, todayOf, MINUTE } from './base.js';

const appUrl = () => `${window.location.origin}/app`;

/* ═══════════════════ الكروت ═══════════════════ */

export function linkCard(db, { customerId = null, phone = null, name }) {
  if (!customerId && !phone) return null;
  const cleanName = String(name || '').trim().slice(0, 60) || 'زبون';
  if (customerId) {
    const own = db.cards.find((c) => c.customer_id === customerId);
    if (own) return own.id;
    const account = byId(db.customers, customerId);
    return insertCard(db, { customerId, phone: null, name: account ? account.name : cleanName }).id;
  }
  const existing = db.cards.find((c) => c.phone === phone);
  if (existing) return existing.id;
  return insertCard(db, { customerId: null, phone, name: cleanName }).id;
}

function insertCard(db, { customerId, phone, name }) {
  return insert(db, 'cards', {
    shop_id: 1, customer_id: customerId, phone, name, notes: null, stamps: 0, rewards_redeemed: 0, visits: 0, total_spent: 0,
    first_visit_at: null, last_visit_at: null, last_barber_id: null, reminded_at: null, reminders_off: false,
    created_at: nowIso(), updated_at: nowIso(),
  });
}

export function recordVisit(db, cardId, barberId) {
  const card = byId(db.cards, cardId);
  if (!card) return;
  card.visits += 1;
  card.last_visit_at = nowIso();
  card.first_visit_at = card.first_visit_at || nowIso();
  if (barberId) card.last_barber_id = barberId;
}

export function rewardLabel(settings, serviceName = null) {
  switch (settings.loyalty_reward_type) {
    case 'service': return serviceName ? `«${serviceName}» ببلاش` : 'خدمة ببلاش';
    case 'amount': {
      const pounds = settings.loyalty_reward_value / 100;
      return `خصم ${Number.isInteger(pounds) ? pounds : pounds.toFixed(2)} ج`;
    }
    case 'percent': return `خصم ${settings.loyalty_reward_value}%`;
    default: return 'أغلى خدمة في الزيارة ببلاش';
  }
}

function rewardServiceName(db) {
  const s = db.settings;
  if (s.loyalty_reward_type !== 'service' || !s.loyalty_reward_service_id) return null;
  const row = byId(db.services, s.loyalty_reward_service_id);
  return row ? row.name : null;
}

export function loyaltyStatus(settings, stamps, serviceName = null) {
  if (!settings.loyalty_enabled) return { enabled: false };
  const required = settings.loyalty_stamps_required;
  return { enabled: true, stamps, required, eligible: stamps >= required, left: Math.max(0, required - stamps), reward: rewardLabel(settings, serviceName) };
}

export const loyaltyFor = (db, stamps) => loyaltyStatus(db.settings, stamps, rewardServiceName(db));

export function addStampEvent(db, { cardId, billId = null, type, delta, note = null, userId = null }) {
  const card = byId(db.cards, cardId);
  card.stamps = Math.max(0, card.stamps + delta);
  insert(db, 'loyaltyEvents', {
    shop_customer_id: cardId, bill_id: billId, type, delta, stamps_after: card.stamps, note, created_by: userId, created_at: nowIso(),
  });
  return card.stamps;
}

export function cardSummaries(db, cardIds) {
  const ids = Array.from(new Set(cardIds.filter(Boolean)));
  const out = new Map();
  ids.forEach((id) => {
    const row = byId(db.cards, id);
    if (!row) return;
    const photos = db.photos.filter((p) => p.shop_customer_id === id && !p.deleted_at);
    out.set(id, {
      id: row.id, notes: row.notes, visits: row.visits, last_visit_at: row.last_visit_at, has_app: row.customer_id !== null,
      last_photo_id: photos.length ? Math.max.apply(null, photos.map((p) => p.id)) : null,
      loyalty: loyaltyStatus(db.settings, row.stamps),
    });
  });
  return out;
}

function findCard(db, id) {
  const card = byId(db.cards, id);
  if (!card) throw ApiError.notFound('الكارت غير موجود', { code: 'CARD_NOT_FOUND' });
  return card;
}

const barberName = (db, id) => {
  const b = id ? byId(db.barbers, id) : null;
  return b ? b.name : null;
};

const servicesText = (t) => (t.services.length ? t.services.map((s) => s.name).join('، ') : null);

export const cards = {
  list(db, query) {
    const { page, pageSize } = pageOf(query, 25);
    const q = (query.q || '').trim();
    let rows = db.cards.slice();
    if (q) {
      const digits = q.replace(/\D/g, '');
      rows = rows.filter((c) => c.name.includes(q) || (digits.length >= 3 && String(c.phone || '').includes(digits)));
    }
    rows.sort((a, b) => (a.last_visit_at === null) - (b.last_visit_at === null)
      || String(b.last_visit_at || '').localeCompare(String(a.last_visit_at || '')) || b.id - a.id);
    const total = rows.length;
    return {
      rows: rows.slice((page - 1) * pageSize, page * pageSize).map((c) => {
        const account = c.customer_id ? byId(db.customers, c.customer_id) : null;
        return {
          id: c.id, name: c.name, phone: c.phone, customer_id: c.customer_id, stamps: c.stamps, visits: c.visits,
          total_spent: c.total_spent, last_visit_at: c.last_visit_at, notes: c.notes, last_barber_name: barberName(db, c.last_barber_id),
          app_phone: account ? account.phone : null, has_app: c.customer_id !== null,
        };
      }),
      meta: { page, page_size: pageSize, total, total_pages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  },

  get(db, id) {
    const card = findCard(db, id);
    const visits = db.tickets
      .filter((t) => t.shop_customer_id === card.id && t.status === 'done')
      .sort((a, b) => String(b.finished_at).localeCompare(String(a.finished_at)) || b.id - a.id)
      .slice(0, 20)
      .map((t) => {
        const bill = db.bills.find((b) => b.ticket_id === t.id);
        return {
          ticket_id: t.id, business_date: t.business_date, number: t.number, finished_at: t.finished_at, total: t.total,
          barber_name: barberName(db, t.barber_id), services: servicesText(t),
          bill_id: bill ? bill.id : null, bill_total: bill ? bill.total : null, bill_status: bill ? bill.status : null,
        };
      });
    const photos = db.photos
      .filter((p) => p.shop_customer_id === card.id && !p.deleted_at)
      .sort((a, b) => b.id - a.id).slice(0, 30)
      .map((p) => ({ id: p.id, ticket_id: p.ticket_id, created_at: p.created_at, barber_name: barberName(db, p.barber_id) }));
    const events = db.loyaltyEvents
      .filter((e) => e.shop_customer_id === card.id).sort((a, b) => b.id - a.id).slice(0, 15)
      .map((e) => ({ type: e.type, delta: e.delta, stamps_after: e.stamps_after, note: e.note, bill_id: e.bill_id, created_at: e.created_at }));
    const account = card.customer_id ? byId(db.customers, card.customer_id) : null;
    const last = card.last_barber_id ? byId(db.barbers, card.last_barber_id) : null;
    return Object.assign({}, card, {
      has_app: card.customer_id !== null,
      app_phone: account ? account.phone : null,
      last_barber: last ? { id: last.id, name: last.name } : null,
      loyalty: loyaltyFor(db, card.stamps),
      visits_list: visits,
      photos,
      loyalty_events: events,
    });
  },

  update(db, id, changes) {
    const card = findCard(db, id);
    const before = Object.assign({}, card);
    ['name', 'notes', 'reminders_off'].forEach((k) => {
      if (changes[k] !== undefined) card[k] = changes[k];
    });
    card.updated_at = nowIso();
    return { before, after: Object.assign({}, card, { has_app: card.customer_id !== null }) };
  },

  adjustStamps(db, id, delta, note, userId) {
    findCard(db, id);
    const stamps = addStampEvent(db, { cardId: Number(id), type: 'adjust', delta, note, userId });
    return { stamps, loyalty: loyaltyFor(db, stamps) };
  },

  dueReminders(db) {
    const s = db.settings;
    if (!s.reminder_enabled) return { enabled: false, days: s.reminder_days, rows: [] };
    const limit = Date.now() - s.reminder_days * 86_400_000;
    const rows = db.cards
      .filter((c) => !c.reminders_off && c.last_visit_at && Date.parse(c.last_visit_at) < limit
        && (!c.reminded_at || c.reminded_at < c.last_visit_at)
        && !db.tickets.some((t) => t.shop_customer_id === c.id && (t.status === 'waiting' || t.status === 'serving')))
      .sort((a, b) => a.last_visit_at.localeCompare(b.last_visit_at))
      .slice(0, 100)
      .map((c) => ({
        id: c.id, name: c.name, phone: c.phone, customer_id: c.customer_id, last_visit_at: c.last_visit_at, visits: c.visits,
        last_barber_name: barberName(db, c.last_barber_id),
        days_since: Math.floor((Date.now() - Date.parse(c.last_visit_at)) / 86_400_000),
        has_app: c.customer_id !== null, has_push: Boolean(c.customer_id && (byId(db.customers, c.customer_id) || {}).push),
      }));
    return { enabled: true, days: s.reminder_days, shop_url: `${appUrl()}/s/${db.shop.slug}`, rows };
  },

  markReminded(db, id) {
    findCard(db, id).reminded_at = nowIso();
    return { reminded: true };
  },

  issueLinkCode(db, id, userId) {
    const card = findCard(db, id);
    if (card.customer_id) throw ApiError.conflict('الكارت ده مربوط بحساب تطبيق بالفعل', { code: 'CARD_ALREADY_LINKED' });
    if (!card.phone) throw ApiError.conflict('الكارت ده مالوش رقم موبايل — اكتب الرقم الأول', { code: 'CARD_NO_PHONE' });
    db.linkCodes.forEach((l) => {
      if (l.shop_customer_id === card.id && !l.used_at) l.used_at = nowIso();
    });
    const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
    insert(db, 'linkCodes', { shop_customer_id: card.id, code, expires_at: nowIso(Date.now() + 15 * MINUTE), used_at: null, attempts: 0, issued_by: userId });
    return { code, expires_in_minutes: 15, card: { id: card.id, name: card.name, phone: card.phone } };
  },

  addPhoto(db, cardId, upload, { ticketId = null, barberId = null, takenBy, takenById = null }) {
    findCard(db, cardId);
    if (!upload || !upload.dataUrl) throw ApiError.unprocessable('الصورة مش واضحة', { code: 'BAD_IMAGE' });
    if (upload.size > 700_000) throw ApiError.payloadTooLarge('الصورة أكبر من الحدّ المسموح', { code: 'IMAGE_TOO_LARGE' });
    const photo = insert(db, 'photos', {
      shop_customer_id: Number(cardId), ticket_id: ticketId, barber_id: barberId, mime: upload.type, bytes: upload.size, data: upload.dataUrl,
      taken_by: takenBy, taken_by_id: takenById, created_at: nowIso(), deleted_at: null,
    });
    return { id: photo.id, shop_customer_id: photo.shop_customer_id, ticket_id: ticketId, mime: photo.mime, bytes: photo.bytes };
  },

  photo(db, photoId, { cardId = null } = {}) {
    const p = byId(db.photos, photoId);
    if (!p || p.deleted_at || (cardId !== null && p.shop_customer_id !== Number(cardId))) {
      throw ApiError.notFound('الصورة غير موجودة', { code: 'PHOTO_NOT_FOUND' });
    }
    return p;
  },

  deletePhoto(db, photoId, cardId) {
    const p = cards.photo(db, photoId, { cardId });
    p.deleted_at = nowIso();
    p.data = null;
  },
};

/** تطبيق الزبون: كروته وصوره وربط الكارت بكود */
export const customerCards = {
  list(db, customerId) {
    return db.cards.filter((c) => c.customer_id === customerId).map((c) => ({
      id: c.id, shop_id: 1, stamps: c.stamps, visits: c.visits, last_visit_at: c.last_visit_at, reminders_off: Boolean(c.reminders_off),
      shop_name: db.shop.name, shop_slug: db.shop.slug, loyalty: loyaltyFor(db, c.stamps),
    }));
  },

  setReminders(db, customerId, off) {
    const card = db.cards.find((c) => c.customer_id === customerId);
    if (!card) throw ApiError.notFound('مالكش كارت في المحل ده', { code: 'CARD_NOT_FOUND' });
    card.reminders_off = off;
    return { reminders_off: off };
  },

  linkWithCode(db, customerId, code) {
    const invalidCode = () => ApiError.badRequest('الكود غلط أو انتهى — اطلب كود جديد من المحل', { code: 'LINK_INVALID' });
    const account = byId(db.customers, customerId);
    if (!account || !account.phone) throw invalidCode();
    const record = db.linkCodes
      .filter((l) => {
        const card = byId(db.cards, l.shop_customer_id);
        return card && card.phone === account.phone && card.customer_id === null && !l.used_at && l.expires_at > nowIso();
      })
      .sort((a, b) => b.id - a.id)[0];
    if (!record) throw invalidCode();
    if (record.code !== String(code)) {
      record.attempts += 1;
      if (record.attempts >= 5) record.used_at = nowIso();
      throw invalidCode();
    }
    record.used_at = nowIso();
    const source = byId(db.cards, record.shop_customer_id);
    const target = db.cards.find((c) => c.customer_id === customerId);
    let card = source;
    if (!target) {
      source.customer_id = customerId;
    } else {
      // دمج كارت الموبايل في كارت الحساب
      db.tickets.forEach((t) => { if (t.shop_customer_id === source.id) t.shop_customer_id = target.id; });
      db.bills.forEach((b) => { if (b.shop_customer_id === source.id) b.shop_customer_id = target.id; });
      db.photos.forEach((p) => { if (p.shop_customer_id === source.id) p.shop_customer_id = target.id; });
      db.loyaltyEvents.forEach((e) => { if (e.shop_customer_id === source.id) e.shop_customer_id = target.id; });
      target.phone = source.phone;
      target.notes = [source.notes, target.notes].filter(Boolean).join('\n').slice(0, 1000) || null;
      target.stamps += source.stamps;
      target.rewards_redeemed += source.rewards_redeemed;
      target.visits += source.visits;
      target.total_spent += source.total_spent;
      if (source.first_visit_at && (!target.first_visit_at || source.first_visit_at < target.first_visit_at)) target.first_visit_at = source.first_visit_at;
      if (source.last_visit_at && (!target.last_visit_at || source.last_visit_at > target.last_visit_at)) {
        target.last_visit_at = source.last_visit_at;
        target.last_barber_id = source.last_barber_id;
      }
      target.reminders_off = target.reminders_off || source.reminders_off;
      db.cards = db.cards.filter((c) => c.id !== source.id);
      if (source.stamps > 0) {
        insert(db, 'loyaltyEvents', {
          shop_customer_id: target.id, bill_id: null, type: 'merge', delta: source.stamps, stamps_after: target.stamps,
          note: 'ربط كارت الموبايل بالتطبيق', created_by: null, created_at: nowIso(),
        });
      }
      card = target;
    }
    return {
      id: card.id, shop_id: 1, stamps: card.stamps, visits: card.visits, last_visit_at: card.last_visit_at,
      reminders_off: Boolean(card.reminders_off), shop_name: db.shop.name, shop_slug: db.shop.slug, loyalty: loyaltyFor(db, card.stamps),
    };
  },

  ownedPhotos(db, customerId) {
    const mine = new Set(db.cards.filter((c) => c.customer_id === customerId).map((c) => c.id));
    return db.photos.filter((p) => mine.has(p.shop_customer_id) && !p.deleted_at);
  },

  photos(db, customerId) {
    return customerCards.ownedPhotos(db, customerId).sort((a, b) => b.id - a.id).slice(0, 60)
      .map((p) => ({ id: p.id, created_at: p.created_at, shop_name: db.shop.name, barber_name: barberName(db, p.barber_id) }));
  },

  photo(db, customerId, photoId) {
    const p = customerCards.ownedPhotos(db, customerId).find((x) => x.id === Number(photoId));
    if (!p) throw ApiError.notFound('الصورة غير موجودة', { code: 'PHOTO_NOT_FOUND' });
    return p;
  },
};

/* ═══════════════════ طرق الدفع ═══════════════════ */

export const methods = {
  list(db, { activeOnly = false } = {}) {
    return db.methods.filter((m) => !activeOnly || m.active).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
      .map((m) => Object.assign({}, m));
  },
  create(db, { label, kind }) {
    const order = db.methods.reduce((max, m) => Math.max(max, m.sort_order), 0) + 10;
    const n = db.methods.filter((m) => m.code.startsWith('m')).length + 1;
    const row = insert(db, 'methods', { code: `m${n}_${Date.now().toString(36)}`, label, kind, active: true, sort_order: order });
    return Object.assign({}, row);
  },
  update(db, id, changes) {
    const row = byId(db.methods, id);
    if (!row) throw ApiError.notFound('طريقة الدفع غير موجودة', { code: 'METHOD_NOT_FOUND' });
    const before = Object.assign({}, row);
    if (row.code === 'cash' && changes.active === false) throw ApiError.conflict('الكاش مينفعش يتقفل — هو اللي بيدخل الدرج', { code: 'CASH_REQUIRED' });
    ['label', 'active', 'sort_order'].forEach((k) => { if (changes[k] !== undefined) row[k] = changes[k]; });
    return { before, after: Object.assign({}, row) };
  },
};

/* ═══════════════════ الفواتير ═══════════════════ */

export const openDrawer = (db) => db.drawers.find((d) => d.status === 'open') || null;

function findBill(db, id) {
  const bill = byId(db.bills, id);
  if (!bill) throw ApiError.notFound('الفاتورة غير موجودة', { code: 'BILL_NOT_FOUND' });
  return bill;
}

function assertOpen(bill) {
  if (bill.status === 'paid') throw ApiError.conflict('الفاتورة اتدفعت بالفعل', { code: 'BILL_PAID' });
  if (bill.status === 'void') throw ApiError.conflict('الفاتورة دي ملغية', { code: 'BILL_VOID' });
}

function recompute(bill) {
  bill.subtotal = bill.items.reduce((sum, i) => sum + i.line_total, 0);
  bill.total = Math.max(0, bill.subtotal - bill.discount - bill.reward_discount);
}

function insertBill(db, { businessDate, source, ticketId = null, cardId = null, name = null, phone = null, barberId = null, userId = null }) {
  return insert(db, 'bills', {
    shop_id: 1, business_date: businessDate, number: counter(db, `bill:${businessDate}`), source, ticket_id: ticketId,
    shop_customer_id: cardId, customer_name: name, customer_phone: phone, barber_id: barberId, status: 'open',
    subtotal: 0, discount: 0, discount_reason: null, reward_discount: 0, total: 0, tip: 0, paid: 0, change_given: 0, refunded: 0,
    stamp_awarded: false, reward_redeemed: false, auto_paid: false, paid_date: null, paid_at: null, paid_by: null,
    voided_at: null, voided_by: null, void_reason: null, created_by: userId, day_close_id: null, tip_settlement_id: null,
    created_at: nowIso(), updated_at: nowIso(), items: [],
  });
}

function newItem(db, fields) {
  db.seq.billItems = (db.seq.billItems || 0) + 1;
  return Object.assign({
    id: db.seq.billItems, kind: 'service', service_id: null, product_id: null, ticket_service_id: null, name: '', unit_price: 0, qty: 1,
    line_total: 0, barber_id: null, unit_cost: null, discount_share: 0, reward_share: 0, commission_rate: 0, commission: 0,
    settlement_id: null, added_by: 'staff', created_at: nowIso(),
  }, fields);
}

function ticketBill(db, ticket, userId = null) {
  const existing = db.bills.find((b) => b.ticket_id === ticket.id);
  if (existing) return existing;
  return insertBill(db, {
    businessDate: ticket.business_date, source: 'ticket', ticketId: ticket.id, cardId: ticket.shop_customer_id ?? null,
    name: ticket.name, phone: ticket.phone ?? null, barberId: ticket.barber_id ?? null, userId,
  });
}

function settleItems(db, items, { discount, rewardShares }) {
  const shares = allocate(discount, items.map((i) => i.line_total));
  items.forEach((item, index) => {
    const barber = item.barber_id ? byId(db.barbers, item.barber_id) : null;
    const rate = barber ? (item.kind === 'service' ? barber.service_pct : barber.product_pct) : 0;
    item.discount_share = shares[index];
    item.reward_share = rewardShares[index] || 0;
    item.commission_rate = rate;
    item.commission = applyRate(item.line_total - shares[index], rate);
  });
}

function afterPaid(db, bill, { redeemed, userId }) {
  const settings = db.settings;
  bill.items.forEach((item) => {
    if (item.kind === 'product' && item.product_id) moveStock(db, { productId: item.product_id, type: 'sale', qty: -item.qty, billId: bill.id, userId });
  });
  if (!bill.shop_customer_id) return { stamp: false };
  const card = byId(db.cards, bill.shop_customer_id);
  if (!card) return { stamp: false };
  card.total_spent += bill.total;
  if (redeemed) {
    addStampEvent(db, { cardId: card.id, billId: bill.id, type: 'redeem', delta: -settings.loyalty_stamps_required, note: rewardLabel(settings), userId });
    card.rewards_redeemed += 1;
    return { stamp: false };
  }
  const earns = settings.loyalty_enabled && bill.items.some((i) => i.kind === 'service') && bill.total >= settings.loyalty_min_total;
  if (!earns) return { stamp: false };
  addStampEvent(db, { cardId: card.id, billId: bill.id, type: 'earn', delta: 1, userId });
  bill.stamp_awarded = true;
  return { stamp: true };
}

/** الدور خلص: الخدمات على الفاتورة، والزيارة على الكارت، ولو الكاشير مقفول بتتسدّد كاش */
export function onTicketDone(db, ticket) {
  const bill = ticketBill(db, ticket);
  if (bill.status !== 'open') return bill.id;
  ticket.services.forEach((s) => {
    if (bill.items.some((i) => i.ticket_service_id === s.id)) return;
    bill.items.push(newItem(db, {
      kind: 'service', service_id: s.service_id, ticket_service_id: s.id, name: s.name, unit_price: s.price, qty: 1,
      line_total: s.price, barber_id: ticket.barber_id ?? null, added_by: 'ticket',
    }));
  });
  bill.barber_id = bill.barber_id || ticket.barber_id || null;
  bill.shop_customer_id = bill.shop_customer_id || ticket.shop_customer_id || null;
  bill.items.forEach((i) => { if (!i.barber_id) i.barber_id = ticket.barber_id ?? null; });
  recompute(bill);
  recordVisit(db, ticket.shop_customer_id, ticket.barber_id);
  if (!db.settings.cashier_enabled) autoPay(db, bill);
  return bill.id;
}

function autoPay(db, bill) {
  settleItems(db, bill.items, { discount: 0, rewardShares: [] });
  if (bill.total > 0) {
    insert(db, 'payments', {
      shop_id: 1, bill_id: bill.id, drawer_session_id: null, business_date: bill.business_date, kind: 'payment',
      method_code: 'cash', method_label: 'كاش', method_kind: 'cash', amount: bill.total, tendered: null, reference: null, reason: null,
      created_by: null, created_at: nowIso(), day_close_id: null,
    });
  }
  Object.assign(bill, { status: 'paid', paid: bill.total, auto_paid: true, paid_date: bill.business_date, paid_at: nowIso() });
  afterPaid(db, bill, { redeemed: false, userId: null });
}

export function billView(db, id) {
  const bill = findBill(db, id);
  const out = Object.assign({}, bill);
  delete out.items;
  const card = bill.shop_customer_id ? byId(db.cards, bill.shop_customer_id) : null;
  const barber = bill.barber_id ? byId(db.barbers, bill.barber_id) : null;
  const ticket = bill.ticket_id ? byId(db.tickets, bill.ticket_id) : null;
  out.barber = barber ? { id: barber.id, name: barber.name } : null;
  out.ticket = ticket ? { id: ticket.id, number: ticket.number, status: ticket.status, business_date: ticket.business_date } : null;
  out.items = bill.items.map((i) => Object.assign({ bill_id: bill.id, barber_name: barberName(db, i.barber_id) }, i));
  out.payments = db.payments.filter((p) => p.bill_id === bill.id).map((p) => {
    const u = p.created_by ? byId(db.users, p.created_by) : null;
    return {
      id: p.id, kind: p.kind, method_code: p.method_code, method_label: p.method_label, method_kind: p.method_kind, amount: p.amount,
      tendered: p.tendered, reference: p.reference, reason: p.reason, drawer_session_id: p.drawer_session_id,
      business_date: p.business_date, created_at: p.created_at, created_by_name: u ? u.full_name : null,
    };
  });
  out.card = card && {
    id: card.id, name: card.name, phone: card.phone, notes: card.notes, has_app: card.customer_id !== null, loyalty: loyaltyFor(db, card.stamps),
  };
  return out;
}

export function rewardFor(settings, items, afterDiscount) {
  const pickLine = (predicate) => {
    let best = -1;
    items.forEach((item, index) => {
      if (predicate(item) && (best === -1 || item.unit_price > items[best].unit_price)) best = index;
    });
    return best;
  };
  const onLine = (index) => {
    if (index === -1) return null;
    const amount = Math.min(items[index].unit_price, afterDiscount);
    return { amount, shares: items.map((_, i) => (i === index ? amount : 0)) };
  };
  switch (settings.loyalty_reward_type) {
    case 'service': return onLine(pickLine((i) => i.kind === 'service' && i.service_id === settings.loyalty_reward_service_id));
    case 'top_service': return onLine(pickLine((i) => i.kind === 'service'));
    case 'amount': {
      const amount = Math.min(settings.loyalty_reward_value, afterDiscount);
      return { amount, shares: allocate(amount, items.map((i) => i.line_total)) };
    }
    case 'percent': {
      const amount = Math.min(percentOf(afterDiscount, settings.loyalty_reward_value), afterDiscount);
      return { amount, shares: allocate(amount, items.map((i) => i.line_total)) };
    }
    default: return { amount: 0, shares: items.map(() => 0) };
  }
}

function addLine(db, bill, input) {
  const barberId = input.barber_id ?? bill.barber_id ?? null;
  if (input.barber_id && !byId(db.barbers, input.barber_id)) {
    throw ApiError.unprocessable('الحلاق غير موجود', { code: 'BAD_BARBER', details: { barber_id: 'غير موجود' } });
  }
  if (input.product_id) {
    const product = db.products.find((p) => p.id === Number(input.product_id) && !p.archived_at && p.active);
    if (!product) throw ApiError.unprocessable('المنتج غير موجود أو موقوف', { code: 'BAD_PRODUCT', details: { product_id: 'غير موجود' } });
    const qty = input.qty || 1;
    const same = bill.items.find((i) => i.kind === 'product' && i.product_id === product.id && i.unit_price === product.price && (i.barber_id ?? null) === barberId);
    if (same) {
      same.qty += qty;
      same.line_total = same.unit_price * same.qty;
      return;
    }
    bill.items.push(newItem(db, {
      kind: 'product', product_id: product.id, name: product.name, unit_price: product.price, qty, line_total: product.price * qty,
      barber_id: barberId, unit_cost: product.cost,
    }));
    return;
  }
  const service = db.services.find((s) => s.id === Number(input.service_id) && !s.archived_at);
  if (!service) throw ApiError.unprocessable('الخدمة غير موجودة', { code: 'BAD_SERVICE', details: { service_id: 'غير موجودة' } });
  bill.items.push(newItem(db, { kind: 'service', service_id: service.id, name: service.name, unit_price: service.price, qty: 1, line_total: service.price, barber_id: barberId }));
}

export const billing = {
  get: (db, id) => billView(db, id),

  list(db, query) {
    const { page, pageSize } = pageOf(query, 30);
    let rows = db.bills.slice();
    if (query.status) rows = rows.filter((b) => b.status === query.status);
    if (query.date) rows = rows.filter((b) => b.business_date === query.date || b.paid_date === query.date);
    const q = (query.q || '').trim();
    if (q) rows = rows.filter((b) => String(b.customer_name || '').includes(q) || String(b.customer_phone || '').includes(q) || b.number === Number(q));
    rows.sort((a, b) => (b.status === 'open') - (a.status === 'open') || b.id - a.id);
    const total = rows.length;
    return {
      rows: rows.slice((page - 1) * pageSize, page * pageSize).map((b) => {
        const t = b.ticket_id ? byId(db.tickets, b.ticket_id) : null;
        return {
          id: b.id, business_date: b.business_date, number: b.number, source: b.source, ticket_id: b.ticket_id, customer_name: b.customer_name,
          customer_phone: b.customer_phone, status: b.status, subtotal: b.subtotal, discount: b.discount, reward_discount: b.reward_discount,
          total: b.total, tip: b.tip, paid: b.paid, refunded: b.refunded, auto_paid: b.auto_paid, paid_at: b.paid_at, created_at: b.created_at,
          barber_name: barberName(db, b.barber_id), ticket_number: t ? t.number : null, items_count: b.items.length,
        };
      }),
      meta: { page, page_size: pageSize, total, total_pages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  },

  openForTicket(db, ticketId, userId) {
    const ticket = byId(db.tickets, ticketId);
    if (!ticket) throw ApiError.notFound('الدور غير موجود', { code: 'TICKET_NOT_FOUND' });
    if (['cancelled', 'no_show'].includes(ticket.status) && !db.bills.find((b) => b.ticket_id === ticket.id)) {
      throw ApiError.conflict('الدور ده اتلغى', { code: 'TICKET_NOT_ACTIVE' });
    }
    return billView(db, ticketBill(db, ticket, userId).id);
  },

  createCounter(db, input, userId) {
    const cardId = linkCard(db, { phone: input.customer_phone ?? null, name: input.customer_name });
    const bill = insertBill(db, {
      businessDate: todayOf(db), source: 'counter', cardId, name: input.customer_name ?? null, phone: input.customer_phone ?? null,
      barberId: input.barber_id ?? null, userId,
    });
    (input.items || []).forEach((item) => addLine(db, bill, item));
    recompute(bill);
    return billView(db, bill.id);
  },

  addItem(db, id, input) {
    const bill = findBill(db, id);
    assertOpen(bill);
    addLine(db, bill, input);
    recompute(bill);
    return billView(db, id);
  },

  removeItem(db, id, itemId, { canDiscount }) {
    const bill = findBill(db, id);
    assertOpen(bill);
    const item = bill.items.find((i) => i.id === Number(itemId));
    if (!item) throw ApiError.notFound('السطر غير موجود', { code: 'ITEM_NOT_FOUND' });
    if (item.kind === 'service' && !canDiscount) throw ApiError.forbidden('شيل خدمة من الفاتورة للمدير بس', { code: 'FORBIDDEN' });
    bill.items = bill.items.filter((i) => i.id !== item.id);
    recompute(bill);
    return billView(db, id);
  },

  checkout(db, id, input, user, { canDiscount }) {
    const bill = findBill(db, id);
    assertOpen(bill);
    const settings = db.settings;
    const items = bill.items;
    if (items.length === 0) throw ApiError.conflict('الفاتورة فاضية — زوّد خدمة أو منتج الأول', { code: 'EMPTY_BILL' });
    const subtotal = items.reduce((sum, i) => sum + i.line_total, 0);
    const discount = input.discount || 0;
    if (discount > subtotal) throw ApiError.unprocessable('الخصم أكبر من الفاتورة', { code: 'VALIDATION_ERROR', details: { discount: 'أكبر من الفاتورة' } });
    if (discount > 0 && !input.discount_reason) throw ApiError.unprocessable('اكتب سبب الخصم', { code: 'VALIDATION_ERROR', details: { discount_reason: 'الحقل مطلوب' } });
    if (discount > 0 && !canDiscount && discount > percentOf(subtotal, settings.max_cashier_discount_pct)) {
      throw ApiError.forbidden(`أقصى خصم للاستقبال ${settings.max_cashier_discount_pct}% — كلّم المدير`, { code: 'DISCOUNT_LIMIT' });
    }
    let reward = { amount: 0, shares: items.map(() => 0) };
    if (input.redeem_reward) {
      if (!settings.loyalty_enabled) throw ApiError.conflict('كارت الأختام مقفول في الإعدادات', { code: 'LOYALTY_DISABLED' });
      if (!bill.shop_customer_id) throw ApiError.conflict('الفاتورة مش على كارت زبون', { code: 'NO_CARD' });
      const card = byId(db.cards, bill.shop_customer_id);
      if (card.stamps < settings.loyalty_stamps_required) {
        throw ApiError.conflict(`الزبون معاه ${card.stamps} ختم من ${settings.loyalty_stamps_required}`, { code: 'REWARD_NOT_EARNED' });
      }
      reward = rewardFor(settings, items, subtotal - discount);
      if (!reward || reward.amount === 0) throw ApiError.conflict('المكافأة مش على أي سطر في الفاتورة دي', { code: 'REWARD_NOT_APPLICABLE' });
    }
    const total = subtotal - discount - reward.amount;
    const tip = input.tip || 0;
    const due = total + tip;
    const active = new Map(db.methods.filter((m) => m.active).map((m) => [m.code, m]));
    const lines = input.payments || [];
    let paidSum = 0;
    let change = 0;
    lines.forEach((line, index) => {
      const method = active.get(line.method);
      if (!method) throw ApiError.unprocessable('طريقة الدفع دي مش متاحة', { code: 'BAD_METHOD', details: { [`payments.${index}.method`]: 'مش متاحة' } });
      if (line.tendered !== undefined && line.tendered !== null) {
        if (method.kind !== 'cash') throw ApiError.unprocessable('«اتدفع كام» للكاش بس', { code: 'VALIDATION_ERROR', details: { [`payments.${index}.tendered`]: 'للكاش بس' } });
        if (line.tendered < line.amount) throw ApiError.unprocessable('اللي اتدفع أقل من المبلغ', { code: 'VALIDATION_ERROR', details: { [`payments.${index}.tendered`]: 'أقل من المبلغ' } });
        change += line.tendered - line.amount;
      }
      line.resolved = method;
      paidSum += line.amount;
    });
    if (paidSum !== due) throw ApiError.unprocessable(`المدفوع ${paidSum / 100} ج والمطلوب ${due / 100} ج`, { code: 'PAYMENT_MISMATCH', details: { due, paid: paidSum } });
    const drawer = openDrawer(db);
    if (!drawer && (settings.cashier_enabled || lines.some((l) => l.resolved.kind === 'cash'))) {
      throw ApiError.conflict('افتح الدرج الأول', { code: 'DRAWER_CLOSED' });
    }
    const today = todayOf(db);
    settleItems(db, items, { discount, rewardShares: reward.shares });
    lines.forEach((line) => {
      insert(db, 'payments', {
        shop_id: 1, bill_id: bill.id, drawer_session_id: drawer ? drawer.id : null, business_date: today, kind: 'payment',
        method_code: line.method, method_label: line.resolved.label, method_kind: line.resolved.kind, amount: line.amount,
        tendered: line.tendered ?? null, reference: line.reference || null, reason: null, created_by: user.id, created_at: nowIso(), day_close_id: null,
      });
    });
    Object.assign(bill, {
      status: 'paid', subtotal, discount, discount_reason: discount > 0 ? input.discount_reason : null, reward_discount: reward.amount,
      total, tip, paid: due, change_given: change, reward_redeemed: reward.amount > 0, paid_date: today, paid_at: nowIso(), paid_by: user.id,
      updated_at: nowIso(),
    });
    const after = afterPaid(db, bill, { redeemed: reward.amount > 0, userId: user.id });
    return Object.assign(billView(db, id), { change, stamp_awarded_now: after.stamp });
  },

  void(db, id, reason, user, { canRefund }) {
    const before = billView(db, id);
    const bill = findBill(db, id);
    assertOpen(bill);
    if (bill.items.length > 0 && !canRefund) throw ApiError.forbidden('إلغاء فاتورة فيها سطور للمدير بس', { code: 'FORBIDDEN' });
    Object.assign(bill, { status: 'void', voided_at: nowIso(), voided_by: user.id, void_reason: reason });
    return { before, after: billView(db, id) };
  },

  refund(db, id, input, user) {
    const bill = findBill(db, id);
    if (bill.status !== 'paid') throw ApiError.conflict('المرتجع من فاتورة مدفوعة بس', { code: 'BILL_NOT_PAID' });
    const refundable = bill.paid - bill.refunded;
    if (input.amount > refundable) throw ApiError.unprocessable(`أقصى مرتجع ${refundable / 100} ج`, { code: 'VALIDATION_ERROR', details: { amount: 'أكبر من المدفوع' } });
    const method = db.methods.find((m) => m.code === input.method && m.active);
    if (!method) throw ApiError.unprocessable('طريقة الدفع دي مش متاحة', { code: 'BAD_METHOD', details: { method: 'مش متاحة' } });
    const drawer = openDrawer(db);
    if (method.kind === 'cash' && !drawer) throw ApiError.conflict('افتح الدرج الأول', { code: 'DRAWER_CLOSED' });
    (input.restock || []).forEach((line) => {
      const item = bill.items.find((i) => i.id === Number(line.item_id));
      if (!item || item.kind !== 'product' || !item.product_id) {
        throw ApiError.unprocessable('السطر ده مش منتج في الفاتورة', { code: 'VALIDATION_ERROR', details: { restock: 'سطر غلط' } });
      }
      const back = db.stockMoves.filter((m) => m.bill_id === bill.id && m.product_id === item.product_id && m.type === 'refund').reduce((s, m) => s + m.qty, 0);
      if (back + line.qty > item.qty) throw ApiError.unprocessable('الكمية أكبر من اللي اتباع', { code: 'VALIDATION_ERROR', details: { restock: 'أكبر من اللي اتباع' } });
      moveStock(db, { productId: item.product_id, type: 'refund', qty: line.qty, billId: bill.id, note: input.reason, userId: user.id });
    });
    insert(db, 'payments', {
      shop_id: 1, bill_id: bill.id, drawer_session_id: drawer ? drawer.id : null, business_date: todayOf(db), kind: 'refund',
      method_code: method.code, method_label: method.label, method_kind: method.kind, amount: -input.amount, tendered: null, reference: null,
      reason: input.reason, created_by: user.id, created_at: nowIso(), day_close_id: null,
    });
    bill.refunded += input.amount;
    if (bill.total > 0) {
      const kept = Math.max(0, bill.total - Math.min(bill.refunded, bill.total)) / bill.total;
      bill.items.forEach((item) => {
        if (item.settlement_id) return;
        item.commission = Math.round(applyRate(item.line_total - item.discount_share, item.commission_rate) * kept);
      });
    }
    return billView(db, id);
  },

  receipt(db, id) {
    const s = db.shop;
    return {
      shop: { name: s.name, slug: s.slug, phone: s.phone, whatsapp: s.whatsapp, address: s.address, city: s.city, url: `${appUrl()}/s/${s.slug}` },
      width: db.settings.receipt_width,
      footer: db.settings.receipt_footer,
      bill: billView(db, id),
    };
  },
};

/* ═══════════════════ الدرج ═══════════════════ */

const OUTFLOWS = ['expense', 'advance', 'payout', 'cash_out'];
const MOVE_TYPES = ['expense', 'advance', 'payout', 'cash_in', 'cash_out'];

export function drawerTotals(db, session) {
  const groups = new Map();
  db.payments.filter((p) => p.drawer_session_id === session.id).forEach((p) => {
    const key = p.method_code;
    const g = groups.get(key) || { code: p.method_code, label: p.method_label, kind: p.method_kind, received: 0, refunded: 0, count: 0 };
    if (p.amount > 0) g.received += p.amount;
    else g.refunded += -p.amount;
    g.count += 1;
    groups.set(key, g);
  });
  const movement = {};
  MOVE_TYPES.forEach((t) => { movement[t] = 0; });
  db.cashMoves.filter((m) => m.drawer_session_id === session.id).forEach((m) => { movement[m.type] += m.amount; });
  const list = Array.from(groups.values()).sort((a, b) => (a.kind !== 'cash') - (b.kind !== 'cash') || a.code.localeCompare(b.code));
  const cash = list.filter((g) => g.kind === 'cash').reduce((sum, g) => sum + g.received - g.refunded, 0);
  return {
    methods: list.map((g) => Object.assign({}, g, { net: g.received - g.refunded })),
    cash_payments: cash,
    movements: movement,
    expected_cash: session.opening_float + cash + movement.cash_in - OUTFLOWS.reduce((sum, t) => sum + movement[t], 0),
  };
}

const userName = (db, id) => {
  const u = id ? byId(db.users, id) : null;
  return u ? u.full_name : null;
};

function sessionRow(db, s) {
  return {
    id: s.id, business_date: s.business_date, status: s.status, opening_float: s.opening_float, opened_at: s.opened_at,
    expected_cash: s.expected_cash, counted_cash: s.counted_cash, variance: s.variance, closed_at: s.closed_at, note: s.note,
    day_close_id: s.day_close_id, opened_by_name: userName(db, s.opened_by), closed_by_name: userName(db, s.closed_by),
  };
}

function sessionView(db, s) {
  return Object.assign(sessionRow(db, s), {
    totals: drawerTotals(db, s),
    movements: db.cashMoves.filter((m) => m.drawer_session_id === s.id).sort((a, b) => b.id - a.id).map((m) => ({
      id: m.id, type: m.type, amount: m.amount, note: m.note, barber_id: m.barber_id, barber_name: barberName(db, m.barber_id),
      settlement_id: m.settlement_id, created_at: m.created_at, created_by_name: userName(db, m.created_by),
    })),
  });
}

export function addMovement(db, { type, amount, barberId = null, note = null, settlementId = null, userId = null }) {
  const drawer = openDrawer(db);
  if (!drawer) throw ApiError.conflict('افتح الدرج الأول', { code: 'DRAWER_CLOSED' });
  if (OUTFLOWS.includes(type)) {
    const available = drawerTotals(db, drawer).expected_cash;
    if (amount > available) throw ApiError.conflict(`الدرج فيه ${available / 100} ج بس`, { code: 'DRAWER_SHORT', details: { available } });
  }
  const row = insert(db, 'cashMoves', {
    drawer_session_id: drawer.id, business_date: todayOf(db), type, amount, barber_id: barberId, note, settlement_id: settlementId,
    created_by: userId, created_at: nowIso(), day_close_id: null,
  });
  return { id: row.id, drawer_session_id: drawer.id };
}

export const drawer = {
  current(db) {
    const s = openDrawer(db);
    return s ? sessionView(db, s) : null;
  },
  get(db, id) {
    const s = byId(db.drawers, id);
    if (!s) throw ApiError.notFound('الوردية غير موجودة', { code: 'DRAWER_NOT_FOUND' });
    return sessionView(db, s);
  },
  open(db, openingFloat, userId) {
    if (openDrawer(db)) throw ApiError.conflict('الدرج مفتوح بالفعل', { code: 'DRAWER_OPEN' });
    const s = insert(db, 'drawers', {
      business_date: todayOf(db), status: 'open', opening_float: openingFloat, opened_at: nowIso(), opened_by: userId,
      expected_cash: null, counted_cash: null, variance: null, closed_at: null, closed_by: null, note: null, day_close_id: null,
    });
    return sessionView(db, s);
  },
  movement(db, input, user, { canAdvance }) {
    if (input.type === 'advance' && !canAdvance) throw ApiError.forbidden('السُلف للمدير بس', { code: 'FORBIDDEN' });
    if (['advance', 'payout'].includes(input.type) && !input.barber_id) {
      throw ApiError.unprocessable('اختار الحلاق', { code: 'VALIDATION_ERROR', details: { barber_id: 'الحقل مطلوب' } });
    }
    if (input.barber_id && !byId(db.barbers, input.barber_id)) {
      throw ApiError.unprocessable('الحلاق غير موجود', { code: 'BAD_BARBER', details: { barber_id: 'غير موجود' } });
    }
    const { id, drawer_session_id: sid } = addMovement(db, {
      type: input.type, amount: input.amount, barberId: input.barber_id ?? null, note: input.note || null, userId: user.id,
    });
    return { id, session: sessionView(db, byId(db.drawers, sid)) };
  },
  close(db, counted, note, userId) {
    const s = openDrawer(db);
    if (!s) throw ApiError.conflict('مفيش درج مفتوح', { code: 'DRAWER_CLOSED' });
    const expected = drawerTotals(db, s).expected_cash;
    Object.assign(s, { status: 'closed', expected_cash: expected, counted_cash: counted, variance: counted - expected, closed_by: userId, closed_at: nowIso(), note: note || null });
    return sessionView(db, s);
  },
  sessions(db) {
    return db.drawers.slice().sort((a, b) => b.id - a.id).slice(0, 30).map((s) => sessionRow(db, s));
  },
};

/* ═══════════════════ تقفيل اليوم ═══════════════════ */

export function periodSummary(db, closeId = null) {
  const inScope = (row) => (closeId === null ? row.day_close_id === null : row.day_close_id === closeId);
  const paid = db.bills.filter((b) => b.status === 'paid' && inScope(b));
  const items = [];
  paid.forEach((b) => b.items.forEach((i) => items.push({ bill: b, item: i })));
  const net = (i) => i.line_total - i.discount_share - i.reward_share;
  const kindSum = (kind) => items.filter((x) => x.item.kind === kind).reduce((s, x) => s + net(x.item), 0);

  const payments = db.payments.filter(inScope);
  const methodsMap = new Map();
  payments.forEach((p) => {
    const g = methodsMap.get(p.method_code) || { code: p.method_code, label: p.method_label, kind: p.method_kind, net: 0, received: 0, count: 0 };
    g.net += p.amount;
    if (p.amount > 0) g.received += p.amount;
    g.count += 1;
    methodsMap.set(p.method_code, g);
  });
  const methodsList = Array.from(methodsMap.values()).sort((a, b) => (a.kind !== 'cash') - (b.kind !== 'cash') || a.code.localeCompare(b.code));
  const refunds = payments.filter((p) => p.kind === 'refund');
  const movements = { expense: 0, advance: 0, payout: 0, cash_in: 0, cash_out: 0 };
  db.cashMoves.filter(inScope).forEach((m) => { movements[m.type] += m.amount; });
  const drawers = db.drawers.filter(inScope).sort((a, b) => a.id - b.id).map((d) => ({
    id: d.id, status: d.status, opened_at: d.opened_at, closed_at: d.closed_at, opening_float: d.opening_float,
    expected_cash: d.expected_cash, counted_cash: d.counted_cash, variance: d.variance,
  }));

  const barberMap = new Map();
  items.forEach(({ bill, item }) => {
    if (!item.barber_id) return;
    const b = byId(db.barbers, item.barber_id);
    if (!b) return;
    const e = barberMap.get(b.id) || { id: b.id, name: b.name, services: 0, products: 0, commission: 0, tips: 0, customers: new Set() };
    if (item.kind === 'service') {
      e.services += net(item);
      e.customers.add(bill.id);
    } else e.products += net(item);
    e.commission += item.commission;
    barberMap.set(b.id, e);
  });
  paid.forEach((bill) => {
    if (bill.tip > 0 && bill.barber_id && barberMap.has(bill.barber_id)) barberMap.get(bill.barber_id).tips += bill.tip;
  });
  const starts = payments.map((p) => p.created_at).concat(db.drawers.filter(inScope).map((d) => d.opened_at), paid.map((b) => b.paid_at)).filter(Boolean).sort();
  const open = db.bills.filter((b) => b.status === 'open');

  return {
    period_start: starts[0] || nowIso(),
    bills: paid.length,
    auto_paid: paid.filter((b) => b.auto_paid).length,
    subtotal: paid.reduce((s, b) => s + b.subtotal, 0),
    discounts: paid.reduce((s, b) => s + b.discount, 0),
    rewards: paid.reduce((s, b) => s + b.reward_discount, 0),
    rewards_count: paid.filter((b) => b.reward_redeemed).length,
    sales: paid.reduce((s, b) => s + b.total, 0),
    services_sales: kindSum('service'),
    products_sales: kindSum('product'),
    products_qty: items.filter((x) => x.item.kind === 'product').reduce((s, x) => s + x.item.qty, 0),
    products_cost: items.filter((x) => x.item.kind === 'product').reduce((s, x) => s + (x.item.unit_cost || 0) * x.item.qty, 0),
    tips: paid.reduce((s, b) => s + b.tip, 0),
    refunds: refunds.reduce((s, p) => s - p.amount, 0),
    refunds_count: refunds.length,
    methods: methodsList,
    collected: methodsList.reduce((s, g) => s + g.net, 0),
    movements,
    drawers,
    variance: drawers.reduce((s, d) => s + (d.variance || 0), 0),
    barbers: Array.from(barberMap.values())
      .map((e) => ({ id: e.id, name: e.name, services: e.services, products: e.products, commission: e.commission, tips: e.tips, customers: e.customers.size }))
      .sort((a, b) => b.services - a.services || a.id - b.id),
    open_bills: closeId === null ? { count: open.length, total: open.reduce((s, b) => s + b.subtotal, 0) } : null,
  };
}

const emptySummary = (s) => s.bills === 0 && s.methods.length === 0 && s.drawers.length === 0 && Object.values(s.movements).every((v) => v === 0);

export const dayClose = {
  preview(db) {
    const summary = periodSummary(db);
    const open = openDrawer(db);
    return {
      business_date: todayOf(db),
      summary,
      blockers: [
        ...(open ? [{ code: 'DRAWER_OPEN', message: 'الدرج لسه مفتوح — اقفله بعدّ الكاش الأول' }] : []),
        ...(emptySummary(summary) ? [{ code: 'NOTHING_TO_CLOSE', message: 'مفيش حاجة جديدة من آخر تقفيل' }] : []),
      ],
      warnings: summary.open_bills.count > 0 ? [{ code: 'OPEN_BILLS', message: `فيه ${summary.open_bills.count} فاتورة مفتوحة — هتترحّل للتقفيل الجاي` }] : [],
    };
  },
  close(db, note, userId) {
    if (openDrawer(db)) throw ApiError.conflict('الدرج لسه مفتوح — اقفله بعدّ الكاش الأول', { code: 'DRAWER_OPEN' });
    const summary = periodSummary(db);
    if (emptySummary(summary)) throw ApiError.conflict('مفيش حاجة جديدة من آخر تقفيل', { code: 'NOTHING_TO_CLOSE' });
    const row = insert(db, 'dayCloses', {
      shop_id: 1, number: counter(db, 'day_close'), business_date: todayOf(db), period_start: summary.period_start, period_end: nowIso(),
      summary, note: note || null, closed_by: userId, created_at: nowIso(),
    });
    db.bills.forEach((b) => { if (b.status === 'paid' && b.day_close_id === null) b.day_close_id = row.id; });
    db.payments.forEach((p) => { if (p.day_close_id === null) p.day_close_id = row.id; });
    db.cashMoves.forEach((m) => { if (m.day_close_id === null) m.day_close_id = row.id; });
    db.drawers.forEach((d) => { if (d.status === 'closed' && d.day_close_id === null) d.day_close_id = row.id; });
    return dayClose.get(db, row.id);
  },
  list(db) {
    return db.dayCloses.slice().sort((a, b) => b.id - a.id).slice(0, 30).map((d) => ({
      id: d.id, number: d.number, business_date: d.business_date, period_start: d.period_start, period_end: d.period_end, note: d.note,
      created_at: d.created_at, closed_by_name: userName(db, d.closed_by), sales: d.summary.sales, collected: d.summary.collected,
      variance: d.summary.variance, bills: d.summary.bills,
    }));
  },
  get(db, id) {
    const d = byId(db.dayCloses, id);
    if (!d) throw ApiError.notFound('التقفيل غير موجود', { code: 'DAY_CLOSE_NOT_FOUND' });
    return Object.assign({}, d, { closed_by_name: userName(db, d.closed_by) });
  },
};

/* ═══════════════════ المنتجات والمخزن ═══════════════════ */

export const shapeProduct = (p) => Object.assign({}, p, {
  low_stock: Boolean(p.track_stock) && p.low_stock_at !== null && p.stock_qty <= p.low_stock_at,
});

function findProduct(db, id) {
  const p = byId(db.products, id);
  if (!p) throw ApiError.notFound('المنتج غير موجود', { code: 'PRODUCT_NOT_FOUND' });
  return p;
}

const barcodeTaken = () => ApiError.conflict('الباركود ده متسجّل على منتج تاني', { code: 'BARCODE_TAKEN', details: { barcode: 'متسجّل على منتج تاني' } });

export function moveStock(db, { productId, type, qty, unitCost = null, billId = null, note = null, userId = null }) {
  const p = findProduct(db, productId);
  if (!p.track_stock) return null;
  const after = p.stock_qty + qty;
  p.cost = type === 'purchase' && unitCost !== null ? weightedCost(p.stock_qty, p.cost, qty, unitCost) : p.cost;
  p.stock_qty = after;
  insert(db, 'stockMoves', { product_id: p.id, type, qty, unit_cost: unitCost, stock_after: after, bill_id: billId, note, created_by: userId, created_at: nowIso() });
  return after;
}

export const products = {
  list(db, { includeArchived = false, q } = {}) {
    return db.products
      .filter((p) => (includeArchived || !p.archived_at) && (!q || p.name.includes(q) || p.barcode === q))
      .sort((a, b) => (a.archived_at !== null) - (b.archived_at !== null) || a.sort_order - b.sort_order || a.id - b.id)
      .map(shapeProduct);
  },
  get: (db, id) => shapeProduct(findProduct(db, id)),
  lookup(db, barcode) {
    const p = db.products.find((x) => x.barcode === barcode && !x.archived_at);
    if (!p) throw ApiError.notFound('مفيش منتج بالباركود ده', { code: 'BARCODE_NOT_FOUND' });
    return shapeProduct(p);
  },
  create(db, input, userId) {
    if (input.barcode && db.products.some((p) => p.barcode === input.barcode)) throw barcodeTaken();
    const order = db.products.reduce((max, p) => Math.max(max, p.sort_order), 0) + 10;
    const p = insert(db, 'products', {
      name: input.name, barcode: input.barcode || null, price: input.price, cost: input.cost || 0, track_stock: input.track_stock ?? true,
      stock_qty: 0, low_stock_at: input.low_stock_at ?? null, active: input.active ?? true, sort_order: order, archived_at: null,
      created_at: nowIso(), updated_at: nowIso(),
    });
    if (input.initial_qty && p.track_stock) moveStock(db, { productId: p.id, type: 'purchase', qty: input.initial_qty, unitCost: input.cost || 0, note: 'رصيد أوّل', userId });
    return shapeProduct(p);
  },
  update(db, id, changes) {
    const p = findProduct(db, id);
    const before = shapeProduct(p);
    if (p.archived_at) throw ApiError.conflict('المنتج مؤرشف — رجّعه الأول', { code: 'PRODUCT_ARCHIVED' });
    if (changes.barcode && db.products.some((x) => x.id !== p.id && x.barcode === changes.barcode)) throw barcodeTaken();
    ['name', 'barcode', 'price', 'cost', 'track_stock', 'low_stock_at', 'active'].forEach((k) => { if (changes[k] !== undefined) p[k] = changes[k]; });
    p.updated_at = nowIso();
    return { before, after: shapeProduct(p) };
  },
  archive(db, id) {
    const p = findProduct(db, id);
    const before = shapeProduct(p);
    p.archived_at = p.archived_at || nowIso();
    p.active = false;
    return before;
  },
  restore(db, id) {
    const p = findProduct(db, id);
    p.archived_at = null;
    p.active = true;
    return shapeProduct(p);
  },
  stock(db, id, input, userId) {
    const p = findProduct(db, id);
    if (!p.track_stock) throw ApiError.conflict('المنتج ده مش متتبّع مخزنه', { code: 'STOCK_NOT_TRACKED' });
    if (input.type === 'purchase') moveStock(db, { productId: p.id, type: 'purchase', qty: input.qty, unitCost: input.unit_cost ?? p.cost, note: input.note || null, userId });
    else if (input.type === 'use') moveStock(db, { productId: p.id, type: 'use', qty: -input.qty, note: input.note || null, userId });
    else {
      const delta = input.counted_qty - p.stock_qty;
      if (delta !== 0) moveStock(db, { productId: p.id, type: 'adjust', qty: delta, note: input.note, userId });
    }
    return shapeProduct(p);
  },
  movements(db, id) {
    findProduct(db, id);
    return db.stockMoves.filter((m) => m.product_id === Number(id)).sort((a, b) => b.id - a.id).slice(0, 50).map((m) => ({
      id: m.id, type: m.type, qty: m.qty, unit_cost: m.unit_cost, stock_after: m.stock_after, bill_id: m.bill_id, note: m.note,
      created_at: m.created_at, created_by_name: userName(db, m.created_by),
    }));
  },
};

/* ═══════════════════ حساب الحلاقين ═══════════════════ */

export function markBarberDay(db, barberId, date) {
  if (db.barberDays.some((d) => d.barber_id === barberId && d.business_date === date)) return;
  db.barberDays.push({ barber_id: barberId, business_date: date, settlement_id: null });
}

export function rentFor(pay, periodDays, daysWorked) {
  if (!pay.rent_amount) return 0;
  if (pay.rent_period === 'day') return pay.rent_amount * daysWorked;
  if (pay.rent_period === 'week') return Math.round((pay.rent_amount * periodDays) / 7);
  return Math.round((pay.rent_amount * periodDays) / 30);
}

const PAY_FIELDS = ['pay_type', 'service_pct', 'product_pct', 'daily_wage', 'rent_amount', 'rent_period', 'tips_to_barber'];
const payOf = (b) => {
  const out = {};
  PAY_FIELDS.forEach((k) => { out[k] = b[k]; });
  return out;
};

function payBarber(db, id) {
  const b = byId(db.barbers, id);
  if (!b) throw ApiError.notFound('الحلاق غير موجود', { code: 'BARBER_NOT_FOUND' });
  return b;
}

function computePay(db, barber, to) {
  const lastTo = db.settlements.filter((s) => s.barber_id === barber.id).reduce((max, s) => (s.period_to > max ? s.period_to : max), '') || null;
  if (lastTo && to < lastTo) {
    throw ApiError.unprocessable(`آخر حساب كان لحد ${lastTo} — اختار تاريخ بعده`, { code: 'VALIDATION_ERROR', details: { to: 'قبل آخر حساب' } });
  }
  const openLines = [];
  db.bills.forEach((bill) => {
    if (bill.status !== 'paid') return;
    bill.items.forEach((item) => {
      if (item.barber_id === barber.id && !item.settlement_id) openLines.push({ bill, item });
    });
  });
  const firstDates = db.barberDays.filter((d) => d.barber_id === barber.id && !d.settlement_id).map((d) => d.business_date)
    .concat(openLines.map((x) => x.bill.paid_date)).sort();
  const first = firstDates[0] || '9999-12-31';
  const from = lastTo ? (to > lastTo ? addDays(lastTo, 1) : to) : (first !== '9999-12-31' && first <= to ? first : to);
  const periodDays = lastTo ? diffDays(lastTo, to) : diffDays(from, to) + 1;

  const lines = openLines.filter((x) => x.bill.paid_date <= to);
  const net = (i) => i.line_total - i.discount_share - i.reward_share;
  const sumKind = (kind, f) => lines.filter((x) => x.item.kind === kind).reduce((s, x) => s + f(x.item), 0);
  const tips = db.bills.filter((b) => b.barber_id === barber.id && b.status === 'paid' && b.tip > 0 && !b.tip_settlement_id && b.paid_date <= to)
    .reduce((s, b) => s + Math.max(0, b.tip - Math.max(0, b.refunded - b.total)), 0);
  const daysWorked = db.barberDays.filter((d) => d.barber_id === barber.id && !d.settlement_id && d.business_date <= to).length;
  const advanceRows = db.cashMoves.filter((m) => m.barber_id === barber.id && m.type === 'advance' && !m.settlement_id && m.business_date <= to);

  const result = {
    barber_id: barber.id,
    barber_name: barber.name,
    pay: payOf(barber),
    period_from: from,
    period_to: to,
    period_days: periodDays,
    days_worked: daysWorked,
    services_total: sumKind('service', net),
    services_count: lines.filter((x) => x.item.kind === 'service').length,
    products_total: sumKind('product', net),
    service_commission: sumKind('service', (i) => i.commission),
    product_commission: sumKind('product', (i) => i.commission),
    wages: daysWorked * barber.daily_wage,
    tips: barber.tips_to_barber ? tips : 0,
    rent: rentFor(barber, periodDays, daysWorked),
    advances: advanceRows.reduce((s, m) => s + m.amount, 0),
    advance_list: advanceRows.map((m) => ({ id: m.id, amount: m.amount, note: m.note, business_date: m.business_date, created_at: m.created_at })),
  };
  result.earnings = result.wages + result.service_commission + result.product_commission + result.tips;
  result.net = result.earnings - result.rent - result.advances;
  return result;
}

function settlementView(db, s) {
  return Object.assign({}, s, { barber_name: barberName(db, s.barber_id), created_by_name: userName(db, s.created_by) });
}

export const payroll = {
  barbers(db) {
    return db.barbers.filter((b) => !b.archived_at).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id).map((b) => {
      const last = db.settlements.filter((s) => s.barber_id === b.id).reduce((max, s) => (s.period_to > max ? s.period_to : max), '') || null;
      return Object.assign({ id: b.id, name: b.name, created_at: b.created_at, archived_at: b.archived_at }, payOf(b), { last_settled_to: last });
    });
  },
  setPay(db, id, input) {
    const b = payBarber(db, id);
    const before = payOf(b);
    PAY_FIELDS.forEach((k) => { if (input[k] !== undefined) b[k] = input[k]; });
    return { before, after: Object.assign({ id: b.id, name: b.name, created_at: b.created_at, archived_at: b.archived_at }, payOf(b)) };
  },
  preview(db, barberId, to) {
    return computePay(db, payBarber(db, barberId), to || todayOf(db));
  },
  settle(db, barberId, { to, via, note }, user) {
    const today = todayOf(db);
    const date = to || today;
    if (date > today) throw ApiError.unprocessable('مينفعش تحاسب على أيام لسه ما جتش', { code: 'VALIDATION_ERROR', details: { to: 'بعد النهارده' } });
    const barber = payBarber(db, barberId);
    const calc = computePay(db, barber, date);
    const nothing = calc.days_worked === 0 && calc.services_count === 0 && calc.products_total === 0 && calc.tips === 0 && calc.advances === 0 && calc.rent === 0;
    if (nothing) throw ApiError.conflict('مفيش حاجة تتحسب للفترة دي', { code: 'NOTHING_TO_SETTLE' });
    const settledVia = calc.net === 0 ? 'none' : via;
    if (settledVia === 'drawer' && !openDrawer(db)) throw ApiError.conflict('افتح الدرج الأول', { code: 'DRAWER_CLOSED' });
    if (settledVia === 'drawer' && calc.net > 0) {
      const available = drawerTotals(db, openDrawer(db)).expected_cash;
      if (calc.net > available) throw ApiError.conflict(`الدرج فيه ${available / 100} ج بس`, { code: 'DRAWER_SHORT', details: { available } });
    }
    const s = insert(db, 'settlements', {
      shop_id: 1, barber_id: barber.id, period_from: calc.period_from, period_to: calc.period_to, pay_snapshot: calc.pay,
      days_worked: calc.days_worked, services_total: calc.services_total, products_total: calc.products_total,
      service_commission: calc.service_commission, product_commission: calc.product_commission, wages: calc.wages, tips: calc.tips,
      rent: calc.rent, advances: calc.advances, net: calc.net, settled_via: settledVia, note: note || null, cash_movement_id: null,
      created_by: user.id, created_at: nowIso(),
    });
    db.bills.forEach((bill) => {
      if (bill.status !== 'paid' || bill.paid_date > date) return;
      bill.items.forEach((item) => { if (item.barber_id === barber.id && !item.settlement_id) item.settlement_id = s.id; });
      if (barber.tips_to_barber && bill.barber_id === barber.id && bill.tip > 0 && !bill.tip_settlement_id) bill.tip_settlement_id = s.id;
    });
    db.barberDays.forEach((d) => { if (d.barber_id === barber.id && !d.settlement_id && d.business_date <= date) d.settlement_id = s.id; });
    db.cashMoves.forEach((m) => { if (m.barber_id === barber.id && m.type === 'advance' && !m.settlement_id && m.business_date <= date) m.settlement_id = s.id; });
    if (settledVia === 'drawer') {
      const move = addMovement(db, {
        type: calc.net > 0 ? 'payout' : 'cash_in', amount: Math.abs(calc.net), barberId: barber.id,
        note: calc.net > 0 ? `حساب ${barber.name} لحد ${date}` : `${barber.name} دفع اللي عليه لحد ${date}`, settlementId: s.id, userId: user.id,
      });
      s.cash_movement_id = move.id;
    }
    return settlementView(db, s);
  },
  get(db, id) {
    const s = byId(db.settlements, id);
    if (!s) throw ApiError.notFound('الحساب غير موجود', { code: 'SETTLEMENT_NOT_FOUND' });
    return settlementView(db, s);
  },
  list(db, barberId) {
    return db.settlements.filter((s) => !barberId || s.barber_id === Number(barberId)).sort((a, b) => b.id - a.id).slice(0, 100).map((s) => settlementView(db, s));
  },
};

/* ═══════════════════ التقارير ═══════════════════ */

const round1 = (v) => (v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v * 10) / 10);
const avg = (list) => (list.length ? list.reduce((s, v) => s + v, 0) / list.length : null);
const minutesBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 60000;

export function summary(db, from, to) {
  const tickets = db.tickets.filter((t) => t.business_date >= from && t.business_date <= to);
  const paid = db.bills.filter((b) => b.status === 'paid' && b.paid_date >= from && b.paid_date <= to);
  const items = [];
  paid.forEach((b) => b.items.forEach((i) => items.push(i)));
  const net = (i) => i.line_total - i.discount_share - i.reward_share;
  const payments = db.payments.filter((p) => p.business_date >= from && p.business_date <= to);
  const methodsMap = new Map();
  payments.forEach((p) => {
    const g = methodsMap.get(p.method_code) || { code: p.method_code, label: p.method_label, kind: p.method_kind, net: 0, count: 0 };
    g.net += p.amount;
    g.count += 1;
    methodsMap.set(p.method_code, g);
  });
  const methodsList = Array.from(methodsMap.values()).sort((a, b) => (a.kind !== 'cash') - (b.kind !== 'cash') || b.net - a.net);
  const refunds = payments.filter((p) => p.kind === 'refund').reduce((s, p) => s - p.amount, 0);
  const expenses = db.cashMoves.filter((m) => m.type === 'expense' && m.business_date >= from && m.business_date <= to).reduce((s, m) => s + m.amount, 0);

  const byBarber = new Map();
  const entry = (b) => {
    if (!byBarber.has(b.id)) byBarber.set(b.id, { id: b.id, name: b.name, chair_no: b.chair_no, done: 0, revenue: 0, products: 0, commission: 0, avg_service_minutes: null, _mins: [] });
    return byBarber.get(b.id);
  };
  tickets.filter((t) => t.status === 'done' && t.barber_id).forEach((t) => {
    const b = byId(db.barbers, t.barber_id);
    if (!b) return;
    const e = entry(b);
    e.done += 1;
    if (t.ended_by !== 'system' && t.started_at && t.finished_at) e._mins.push(minutesBetween(t.started_at, t.finished_at));
  });
  items.forEach((i) => {
    const b = i.barber_id ? byId(db.barbers, i.barber_id) : null;
    if (!b) return;
    const e = entry(b);
    if (i.kind === 'service') e.revenue += net(i);
    else e.products += net(i);
    e.commission += i.commission;
  });
  const barbers = Array.from(byBarber.values()).map((e) => {
    const out = Object.assign({}, e, { avg_service_minutes: round1(avg(e._mins)) });
    delete out._mins;
    return out;
  }).sort((a, b) => b.revenue - a.revenue || a.id - b.id);

  const serviceMap = new Map();
  items.filter((i) => i.kind === 'service').forEach((i) => {
    const g = serviceMap.get(i.name) || { name: i.name, count: 0, revenue: 0 };
    g.count += i.qty;
    g.revenue += net(i);
    serviceMap.set(i.name, g);
  });
  const productMap = new Map();
  items.filter((i) => i.kind === 'product').forEach((i) => {
    const g = productMap.get(i.product_id) || { id: i.product_id, name: i.name, qty: 0, revenue: 0, cost: 0 };
    g.qty += i.qty;
    g.revenue += net(i);
    g.cost += (i.unit_cost || 0) * i.qty;
    productMap.set(i.product_id, g);
  });
  const waits = tickets.filter((t) => t.started_at).map((t) => minutesBetween(t.arrived_at || t.created_at, t.started_at));
  const services = tickets.filter((t) => t.status === 'done' && t.ended_by !== 'system' && t.started_at && t.finished_at).map((t) => minutesBetween(t.started_at, t.finished_at));
  const sales = paid.reduce((s, b) => s + b.total, 0);
  const open = db.bills.filter((b) => b.status === 'open');
  const kindNet = (kind) => items.filter((i) => i.kind === kind).reduce((s, i) => s + net(i), 0);
  const count = (f) => tickets.filter(f).length;

  return {
    from,
    to,
    business_date: from === to ? from : undefined,
    tickets: tickets.length,
    done: count((t) => t.status === 'done'),
    cancelled: count((t) => t.status === 'cancelled'),
    no_show: count((t) => t.status === 'no_show'),
    active: count((t) => t.status === 'waiting' || t.status === 'serving'),
    by_source: { app: count((t) => t.source === 'app'), kiosk: count((t) => t.source === 'kiosk'), staff: count((t) => t.source === 'staff') },
    revenue: sales,
    bills: paid.length,
    services_revenue: kindNet('service'),
    products_revenue: kindNet('product'),
    products_cost: items.filter((i) => i.kind === 'product').reduce((s, i) => s + (i.unit_cost || 0) * i.qty, 0),
    discounts: paid.reduce((s, b) => s + b.discount, 0),
    rewards: paid.reduce((s, b) => s + b.reward_discount, 0),
    tips: paid.reduce((s, b) => s + b.tip, 0),
    refunds,
    net_revenue: sales - refunds,
    expenses,
    methods: methodsList,
    collected: methodsList.reduce((s, g) => s + g.net, 0),
    open_bills: { count: open.length, total: open.reduce((s, b) => s + b.subtotal, 0) },
    avg_wait_minutes: round1(avg(waits)),
    avg_service_minutes: round1(avg(services)),
    barbers,
    services: Array.from(serviceMap.values()).sort((a, b) => b.count - a.count || b.revenue - a.revenue || a.name.localeCompare(b.name, 'ar')),
    products: Array.from(productMap.values()).sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'ar')),
  };
}

export function dailySales(db, from, to) {
  const map = new Map();
  db.bills.filter((b) => b.status === 'paid' && b.paid_date >= from && b.paid_date <= to).forEach((b) => {
    const g = map.get(b.paid_date) || { date: b.paid_date, bills: 0, sales: 0 };
    g.bills += 1;
    g.sales += b.total;
    map.set(b.paid_date, g);
  });
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}
