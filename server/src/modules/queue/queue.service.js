/**
 * ═══════════════════════════════════════════════════════════════
 *  الطابور — الجزء اللي بيكلّم قاعدة البيانات
 *
 *  كل تعديل على الطابور بيعدّي من `withQueue`:
 *    1) قفل صفّ shop_state للمحل (SELECT … FOR UPDATE): تعديلات نفس المحل
 *       بتتنفّذ ورا بعض، فحلاقين داسوا «التالي» في نفس اللحظة ما ياخدوش
 *       نفس الزبون.
 *    2) تحميل صورة الطابور، وتطبيق المهل اللي خلصت (sweep) قبل أي حاجة.
 *    3) التعديل نفسه.
 *    4) «قرّب دورك» لأي زبون بقى قريب، وزيادة رقم النسخة.
 *    5) بعد الـ commit: إشارة للشاشات المفتوحة.
 *
 *  القرارات نفسها (مين الجاي، الوقت المتوقّع، الترتيب) في queue/engine.js،
 *  والانتقالات المسموحة في queue/states.js.
 * ═══════════════════════════════════════════════════════════════
 */
import { query, queryOne, transaction, placeholders } from '../../config/db.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { nextCounter } from '../../utils/counters.js';
import { businessDateAt } from '../../utils/hours.js';
import { enqueuePush } from '../../services/notifications/outbox.js';
import { loadHours, loadSettings, openState } from '../shop/shop.service.js';
import { assertTransition } from '../../queue/states.js';
import {
  KEY_STEP, delayTarget, estimateQueue, keyAt, learnStat, pickNext, roundedWait,
} from '../../queue/engine.js';
import { publishQueue } from '../../queue/bus.js';

const MINUTE = 60_000;
const read = { query, queryOne };

const TICKET_COLUMNS = `id, shop_id, business_date, number, customer_id, name, phone, source,
  preferred_barber_id, barber_id, status, sort_key, arrived_at, called_at, delays_used, auto_delayed,
  trust_confirm_required, confirmed_at, near_notified_at, started_at, finished_at, total,
  ended_by, end_reason, created_at`;

/* ═══════════════════ تحميل صورة الطابور ═══════════════════ */

function shapeTicket(row) {
  return {
    ...row,
    sort_key: Number(row.sort_key),
    auto_delayed: Boolean(row.auto_delayed),
    trust_confirm_required: Boolean(row.trust_confirm_required),
    services: [],
  };
}

async function attachServices(tx, tickets) {
  if (tickets.length === 0) return tickets;
  const rows = await tx.query(
    `SELECT id, ticket_id, service_id, name, price, minutes FROM ticket_services
      WHERE ticket_id IN (${placeholders(tickets.length)}) ORDER BY id`,
    tickets.map((ticket) => ticket.id),
  );
  const byTicket = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  for (const row of rows) {
    byTicket.get(row.ticket_id).services.push({
      id: row.id, service_id: row.service_id, name: row.name, price: Number(row.price), minutes: row.minutes,
    });
  }
  return tickets;
}

async function loadState(tx, shopId, now = new Date()) {
  const shop = await tx.queryOne(
    'SELECT id, name, slug, timezone, accepting_tickets, checkin_secret FROM shops WHERE id = ?',
    [shopId],
  );
  if (!shop) throw ApiError.notFound('المحل غير موجود', { code: 'SHOP_NOT_FOUND' });
  shop.accepting_tickets = Boolean(shop.accepting_tickets);

  const [settings, hours, barbers, ticketRows, statRows, versionRow] = await Promise.all([
    loadSettings(shopId, tx),
    loadHours(shopId, tx),
    tx.query(
      `SELECT id, name, chair_no, status, break_until, photo_path FROM barbers
        WHERE shop_id = ? AND archived_at IS NULL ORDER BY sort_order, id`,
      [shopId],
    ),
    tx.query(
      `SELECT ${TICKET_COLUMNS} FROM queue_tickets
        WHERE shop_id = ? AND status IN ('waiting','serving') ORDER BY sort_key, id`,
      [shopId],
    ),
    tx.query(
      `SELECT s.barber_id, s.service_id, s.avg_minutes, s.samples FROM barber_service_stats s
         JOIN barbers b ON b.id = s.barber_id WHERE b.shop_id = ?`,
      [shopId],
    ),
    tx.queryOne('SELECT queue_version FROM shop_state WHERE shop_id = ?', [shopId]),
  ]);

  const tickets = await attachServices(tx, ticketRows.map(shapeTicket));
  const stats = new Map(statRows.map((row) => [`${row.barber_id}:${row.service_id}`, row]));
  return {
    now, shop, settings, hours, barbers, tickets, stats,
    version: Number(versionRow?.queue_version ?? 0),
    waiting: () => tickets.filter((ticket) => ticket.status === 'waiting'),
  };
}

