/* ============================================
   نعيمًا التجريبي - الطابور
   نفس server/src/modules/queue/queue.service.js من غير قاعدة بيانات:
   القرارات من queue/engine.js والانتقالات من queue/states.js (مستوردين من
   السيرفر نفسه)، والمهل (sweep) و«قرّب دورك» بيتطبّقوا قبل كل تعديل.
   ============================================ */
import {
  KEY_STEP, delayTarget, estimateQueue, keyAt, learnStat, pickNext, roundedWait, ticketMinutes,
} from '../../../server/src/queue/engine.js';
import { assertTransition } from '../../../server/src/queue/states.js';
import {
  ApiError, MINUTE, byId, counter, insert, nowIso, openState, todayOf, toDate,
} from './base.js';
import { cardSummaries, linkCard, markBarberDay, onTicketDone } from './money.js';

export { roundedWait, ticketMinutes };

const ACTIVE = ['waiting', 'serving'];

/* ---------- صورة الطابور ---------- */

/** نسخة من الدور بأوقات Date (المحرّك محتاجها كده) */
function engineTicket(t) {
  return Object.assign({}, t, {
    started_at: toDate(t.started_at),
    created_at: toDate(t.created_at),
    called_at: toDate(t.called_at),
    arrived_at: toDate(t.arrived_at),
    near_notified_at: toDate(t.near_notified_at),
    confirmed_at: toDate(t.confirmed_at),
    services: t.services.map((s) => ({ id: s.id, service_id: s.service_id, name: s.name, price: s.price, minutes: s.minutes })),
  });
}

export function loadState(db, now = new Date()) {
  const barbers = db.barbers
    .filter((b) => !b.archived_at)
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
    .map((b) => ({
      id: b.id, name: b.name, chair_no: b.chair_no, status: b.status,
      break_until: toDate(b.break_until), photo_path: b.photo_path || null,
    }));
  const rows = db.tickets.filter((t) => ACTIVE.includes(t.status)).sort((a, b) => a.sort_key - b.sort_key || a.id - b.id);
  const tickets = rows.map(engineTicket);
  const stats = new Map(Object.keys(db.stats).map((key) => [key, db.stats[key]]));
  return {
    now, shop: db.shop, settings: db.settings, hours: db.hours, barbers, tickets, rows, stats,
    version: db.version,
    waiting: () => tickets.filter((t) => t.status === 'waiting'),
  };
}

export const estimate = (state) => estimateQueue({ now: state.now, barbers: state.barbers, tickets: state.tickets, stats: state.stats });

/** صفّ الدور الأصلي في db من صورة المحرّك */
const rowOf = (db, ticket) => byId(db.tickets, ticket.id);

/* ---------- السجل ---------- */

export function ticketEvent(db, ticket, type, actor, data) {
  insert(db, 'ticketEvents', {
    ticket_id: ticket.id, type, actor_type: actor.type, actor_id: actor.id ?? null,
    data: data || null, created_at: nowIso(),
  });
}

/* ---------- المهل ---------- */

function placeTicket(db, waiting, ticket, index) {
  const others = waiting.filter((item) => item.id !== ticket.id);
  const key = keyAt(others, index);
  if (key !== null) {
    rowOf(db, ticket).sort_key = key;
    ticket.sort_key = key;
    return;
  }
  const ordered = others.slice();
  ordered.splice(index, 0, ticket);
  ordered.forEach((item, position) => {
    item.sort_key = (position + 1) * KEY_STEP;
    rowOf(db, item).sort_key = item.sort_key;
  });
}

function endTicket(db, ticket, to, actor, reason) {
  assertTransition(ticket.status, to, actor.type);
  const row = rowOf(db, ticket);
  row.status = to;
  row.ended_by = actor.type;
  row.end_reason = reason || null;
  if (to === 'done') row.finished_at = nowIso();
  ticketEvent(db, ticket, to, actor, reason ? { reason } : null);
  ticket.status = to;
  // الدور خلص = فاتورة (ولو الكاشير مقفول بتتسدّد كاش لوحدها)
  if (to === 'done') onTicketDone(db, row);
}

const SYSTEM = { type: 'system' };

