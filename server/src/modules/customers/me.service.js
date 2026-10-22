/**
 * ═══════════════════════════════════════════════════════════════
 *  «دوري» — اللي الزبون بيشوفه عن دوره
 *
 *  الزبون يشوف دوره هو بس: رقمه، وقدّامه كام، والوقت المتوقّع مقرّب
 *  لأقرب 5 دقايق، واتنادى ولا لأ، وكام «أخّرني» فاضل. ما يشوفش أسماء
 *  ولا أرقام موبايلات حد تاني.
 * ═══════════════════════════════════════════════════════════════
 */
import { query, queryOne } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { loadSettings } from '../shop/shop.service.js';
import { estimate, readState, readTickets, roundedWait } from '../queue/queue.service.js';

const ACTIVE = "('waiting','serving')";

async function shopCard(shopId) {
  return queryOne('SELECT id, name, slug, phone, whatsapp, address, city FROM shops WHERE id = ?', [shopId]);
}

async function barberNames(ids) {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (wanted.length === 0) return new Map();
  const rows = await query(`SELECT id, name, chair_no FROM barbers WHERE id IN (${wanted.map(() => '?').join(',')})`, wanted);
  return new Map(rows.map((row) => [row.id, row]));
}

/** صورة دور واحد كما يشوفها صاحبه، ومعاها رقم نسخة الطابور (للـ stream) */
async function viewOf(ticket) {
  const now = new Date();
  let estimateFor = null;
  let settings;
  let version = 0;
  if (ticket.status === 'waiting' || ticket.status === 'serving') {
    const state = await readState(ticket.shop_id, now);
    settings = state.settings;
    version = state.version;
    estimateFor = ticket.status === 'waiting' ? estimate(state).tickets.get(ticket.id) ?? null : null;
  } else {
    settings = await loadSettings(ticket.shop_id);
  }
  const [shop, barbers] = await Promise.all([
    shopCard(ticket.shop_id),
    barberNames([ticket.preferred_barber_id, ticket.barber_id]),
  ]);
  const barberCard = (id) => (id && barbers.has(id) ? barbers.get(id) : null);

  return {
    version,
    ticket: {
      id: ticket.id,
      number: ticket.number,
      status: ticket.status,
      shop,
      services: ticket.services.map((service) => ({ name: service.name, price: service.price })),
      total: Number(ticket.total),
      preferred_barber: barberCard(ticket.preferred_barber_id),
      barber: barberCard(ticket.barber_id),
      ahead: estimateFor?.ahead ?? null,
      eta: estimateFor?.start ?? null,
      wait_minutes: roundedWait(estimateFor?.start ?? null, now),
      unavailable: Boolean(estimateFor?.unavailable),
      arrived: Boolean(ticket.arrived_at),
      called: Boolean(ticket.called_at) && !ticket.arrived_at && ticket.status === 'waiting',
      called_at: ticket.called_at,
      grace_minutes: settings.grace_minutes,
      delays_left: Math.max(0, settings.max_delays - ticket.delays_used),
      must_confirm: ticket.trust_confirm_required && !ticket.confirmed_at && Boolean(ticket.near_notified_at),
      confirmed: Boolean(ticket.confirmed_at),
      created_at: ticket.created_at,
      started_at: ticket.started_at,
      finished_at: ticket.finished_at,
      end_reason: ticket.end_reason,
    },
  };
}

export const meService = {
  /** دور الزبون الشغّال (لو فيه)، بصورته الكاملة */
  async active(customerId) {
    const [ticket] = await readTickets(`customer_id = ? AND status IN ${ACTIVE} ORDER BY id DESC LIMIT 1`, [customerId]);
    return ticket ? viewOf(ticket) : { version: 0, ticket: null };
  },

  async ticket(customerId, ticketId) {
    const [ticket] = await readTickets('id = ? AND customer_id = ?', [ticketId, customerId]);
    if (!ticket) throw ApiError.notFound('الدور غير موجود', { code: 'TICKET_NOT_FOUND' });
    return viewOf(ticket);
  },

  /** نتأكّد إن الدور بتاع الزبون قبل أي فعل عليه، ونرجّع محله */
  async own(customerId, ticketId) {
    const row = await queryOne('SELECT id, shop_id FROM queue_tickets WHERE id = ? AND customer_id = ?', [ticketId, customerId]);
    if (!row) throw ApiError.notFound('الدور غير موجود', { code: 'TICKET_NOT_FOUND' });
    return row;
  },

  /** سجلّي: آخر 50 دور بالمحل والخدمات */
  async history(customerId) {
    const rows = await query(
      `SELECT t.id, t.number, t.status, t.business_date, t.total, t.created_at, t.finished_at, t.end_reason,
              s.name AS shop_name, s.slug AS shop_slug, b.name AS barber_name,
              (SELECT GROUP_CONCAT(ts.name ORDER BY ts.id SEPARATOR '، ') FROM ticket_services ts WHERE ts.ticket_id = t.id) AS services
         FROM queue_tickets t
         JOIN shops s ON s.id = t.shop_id
         LEFT JOIN barbers b ON b.id = t.barber_id
        WHERE t.customer_id = ?
        ORDER BY t.id DESC
        LIMIT 50`,
      [customerId],
    );
    return rows.map((row) => ({ ...row, total: Number(row.total) }));
  },

  async shopBySlug(slug) {
    const shop = await queryOne("SELECT id FROM shops WHERE slug = ? AND status = 'active'", [slug]);
    if (!shop) throw ApiError.notFound('المحل غير موجود', { code: 'SHOP_NOT_FOUND' });
    return shop.id;
  },
};