const estimate = (state) => estimateQueue({
  now: state.now, barbers: state.barbers, tickets: state.tickets, stats: state.stats,
});

/* ═══════════════════ القفل والنسخة ═══════════════════ */

async function lockQueue(tx, shopId) {
  let row = await tx.queryOne('SELECT queue_version FROM shop_state WHERE shop_id = ? FOR UPDATE', [shopId]);
  if (!row) {
    // الصفّ بيتعمل مع المحل؛ ده احتياطي لمحل قديم قبل الـ migration
    await tx.execute('INSERT IGNORE INTO shop_state (shop_id) VALUES (?)', [shopId]);
    row = await tx.queryOne('SELECT queue_version FROM shop_state WHERE shop_id = ? FOR UPDATE', [shopId]);
  }
  return Number(row.queue_version);
}

async function bumpVersion(tx, shopId) {
  await tx.execute('UPDATE shop_state SET queue_version = queue_version + 1 WHERE shop_id = ?', [shopId]);
  return Number((await tx.queryOne('SELECT queue_version FROM shop_state WHERE shop_id = ?', [shopId])).queue_version);
}

/**
 * يشغّل تعديل على الطابور تحت القفل.
 * @param {number}   shopId
 * @param {Function} handler  (tx, state) => result
 */
async function withQueue(shopId, handler) {
  const { result, version } = await transaction(async (tx) => {
    await lockQueue(tx, shopId);
    const now = new Date();
    let state = await loadState(tx, shopId, now);
    if (await applySweep(tx, state)) state = await loadState(tx, shopId, now);

    const output = await handler(tx, state);

    await notifyNear(tx, await loadState(tx, shopId, now));
    return { result: output, version: await bumpVersion(tx, shopId) };
  });
  publishQueue(shopId, version);
  return result;
}

/* ═══════════════════ السجل والإشعارات ═══════════════════ */

function event(tx, ticket, type, actor, data = null) {
  return tx.execute(
    'INSERT INTO ticket_events (ticket_id, shop_id, type, actor_type, actor_id, data) VALUES (?, ?, ?, ?, ?, ?)',
    [ticket.id, ticket.shop_id, type, actor.type, actor.id ?? null, data ? JSON.stringify(data) : null],
  );
}

const turnUrl = (ticket) => `${env.customerAppUrl}/turn/${ticket.id}`;

/** إشعار للزبون صاحب الحساب بس (زبون الكشك والاستقبال مالوش اشتراك) */
function push(tx, ticket, title, body) {
  if (!ticket.customer_id) return null;
  return enqueuePush({
    shopId: ticket.shop_id,
    customerId: ticket.customer_id,
    payload: { title, body, url: turnUrl(ticket), tag: `ticket-${ticket.id}` },
  }, tx);
}

const aheadText = (ahead) => (ahead === 0 ? 'إنت الجاي' : `قدّامك ${ahead}`);

/* ═══════════════════ المهل (sweep) ═══════════════════ */

/** يحط دور في مكان معيّن من الطابور، ويرقّم الكل من جديد لو الأرقام قرّبت */
async function placeTicket(tx, waiting, ticket, index) {
  const others = waiting.filter((item) => item.id !== ticket.id);
  const key = keyAt(others, index);
  if (key !== null) {
    await tx.execute('UPDATE queue_tickets SET sort_key = ? WHERE id = ?', [key, ticket.id]);
    ticket.sort_key = key;
    return;
  }
  const ordered = [...others];
  ordered.splice(index, 0, ticket);
  for (const [position, item] of ordered.entries()) {
    item.sort_key = (position + 1) * KEY_STEP;
    await tx.execute('UPDATE queue_tickets SET sort_key = ? WHERE id = ?', [item.sort_key, item.id]);
  }
}