export function applySweep(db, state) {
  const { now, settings } = state;
  const graceMs = settings.grace_minutes * MINUTE;
  const today = todayOf(db, now);
  const waiting = () => state.tickets.filter((t) => t.status === 'waiting').sort((a, b) => a.sort_key - b.sort_key);
  let changed = false;

  for (const ticket of state.tickets.slice()) {
    if (ticket.business_date < today) {
      if (ticket.status === 'waiting') endTicket(db, ticket, 'cancelled', SYSTEM, 'day_closed');
      else endTicket(db, ticket, 'done', SYSTEM, 'day_closed');
      changed = true;
      continue;
    }
    if (ticket.status !== 'waiting') continue;

    if (ticket.called_at && !ticket.arrived_at && now - ticket.called_at > graceMs) {
      const target = ticket.auto_delayed ? null : delayTarget(waiting(), ticket.id, 2);
      if (!ticket.auto_delayed && target === null) continue;
      if (ticket.auto_delayed) {
        endTicket(db, ticket, 'no_show', SYSTEM, 'grace_expired');
      } else {
        placeTicket(db, waiting(), ticket, target);
        const row = rowOf(db, ticket);
        row.auto_delayed = true;
        row.called_at = null;
        ticketEvent(db, ticket, 'auto_delayed', SYSTEM, { steps: 2 });
      }
      changed = true;
      continue;
    }

    if (ticket.trust_confirm_required && !ticket.confirmed_at && ticket.near_notified_at && now - ticket.near_notified_at > graceMs) {
      endTicket(db, ticket, 'cancelled', SYSTEM, 'not_confirmed');
      changed = true;
    }
  }
  return changed;
}

function notifyNear(db, state) {
  const estimates = estimate(state).tickets;
  for (const ticket of state.waiting()) {
    if (!ticket.customer_id || ticket.near_notified_at) continue;
    const e = estimates.get(ticket.id);
    if (!e || e.ahead === null || e.ahead > state.settings.notify_ahead) continue;
    const row = rowOf(db, ticket);
    const justCreated = state.now - ticket.created_at < MINUTE;
    row.near_notified_at = nowIso();
    if (justCreated && !row.confirmed_at) row.confirmed_at = nowIso();
  }
}

/** تعديل على الطابور: المهل الأول، والتعديل، و«قرّب دورك»، وزيادة النسخة */
export function withQueue(db, handler) {
  const now = new Date();
  let state = loadState(db, now);
  if (applySweep(db, state)) state = loadState(db, now);
  const output = handler(state);
  notifyNear(db, loadState(db, now));
  db.version += 1;
  return output;
}

/** المهام الدورية (السيرفر بيشغّلها كل شوية) */
export function sweep(db) {
  const state = loadState(db);
  if (!applySweep(db, state)) return false;
  notifyNear(db, loadState(db, state.now));
  db.version += 1;
  return true;
}

/** تغيير من برّه الطابور (حالة حلاق مثلًا): الشاشات تعيد الحساب */
export function touch(db) {
  db.version += 1;
}

/* ---------- العرض ---------- */

export function ticketView(ticket, e, now) {
  return {
    id: ticket.id,
    number: ticket.number,
    name: ticket.name,
    phone: ticket.phone,
    card_id: ticket.shop_customer_id ?? null,
    source: ticket.source,
    status: ticket.status,
    preferred_barber_id: ticket.preferred_barber_id,
    barber_id: ticket.barber_id,
    expected_barber_id: e ? e.barberId ?? null : null,
    arrived: Boolean(ticket.arrived_at),
    arrived_at: ticket.arrived_at ? nowIso(new Date(ticket.arrived_at).getTime()) : null,
    called_at: ticket.called_at ? nowIso(new Date(ticket.called_at).getTime()) : null,
    delays_used: ticket.delays_used,
    auto_delayed: Boolean(ticket.auto_delayed),
    trust_confirm_required: Boolean(ticket.trust_confirm_required),
    confirmed: Boolean(ticket.confirmed_at),
    services: ticket.services.map((s) => ({ id: s.id, service_id: s.service_id, name: s.name, price: s.price, minutes: s.minutes })),
    total: Number(ticket.total),
    created_at: ticket.created_at ? nowIso(new Date(ticket.created_at).getTime()) : null,
    started_at: ticket.started_at ? nowIso(new Date(ticket.started_at).getTime()) : null,
    eta: e && e.start ? e.start.toISOString() : null,
    wait_minutes: e && e.start ? Math.max(0, Math.round((e.start - now) / MINUTE)) : null,
    ahead: e ? e.ahead ?? null : null,
    unavailable: Boolean(e && e.unavailable),
  };
}