async function endTicket(tx, ticket, to, actor, reason = null) {
  assertTransition(ticket.status, to, actor.type);
  await tx.execute(
    `UPDATE queue_tickets SET status = ?, ended_by = ?, end_reason = ?,
            finished_at = IF(? = 'done', NOW(), finished_at)
      WHERE id = ?`,
    [to, actor.type, reason, to, ticket.id],
  );
  await event(tx, ticket, to, actor, reason ? { reason } : null);
  ticket.status = to;
}

const SYSTEM = { type: 'system' };

/**
 * يطبّق اللي فات وقته:
 *  • أدوار يوم شغل خلص ← اتلغت (والي على الكرسي ← خلص)
 *  • اتنادى وما وصلش في المهلة ← أوّل مرّة يتأخّر خطوتين، التانية ما جاش
 *  • زبون لازم يأكّد وما أكّدش في المهلة ← اتلغى
 * @returns {Promise<boolean>} اتغيّر حاجة؟
 */
async function applySweep(tx, state) {
  const { now, settings, shop, hours } = state;
  const graceMs = settings.grace_minutes * MINUTE;
  const today = businessDateAt(hours, shop.timezone, now);
  // بيتحدّث مع كل تأخير أو إلغاء جوّه اللفّة
  const waiting = () => state.tickets
    .filter((ticket) => ticket.status === 'waiting')
    .sort((a, b) => a.sort_key - b.sort_key);
  let changed = false;

  for (const ticket of [...state.tickets]) {
    if (ticket.business_date < today) {
      if (ticket.status === 'waiting') {
        await endTicket(tx, ticket, 'cancelled', SYSTEM, 'day_closed');
        await push(tx, ticket, 'الدور اتلغى', 'يوم الشغل خلص قبل ما دورك ييجي. تقدر تاخد دور جديد.');
      } else {
        await endTicket(tx, ticket, 'done', SYSTEM, 'day_closed');
      }
      changed = true;
      continue;
    }
    if (ticket.status !== 'waiting') continue;

    if (ticket.called_at && !ticket.arrived_at && now - ticket.called_at > graceMs) {
      const target = ticket.auto_delayed ? null : delayTarget(waiting(), ticket.id, 2);
      if (!ticket.auto_delayed && target === null) continue; // مفيش حد وراه: مش معطّل حد
      if (ticket.auto_delayed) {
        await endTicket(tx, ticket, 'no_show', SYSTEM, 'grace_expired');
        await push(tx, ticket, 'الدور اتلغى', 'ما وصلتش في المهلة مرّتين، فالدور اتلغى.');
      } else {
        await placeTicket(tx, waiting(), ticket, target);
        await tx.execute('UPDATE queue_tickets SET auto_delayed = 1, called_at = NULL WHERE id = ?', [ticket.id]);
        await event(tx, ticket, 'auto_delayed', SYSTEM, { steps: 2 });
        await push(tx, ticket, 'اتأخّرت خطوتين', 'ما وصلتش في المهلة، فدورك رجع خطوتين. لو مش هتلحق، ألغِ الدور.');
      }
      changed = true;
      continue;
    }

    if (ticket.trust_confirm_required && !ticket.confirmed_at && ticket.near_notified_at
      && now - ticket.near_notified_at > graceMs) {
      await endTicket(tx, ticket, 'cancelled', SYSTEM, 'not_confirmed');
      await push(tx, ticket, 'الدور اتلغى', 'ما أكّدتش إنك جاي في المهلة، فالدور اتلغى.');
      changed = true;
    }
  }
  return changed;
}

/** «قرّب دورك» مرّة واحدة لكل زبون. اللي لسه واخد الدور وقريب أصلًا ما يتبعتلوش. */
async function notifyNear(tx, state) {
  const estimates = estimate(state).tickets;
  for (const ticket of state.waiting()) {
    if (!ticket.customer_id || ticket.near_notified_at) continue;
    const estimateFor = estimates.get(ticket.id);
    if (!estimateFor || estimateFor.ahead === null || estimateFor.ahead > state.settings.notify_ahead) continue;

    const justCreated = state.now - ticket.created_at < MINUTE;
    await tx.execute(
      `UPDATE queue_tickets SET near_notified_at = NOW(),
              confirmed_at = IF(?, COALESCE(confirmed_at, NOW()), confirmed_at)
        WHERE id = ?`,
      [justCreated, ticket.id],
    );
    if (justCreated) continue;

    const mustConfirm = ticket.trust_confirm_required && !ticket.confirmed_at;
    await push(
      tx, ticket, 'قرّب دورك',
      mustConfirm
        ? `${aheadText(estimateFor.ahead)}. دوس «جاي» خلال ${state.settings.grace_minutes} دقايق عشان الدور ما يتلغيش.`
        : `${aheadText(estimateFor.ahead)}. ابدأ اتحرّك على المحل.`,
    );
  }
}