export function staffView(db, state) {
  const { now } = state;
  const result = estimate(state);
  const serving = new Map(state.tickets.filter((t) => t.status === 'serving').map((t) => [t.barber_id, t]));
  const view = {
    version: state.version,
    now: now.toISOString(),
    open: openState(db, now),
    accepting_tickets: Boolean(db.shop.accepting_tickets),
    settings: {
      grace_minutes: state.settings.grace_minutes,
      notify_ahead: state.settings.notify_ahead,
      max_delays: state.settings.max_delays,
    },
    barbers: state.barbers.map((barber) => ({
      id: barber.id,
      name: barber.name,
      chair_no: barber.chair_no,
      status: barber.status,
      break_until: barber.break_until ? barber.break_until.toISOString() : null,
      photo_path: barber.photo_path,
      free_at: result.freeAt.has(barber.id) ? result.freeAt.get(barber.id).toISOString() : null,
      serving: serving.has(barber.id) ? ticketView(serving.get(barber.id), null, now) : null,
    })),
    waiting: state.waiting().map((t) => ticketView(t, result.tickets.get(t.id), now)),
  };
  const all = view.waiting.concat(view.barbers.map((b) => b.serving).filter(Boolean));
  const cards = cardSummaries(db, all.map((t) => t.card_id));
  all.forEach((t) => {
    t.card = cards.get(t.card_id) ?? null;
  });
  return view;
}

/** الوقت المتوقّع لدور «تجريبي» لو اتضاف دلوقتي */
export function probeStart(state, barberId = null) {
  const probe = { id: -1, status: 'waiting', preferred_barber_id: barberId, services: [] };
  return estimateQueue({ now: state.now, barbers: state.barbers, tickets: state.tickets.concat([probe]), stats: state.stats }).tickets.get(-1);
}

export function getTicket(db, ticketId) {
  const row = byId(db.tickets, ticketId);
  if (!row) throw ApiError.notFound('الدور غير موجود', { code: 'TICKET_NOT_FOUND' });
  const now = new Date();
  let e = null;
  if (row.status === 'waiting') e = estimate(loadState(db, now)).tickets.get(row.id) ?? null;
  const events = db.ticketEvents.filter((ev) => ev.ticket_id === row.id).map((ev) => ({
    type: ev.type, actor_type: ev.actor_type, actor_id: ev.actor_id, data: ev.data, created_at: ev.created_at,
  }));
  return Object.assign(ticketView(engineTicket(row), e, now), {
    business_date: row.business_date, finished_at: row.finished_at, end_reason: row.end_reason, events,
  });
}

/* ---------- أدوات العمليات ---------- */

function findActive(state, ticketId) {
  const ticket = state.tickets.find((t) => t.id === Number(ticketId));
  if (ticket) return ticket;
  throw ApiError.notFound('الدور مش في الطابور (خلص أو اتلغى أو مش موجود)', { code: 'TICKET_NOT_ACTIVE' });
}

function findWaiting(state, ticketId) {
  const ticket = findActive(state, ticketId);
  if (ticket.status !== 'waiting') throw ApiError.conflict('الدور ده على الكرسي بالفعل', { code: 'TICKET_SERVING' });
  return ticket;
}

function findBarber(state, barberId, { mustBePresent = false } = {}) {
  const barber = state.barbers.find((b) => b.id === Number(barberId));
  if (!barber) throw ApiError.unprocessable('الحلاق غير موجود', { code: 'BAD_BARBER', details: { barber_id: 'غير موجود' } });
  if (mustBePresent && barber.status === 'off') {
    throw ApiError.conflict(`${barber.name} مش موجود النهارده`, { code: 'BARBER_OFF', details: { barber_id: 'مش موجود النهارده' } });
  }
  return barber;
}

function loadServices(db, serviceIds) {
  const ids = Array.from(new Set(serviceIds.map(Number)));
  const rows = ids.map((id) => db.services.find((s) => s.id === id && !s.archived_at && s.active));
  if (rows.some((r) => !r)) {
    throw ApiError.unprocessable('خدمة غير موجودة أو موقوفة', { code: 'BAD_SERVICE', details: { service_ids: 'خدمة غير موجودة أو موقوفة' } });
  }
  return rows;
}