/* ═══════════════════ العرض ═══════════════════ */

function ticketView(ticket, estimateFor, now) {
  return {
    id: ticket.id,
    number: ticket.number,
    name: ticket.name,
    phone: ticket.phone,
    source: ticket.source,
    status: ticket.status,
    preferred_barber_id: ticket.preferred_barber_id,
    barber_id: ticket.barber_id,
    expected_barber_id: estimateFor?.barberId ?? null,
    arrived: Boolean(ticket.arrived_at),
    arrived_at: ticket.arrived_at,
    called_at: ticket.called_at,
    delays_used: ticket.delays_used,
    auto_delayed: ticket.auto_delayed,
    trust_confirm_required: ticket.trust_confirm_required,
    confirmed: Boolean(ticket.confirmed_at),
    services: ticket.services,
    total: Number(ticket.total),
    created_at: ticket.created_at,
    started_at: ticket.started_at,
    eta: estimateFor?.start ?? null,
    wait_minutes: estimateFor?.start ? Math.max(0, Math.round((estimateFor.start - now) / MINUTE)) : null,
    ahead: estimateFor?.ahead ?? null,
    unavailable: Boolean(estimateFor?.unavailable),
  };
}

/** صورة الطابور للوحة المحل وتابلت الكرسي */
function staffView(state) {
  const { now } = state;
  const result = estimate(state);
  const serving = new Map(state.tickets.filter((t) => t.status === 'serving').map((t) => [t.barber_id, t]));
  return {
    version: state.version,
    now,
    open: openState(state.shop, state.hours, now),
    accepting_tickets: state.shop.accepting_tickets,
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
      break_until: barber.break_until,
      photo_path: barber.photo_path,
      free_at: result.freeAt.get(barber.id) ?? null,
      serving: serving.has(barber.id) ? ticketView(serving.get(barber.id), null, now) : null,
    })),
    waiting: state.waiting().map((ticket) => ticketView(ticket, result.tickets.get(ticket.id), now)),
  };
}

/* ═══════════════════ أدوات مشتركة للعمليات ═══════════════════ */

function findActive(state, ticketId) {
  const ticket = state.tickets.find((item) => item.id === ticketId);
  if (ticket) return ticket;
  throw ApiError.notFound('الدور مش في الطابور (خلص أو اتلغى أو مش موجود)', { code: 'TICKET_NOT_ACTIVE' });
}

function findWaiting(state, ticketId) {
  const ticket = findActive(state, ticketId);
  if (ticket.status !== 'waiting') throw ApiError.conflict('الدور ده على الكرسي بالفعل', { code: 'TICKET_SERVING' });
  return ticket;
}

function findBarber(state, barberId, { mustBePresent = false } = {}) {
  const barber = state.barbers.find((item) => item.id === barberId);
  if (!barber) {
    throw ApiError.unprocessable('الحلاق غير موجود', { code: 'BAD_BARBER', details: { barber_id: 'غير موجود' } });
  }
  if (mustBePresent && barber.status === 'off') {
    throw ApiError.conflict(`${barber.name} مش موجود النهارده`, { code: 'BARBER_OFF', details: { barber_id: 'مش موجود النهارده' } });
  }
  return barber;
}

async function loadServices(tx, shopId, serviceIds) {
  const ids = [...new Set(serviceIds)];
  const rows = await tx.query(
    `SELECT id, name, price, default_minutes FROM services
      WHERE shop_id = ? AND id IN (${placeholders(ids.length)}) AND archived_at IS NULL AND active = 1`,
    [shopId, ...ids],
  );
  if (rows.length !== ids.length) {
    throw ApiError.unprocessable('خدمة غير موجودة أو موقوفة', { code: 'BAD_SERVICE', details: { service_ids: 'خدمة غير موجودة أو موقوفة' } });
  }
  // بنفس ترتيب طلب الزبون
  return ids.map((id) => rows.find((row) => row.id === id));
}

async function addTicketService(tx, ticket, service, addedBy) {
  await tx.execute(
    'INSERT INTO ticket_services (ticket_id, service_id, name, price, minutes, added_by) VALUES (?, ?, ?, ?, ?, ?)',
    [ticket.id, service.id, service.name, service.price, service.default_minutes, addedBy],
  );
  await tx.execute('UPDATE queue_tickets SET total = total + ? WHERE id = ?', [service.price, ticket.id]);
}

/** الدور خلص: نسجّل المدّة ونعلّم السيستم مدّة الحلاق لو كانت خدمة واحدة */
async function finishServing(tx, state, ticket, actor) {
  await endTicket(tx, ticket, 'done', actor);
  const minutes = ticket.started_at ? (state.now - ticket.started_at) / MINUTE : null;
  if (minutes !== null && ticket.services.length === 1 && ticket.barber_id) {
    const [service] = ticket.services;
    const stat = state.stats.get(`${ticket.barber_id}:${service.service_id}`);
    const learned = learnStat(stat, service.minutes, minutes);
    if (learned) {
      await tx.execute(
        `INSERT INTO barber_service_stats (barber_id, service_id, avg_minutes, samples) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE avg_minutes = VALUES(avg_minutes), samples = VALUES(samples)`,
        [ticket.barber_id, service.service_id, learned.avg_minutes, learned.samples],
      );
    }
  }
  await push(tx, ticket, 'نعيمًا', `نوّرت ${state.shop.name}. نستناك المرّة الجاية.`);
}

/* ═══════════════════ العمليات ═══════════════════ */