function addTicketService(db, row, service, addedBy) {
  db.seq.ticketServices = (db.seq.ticketServices || 0) + 1;
  row.services.push({
    id: db.seq.ticketServices, service_id: service.id, name: service.name, price: service.price,
    minutes: service.default_minutes, added_by: addedBy,
  });
  row.total += service.price;
}

function finishServing(db, state, ticket, actor) {
  endTicket(db, ticket, 'done', actor, null);
  const minutes = ticket.started_at ? (state.now - ticket.started_at) / MINUTE : null;
  if (minutes !== null && ticket.services.length === 1 && ticket.barber_id) {
    const service = ticket.services[0];
    const key = `${ticket.barber_id}:${service.service_id}`;
    const learned = learnStat(state.stats.get(key), service.minutes, minutes);
    if (learned) db.stats[key] = learned;
  }
}

/* ---------- العمليات ---------- */

export const queue = {
  view(db, { since } = {}) {
    if (since !== undefined && since !== null && Number(since) === db.version) return { changed: false, version: db.version };
    return staffView(db, loadState(db));
  },

  create(db, input, actor) {
    const id = withQueue(db, (state) => {
      const { now, settings } = state;
      const services = loadServices(db, input.service_ids);
      const barberId = input.barber_id ?? null;
      if (barberId !== null) findBarber(state, barberId, { mustBePresent: input.source !== 'staff' });

      const status = openState(db, now);
      if (input.source !== 'staff') {
        if (!db.shop.accepting_tickets) throw ApiError.conflict('المحل موقّف الأدوار دلوقتي', { code: 'QUEUE_PAUSED' });
        if (!status.open) throw ApiError.conflict('المحل قافل دلوقتي', { code: 'SHOP_CLOSED', details: { next_opens_at: status.next_opens_at } });
      }

      const businessDate = todayOf(db, now);
      if (input.source !== 'staff' && settings.max_tickets_per_day) {
        const n = db.tickets.filter((t) => t.business_date === businessDate).length;
        if (n >= settings.max_tickets_per_day) throw ApiError.conflict('أدوار النهارده خلصت', { code: 'DAY_FULL' });
      }

      let trustConfirm = false;
      if (input.source === 'app') {
        if (!settings.remote_tickets_enabled) {
          throw ApiError.conflict('المحل مش بياخد أدوار من البيت — تعالى خُد دورك من الباب', { code: 'REMOTE_DISABLED' });
        }
        const active = db.tickets.find((t) => t.customer_id === input.customer_id && ACTIVE.includes(t.status));
        if (active) {
          throw ApiError.conflict('عندك دور شغّال بالفعل — ألغيه الأول لو عايز دور تاني', {
            code: 'ACTIVE_TICKET_EXISTS', details: { ticket_id: active.id },
          });
        }
        const probe = {
          id: -1, status: 'waiting', preferred_barber_id: barberId,
          services: services.map((s) => ({ service_id: s.id, minutes: s.default_minutes })),
        };
        const pe = estimateQueue({ now, barbers: state.barbers, tickets: state.tickets.concat([probe]), stats: state.stats }).tickets.get(-1);
        if (!pe || !pe.start) {
          throw ApiError.conflict(barberId ? 'الحلاق ده مش موجود النهارده' : 'مفيش حلاقين شغّالين دلوقتي', { code: 'NO_BARBERS' });
        }
        if (status.closes_at) {
          const lastStart = status.closes_at.getTime() - settings.close_buffer_minutes * MINUTE;
          if (pe.start.getTime() > lastStart) {
            throw ApiError.conflict('الطابور طويل والمحل هيقفل قبل دورك — جرّب بكرة أو تعالى المحل', { code: 'TOO_LATE' });
          }
        }
        const monthAgo = Date.now() - 30 * 86_400_000;
        const noShows = db.tickets.filter((t) => t.customer_id === input.customer_id && t.status === 'no_show' && Date.parse(t.created_at) > monthAgo).length;
        trustConfirm = noShows >= 2;
      }

      const number = counter(db, `ticket:${businessDate}`);
      const maxKey = state.tickets.reduce((max, t) => Math.max(max, t.sort_key), 0);
      const cardId = linkCard(db, { customerId: input.customer_id ?? null, phone: input.phone ?? null, name: input.name });
      const row = insert(db, 'tickets', {
        shop_id: 1, business_date: businessDate, number, customer_id: input.customer_id ?? null, shop_customer_id: cardId,
        name: input.name, phone: input.phone ?? null, source: input.source, preferred_barber_id: barberId, barber_id: null,
        status: 'waiting', sort_key: maxKey + KEY_STEP, arrived_at: input.source === 'app' ? null : nowIso(), called_at: null,
        delays_used: 0, auto_delayed: false, trust_confirm_required: trustConfirm, confirmed_at: null, near_notified_at: null,
        started_at: null, finished_at: null, total: 0, ended_by: null, end_reason: null, created_at: nowIso(), services: [],
      });
      services.forEach((s) => addTicketService(db, row, s, actor.type));
      ticketEvent(db, row, 'created', actor, { source: input.source, number });
      return row.id;
    });
    return getTicket(db, id);
  },

  next(db, barberId, actor) {
    return withQueue(db, (state) => {
      const barber = findBarber(state, barberId);
      const row = byId(db.barbers, barber.id);
      if (barber.status !== 'available') {
        row.status = 'available';
        row.break_until = null;
      }
      const current = state.tickets.find((t) => t.status === 'serving' && t.barber_id === barber.id);
      if (current) finishServing(db, state, current, actor);

      const { start, toCall } = pickNext(barber.id, state.waiting());
      toCall.forEach((t) => {
        if (t.called_at) return;
        rowOf(db, t).called_at = nowIso();
        ticketEvent(db, t, 'called', actor, { barber_id: barber.id });
      });
      if (start) {
        assertTransition('waiting', 'serving', actor.type);
        const r = rowOf(db, start);
        r.status = 'serving';
        r.barber_id = barber.id;
        r.started_at = nowIso();
        r.called_at = r.called_at || nowIso();
        ticketEvent(db, start, 'started', actor, { barber_id: barber.id });
        markBarberDay(db, barber.id, start.business_date);
      }
      return {
        finished_id: current ? current.id : null,
        started_id: start ? start.id : null,
        called_ids: toCall.map((t) => t.id),
      };
    });
  },

  finish(db, barberId, actor) {
    return withQueue(db, (state) => {
      const barber = findBarber(state, barberId);
      const current = state.tickets.find((t) => t.status === 'serving' && t.barber_id === barber.id);
      if (!current) throw ApiError.conflict('مفيش زبون على الكرسي', { code: 'NOTHING_SERVING' });
      finishServing(db, state, current, actor);
      return { finished_id: current.id };
    });
  },

  arrive(db, ticketId, actor) {
    return withQueue(db, (state) => {
      const t = findWaiting(state, ticketId);
      if (t.arrived_at) return { arrived: true };
      rowOf(db, t).arrived_at = nowIso();
      ticketEvent(db, t, 'arrived', actor);
      return { arrived: true };
    });
  },

  cancel(db, ticketId, actor, reason) {
    return withQueue(db, (state) => {
      const t = findActive(state, ticketId);
      if (t.status === 'serving' && !reason) {
        throw ApiError.unprocessable('إلغاء زبون على الكرسي محتاج سبب', { code: 'REASON_REQUIRED', details: { reason: 'الحقل مطلوب' } });
      }
      if (actor.type === 'kiosk' && state.now - t.created_at > MINUTE) {
        throw ApiError.forbidden('الإلغاء من الكشك خلال دقيقة بس — كلّم الاستقبال', { code: 'KIOSK_CANCEL_WINDOW' });
      }
      endTicket(db, t, 'cancelled', actor, reason || null);
      return { cancelled: true };
    });
  },

  noShow(db, ticketId, actor) {
    return withQueue(db, (state) => {
      const t = findWaiting(state, ticketId);
      endTicket(db, t, 'no_show', actor);
      return { no_show: true };
    });
  },

  move(db, ticketId, afterTicketId, actor, reason) {
    return withQueue(db, (state) => {
      const t = findWaiting(state, ticketId);
      if (afterTicketId !== null && Number(afterTicketId) === t.id) throw ApiError.unprocessable('مينفعش تحرّك الدور بعد نفسه', { code: 'BAD_MOVE' });
      const waiting = state.waiting();
      const others = waiting.filter((item) => item.id !== t.id);
      let index = 0;
      if (afterTicketId !== null) {
        const anchor = others.findIndex((item) => item.id === Number(afterTicketId));
        if (anchor === -1) throw ApiError.unprocessable('الدور اللي هتحرّك بعده مش في الطابور', { code: 'BAD_MOVE' });
        index = anchor + 1;
      }
      const from = waiting.findIndex((item) => item.id === t.id);
      placeTicket(db, waiting, t, index);
      ticketEvent(db, t, 'moved', actor, { from, to: index, reason });
      return { from, to: index };
    });
  },

  assign(db, ticketId, barberId, actor) {
    return withQueue(db, (state) => {
      const t = findWaiting(state, ticketId);
      if (barberId !== null) findBarber(state, barberId, { mustBePresent: true });
      rowOf(db, t).preferred_barber_id = barberId === null ? null : Number(barberId);
      ticketEvent(db, t, 'assigned', actor, { barber_id: barberId });
      return { preferred_barber_id: barberId === null ? null : Number(barberId) };
    });
  },

  addService(db, ticketId, serviceId, actor) {
    return withQueue(db, (state) => {
      const t = findActive(state, ticketId);
      const [service] = loadServices(db, [serviceId]);
      addTicketService(db, rowOf(db, t), service, actor.type);
      ticketEvent(db, t, 'service_added', actor, { service_id: service.id, name: service.name });
      return { added: service.id };
    });
  },

  delay(db, ticketId, actor) {
    return withQueue(db, (state) => {
      const t = findWaiting(state, ticketId);
      if (t.delays_used >= state.settings.max_delays) throw ApiError.conflict('استخدمت كل مرّات «أخّرني»', { code: 'NO_DELAYS_LEFT' });
      const waiting = state.waiting();
      const target = delayTarget(waiting, t.id, 2);
      if (target === null) throw ApiError.conflict('مفيش حد وراك — إنت آخر الطابور', { code: 'NOTHING_BEHIND' });
      placeTicket(db, waiting, t, target);
      const r = rowOf(db, t);
      r.delays_used += 1;
      r.called_at = null;
      ticketEvent(db, t, 'delayed', actor, { steps: 2 });
      return { delays_left: state.settings.max_delays - r.delays_used };
    });
  },

  checkIn(db, ticketId, code, actor) {
    return withQueue(db, (state) => {
      const t = findWaiting(state, ticketId);
      if (!verifyCheckin(db, code, state.now)) {
        throw ApiError.unprocessable('الكود ده مش صحيح أو قديم — امسح الكود اللي على الشاشة دلوقتي', {
          code: 'BAD_CHECKIN_CODE', details: { code: 'غير صحيح أو قديم' },
        });
      }
      if (t.arrived_at) return { arrived: true };
      rowOf(db, t).arrived_at = nowIso();
      ticketEvent(db, t, 'arrived', actor, { via: 'code' });
      return { arrived: true };
    });
  },

  confirmComing(db, ticketId, actor) {
    return withQueue(db, (state) => {
      const t = findWaiting(state, ticketId);
      const r = rowOf(db, t);
      r.confirmed_at = r.confirmed_at || nowIso();
      ticketEvent(db, t, 'coming', actor);
      return { confirmed: true };
    });
  },
};

/* ---------- كود الـ check-in المتغيّر كل دقيقة ---------- */

export const CHECKIN_WINDOW_MS = 60_000;

/** في الحقيقة HMAC بسرّ المحل. هنا hash بسيط بنفس الفكرة (6 أرقام لكل دقيقة). */
export function checkinCode(db, at = new Date()) {
  const window = Math.floor(at.getTime() / CHECKIN_WINDOW_MS);
  let h = 2166136261;
  const text = `${db.shop.checkin_secret}:${window}`;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return String((h >>> 0) % 1_000_000).padStart(6, '0');
}

export function verifyCheckin(db, code, now = new Date()) {
  const given = String(code ?? '');
  return [now, new Date(now.getTime() - CHECKIN_WINDOW_MS)].some((at) => checkinCode(db, at) === given);
}

export const checkinExpiresAt = (now = new Date()) =>
  new Date((Math.floor(now.getTime() / CHECKIN_WINDOW_MS) + 1) * CHECKIN_WINDOW_MS);