export const queueService = {
  /** الطابور دلوقتي. لو `since` = النسخة الحالية، رد صغير من غير الصورة. */
  async view(shopId, { since } = {}) {
    if (since !== undefined) {
      const row = await queryOne('SELECT queue_version FROM shop_state WHERE shop_id = ?', [shopId]);
      const version = Number(row?.queue_version ?? 0);
      if (version === since) return { changed: false, version };
    }
    return staffView(await loadState(read, shopId));
  },

  async getTicket(shopId, ticketId) {
    const row = await queryOne(`SELECT ${TICKET_COLUMNS} FROM queue_tickets WHERE id = ? AND shop_id = ?`, [ticketId, shopId]);
    if (!row) throw ApiError.notFound('الدور غير موجود', { code: 'TICKET_NOT_FOUND' });
    const [ticket] = await attachServices(read, [shapeTicket(row)]);
    let estimateFor = null;
    const now = new Date();
    if (ticket.status === 'waiting') {
      const state = await loadState(read, shopId, now);
      estimateFor = estimate(state).tickets.get(ticket.id) ?? null;
    }
    const events = await query(
      'SELECT type, actor_type, actor_id, data, created_at FROM ticket_events WHERE ticket_id = ? ORDER BY id',
      [ticket.id],
    );
    return { ...ticketView(ticket, estimateFor, now), business_date: ticket.business_date, finished_at: ticket.finished_at, end_reason: ticket.end_reason, events };
  },

  /**
   * أخد دور. القواعد بتختلف حسب المصدر:
   *  staff ← من غير قيود (الاستقبال شايف المحل قدّامه)
   *  kiosk ← المحل فاتح وبياخد أدوار، وحدّ اليوم
   *  app   ← كل ده + الأدوار عن بُعد شغّالة + مفيش دور تاني شغّال + الوقت المتوقّع قبل القفل
   */
  async create(shopId, input, actor) {
    const ticketId = await withQueue(shopId, async (tx, state) => {
      const { now, settings, shop } = state;
      const services = await loadServices(tx, shopId, input.service_ids);
      const barberId = input.barber_id ?? null;
      if (barberId !== null) findBarber(state, barberId, { mustBePresent: input.source !== 'staff' });

      const status = openState(shop, state.hours, now);
      if (input.source !== 'staff') {
        if (!shop.accepting_tickets) throw ApiError.conflict('المحل موقّف الأدوار دلوقتي', { code: 'QUEUE_PAUSED' });
        if (!status.open) {
          throw ApiError.conflict('المحل قافل دلوقتي', { code: 'SHOP_CLOSED', details: { next_opens_at: status.next_opens_at } });
        }
      }

      const businessDate = businessDateAt(state.hours, shop.timezone, now);
      if (input.source !== 'staff' && settings.max_tickets_per_day) {
        const { n } = await tx.queryOne(
          'SELECT COUNT(*) AS n FROM queue_tickets WHERE shop_id = ? AND business_date = ?',
          [shopId, businessDate],
        );
        if (n >= settings.max_tickets_per_day) {
          throw ApiError.conflict('أدوار النهارده خلصت', { code: 'DAY_FULL' });
        }
      }

      let trustConfirm = false;
      if (input.source === 'app') {
        if (!settings.remote_tickets_enabled) {
          throw ApiError.conflict('المحل مش بياخد أدوار من البيت — تعالى خُد دورك من الباب', { code: 'REMOTE_DISABLED' });
        }
        // قفل الزبون: لو طلب دورين في محلين في نفس اللحظة، واحد بس يعدّي
        await tx.queryOne('SELECT id FROM customers WHERE id = ? FOR UPDATE', [input.customer_id]);
        const active = await tx.queryOne(
          "SELECT id, shop_id FROM queue_tickets WHERE customer_id = ? AND status IN ('waiting','serving') LIMIT 1",
          [input.customer_id],
        );
        if (active) {
          throw ApiError.conflict('عندك دور شغّال بالفعل — ألغيه الأول لو عايز دور تاني', {
            code: 'ACTIVE_TICKET_EXISTS', details: { ticket_id: active.id },
          });
        }

        // الوقت المتوقّع للدور الجديد لو اتضاف دلوقتي
        const probe = {
          id: -1, status: 'waiting', preferred_barber_id: barberId,
          services: services.map((service) => ({ service_id: service.id, minutes: service.default_minutes })),
        };
        const probeEstimate = estimateQueue({
          now, barbers: state.barbers, tickets: [...state.tickets, probe], stats: state.stats,
        }).tickets.get(-1);
        if (!probeEstimate?.start) {
          throw ApiError.conflict(
            barberId ? 'الحلاق ده مش موجود النهارده' : 'مفيش حلاقين شغّالين دلوقتي',
            { code: 'NO_BARBERS' },
          );
        }
        if (status.closes_at) {
          const lastStart = status.closes_at.getTime() - settings.close_buffer_minutes * MINUTE;
          if (probeEstimate.start.getTime() > lastStart) {
            throw ApiError.conflict('الطابور طويل والمحل هيقفل قبل دورك — جرّب بكرة أو تعالى المحل', { code: 'TOO_LATE' });
          }
        }

        const { n } = await tx.queryOne(
          `SELECT COUNT(*) AS n FROM queue_tickets
            WHERE customer_id = ? AND status = 'no_show' AND created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)`,
          [input.customer_id],
        );
        trustConfirm = n >= 2;
      }

      const number = await nextCounter(tx, shopId, `ticket:${businessDate}`);
      const maxKey = state.tickets.reduce((max, ticket) => Math.max(max, ticket.sort_key), 0);
      const result = await tx.execute(
        `INSERT INTO queue_tickets
           (shop_id, business_date, number, customer_id, name, phone, source, preferred_barber_id,
            sort_key, arrived_at, trust_confirm_required)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, IF(? = 'app', NULL, NOW()), ?)`,
        [
          shopId, businessDate, number, input.customer_id ?? null, input.name, input.phone ?? null,
          input.source, barberId, maxKey + KEY_STEP, input.source, trustConfirm,
        ],
      );
      const ticket = { id: result.insertId, shop_id: shopId };
      for (const service of services) await addTicketService(tx, ticket, service, actor.type);
      await event(tx, ticket, 'created', actor, { source: input.source, number });
      return ticket.id;
    });
    return this.getTicket(shopId, ticketId);
  },

  /**
   * زرار «التالي» للحلاق: يقفل اللي على الكرسي، ويقعّد أوّل واحد واصل،
   * وينادي أي حد قبله لسه ما وصلش (مكانه محفوظ لحد المهلة).
   */
  next(shopId, barberId, actor) {
    return withQueue(shopId, async (tx, state) => {
      const barber = findBarber(state, barberId);
      if (barber.status !== 'available') {
        // اللي داس «التالي» بيشتغل: يرجع متاح من الاستراحة أو من «مش موجود»
        await tx.execute("UPDATE barbers SET status = 'available', break_until = NULL WHERE id = ?", [barberId]);
      }

      const current = state.tickets.find((ticket) => ticket.status === 'serving' && ticket.barber_id === barberId);
      if (current) await finishServing(tx, state, current, actor);

      const { start, toCall } = pickNext(barberId, state.waiting());
      for (const ticket of toCall) {
        if (ticket.called_at) continue;
        await tx.execute('UPDATE queue_tickets SET called_at = NOW() WHERE id = ?', [ticket.id]);
        await event(tx, ticket, 'called', actor, { barber_id: barberId });
        await push(tx, ticket, 'دورك جه', `رقم ${ticket.number}. عندك ${state.settings.grace_minutes} دقايق توصل المحل.`);
      }

      if (start) {
        assertTransition('waiting', 'serving', actor.type);
        await tx.execute(
          `UPDATE queue_tickets SET status = 'serving', barber_id = ?, started_at = NOW(),
                  called_at = COALESCE(called_at, NOW()) WHERE id = ?`,
          [barberId, start.id],
        );
        await event(tx, start, 'started', actor, { barber_id: barberId });
      }

      return {
        finished_id: current?.id ?? null,
        started_id: start?.id ?? null,
        called_ids: toCall.map((ticket) => ticket.id),
      };
    });
  },

  /** «خلّصت» من غير ما ينادي حد (قبل الاستراحة أو آخر الوردية) */
  finish(shopId, barberId, actor) {
    return withQueue(shopId, async (tx, state) => {
      findBarber(state, barberId);
      const current = state.tickets.find((ticket) => ticket.status === 'serving' && ticket.barber_id === barberId);
      if (!current) throw ApiError.conflict('مفيش زبون على الكرسي', { code: 'NOTHING_SERVING' });
      await finishServing(tx, state, current, actor);
      return { finished_id: current.id };
    });
  },

  arrive(shopId, ticketId, actor) {
    return withQueue(shopId, async (tx, state) => {
      const ticket = findWaiting(state, ticketId);
      if (ticket.arrived_at) return { arrived: true };
      await tx.execute('UPDATE queue_tickets SET arrived_at = NOW() WHERE id = ?', [ticket.id]);
      await event(tx, ticket, 'arrived', actor);
      return { arrived: true };
    });
  },

  cancel(shopId, ticketId, actor, reason = null) {
    return withQueue(shopId, async (tx, state) => {
      const ticket = findActive(state, ticketId);
      if (ticket.status === 'serving' && !reason) {
        throw ApiError.unprocessable('إلغاء زبون على الكرسي محتاج سبب', { code: 'REASON_REQUIRED', details: { reason: 'الحقل مطلوب' } });
      }
      if (actor.type === 'kiosk' && state.now - ticket.created_at > MINUTE) {
        throw ApiError.forbidden('الإلغاء من الكشك خلال دقيقة بس — كلّم الاستقبال', { code: 'KIOSK_CANCEL_WINDOW' });
      }
      await endTicket(tx, ticket, 'cancelled', actor, reason);
      if (actor.type !== 'customer') {
        await push(tx, ticket, 'الدور اتلغى', reason ? `المحل لغى دورك: ${reason}` : 'المحل لغى دورك.');
      }
      return { cancelled: true };
    });
  },

  noShow(shopId, ticketId, actor) {
    return withQueue(shopId, async (tx, state) => {
      const ticket = findWaiting(state, ticketId);
      await endTicket(tx, ticket, 'no_show', actor);
      await push(tx, ticket, 'الدور اتلغى', 'المحل سجّل إنك ما جيتش.');
      return { no_show: true };
    });
  },

  /** تحريك يدوي (الاستقبال/المدير): after_ticket_id = null ← أوّل الطابور */
  move(shopId, ticketId, afterTicketId, actor, reason) {
    return withQueue(shopId, async (tx, state) => {
      const ticket = findWaiting(state, ticketId);
      if (afterTicketId === ticketId) throw ApiError.unprocessable('مينفعش تحرّك الدور بعد نفسه', { code: 'BAD_MOVE' });
      const waiting = state.waiting();
      const others = waiting.filter((item) => item.id !== ticketId);
      let index = 0;
      if (afterTicketId !== null) {
        const anchor = others.findIndex((item) => item.id === afterTicketId);
        if (anchor === -1) throw ApiError.unprocessable('الدور اللي هتحرّك بعده مش في الطابور', { code: 'BAD_MOVE' });
        index = anchor + 1;
      }
      const from = waiting.findIndex((item) => item.id === ticketId);
      await placeTicket(tx, waiting, ticket, index);
      await event(tx, ticket, 'moved', actor, { from, to: index, reason });
      return { from, to: index };
    });
  },

  /** تغيير الحلاق المطلوب (null = أي حد) */
  assign(shopId, ticketId, barberId, actor) {
    return withQueue(shopId, async (tx, state) => {
      const ticket = findWaiting(state, ticketId);
      if (barberId !== null) findBarber(state, barberId, { mustBePresent: true });
      await tx.execute('UPDATE queue_tickets SET preferred_barber_id = ? WHERE id = ?', [barberId, ticket.id]);
      await event(tx, ticket, 'assigned', actor, { barber_id: barberId });
      return { preferred_barber_id: barberId };
    });
  },

  addService(shopId, ticketId, serviceId, actor) {
    return withQueue(shopId, async (tx, state) => {
      const ticket = findActive(state, ticketId);
      const [service] = await loadServices(tx, shopId, [serviceId]);
      await addTicketService(tx, ticket, service, actor.type);
      await event(tx, ticket, 'service_added', actor, { service_id: service.id, name: service.name });
      return { added: service.id };
    });
  },

  /** «أخّرني»: الزبون يرجع ورا خطوتين بدل ما يخسر دوره */
  delay(shopId, ticketId, actor) {
    return withQueue(shopId, async (tx, state) => {
      const ticket = findWaiting(state, ticketId);
      if (ticket.delays_used >= state.settings.max_delays) {
        throw ApiError.conflict('استخدمت كل مرّات «أخّرني»', { code: 'NO_DELAYS_LEFT' });
      }
      const waiting = state.waiting();
      const target = delayTarget(waiting, ticket.id, 2);
      if (target === null) throw ApiError.conflict('مفيش حد وراك — إنت آخر الطابور', { code: 'NOTHING_BEHIND' });
      await placeTicket(tx, waiting, ticket, target);
      await tx.execute(
        'UPDATE queue_tickets SET delays_used = delays_used + 1, called_at = NULL WHERE id = ?',
        [ticket.id],
      );
      await event(tx, ticket, 'delayed', actor, { steps: 2 });
      return { delays_left: state.settings.max_delays - ticket.delays_used - 1 };
    });
  },

  /** الزبون دَاس «جاي» */
  confirmComing(shopId, ticketId, actor) {
    return withQueue(shopId, async (tx, state) => {
      const ticket = findWaiting(state, ticketId);
      await tx.execute('UPDATE queue_tickets SET confirmed_at = COALESCE(confirmed_at, NOW()) WHERE id = ?', [ticket.id]);
      await event(tx, ticket, 'coming', actor);
      return { confirmed: true };
    });
  },

  /** تغيير بيأثّر على الوقت المتوقّع من برّه الطابور (حالة حلاق مثلًا): الشاشات تعيد الحساب */
  async touch(shopId) {
    const version = await transaction(async (tx) => {
      await lockQueue(tx, shopId);
      return bumpVersion(tx, shopId);
    });
    publishQueue(shopId, version);
  },

  /** تطبيق المهل اللي خلصت (المهمة الدورية). @returns {Promise<boolean>} اتغيّر حاجة؟ */
  async sweep(shopId) {
    const version = await transaction(async (tx) => {
      await lockQueue(tx, shopId);
      const state = await loadState(tx, shopId);
      const changed = await applySweep(tx, state);
      if (!changed) return null;
      await notifyNear(tx, await loadState(tx, shopId, state.now));
      return bumpVersion(tx, shopId);
    });
    if (version !== null) publishQueue(shopId, version);
    return version !== null;
  },

  /** المحلات اللي عندها أدوار شغّالة (للمهمة الدورية) */
  async activeShops() {
    const rows = await query("SELECT DISTINCT shop_id FROM queue_tickets WHERE status IN ('waiting','serving')");
    return rows.map((row) => row.shop_id);
  },
};

/** الانتظار المقرّب اللي بيتعرض للزبون (موجود هنا عشان واجهات الزبون والتلفزيون تستعمله) */
export { roundedWait };
