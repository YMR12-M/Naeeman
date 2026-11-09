/**
 * ═══════════════════════════════════════════════════════════════
 *  الفواتير والدفع
 *
 *  الفاتورة بتتعمل في تلات حالات:
 *    • الدور خلص (`onTicketDone` من جوّه معاملة الطابور): سطور الخدمات
 *      منسوخة من الدور باسم الحلاق. لو الكاشير مقفول في الإعدادات
 *      بتتسدّد كاش لوحدها (زي المرحلة الأولى بالظبط).
 *    • الزبون اشترى منتج وهو مستني (`openForTicket`): فاتورة الدور بتتفتح
 *      بدري، والخدمات بتتضاف لها لما الدور يخلص.
 *    • بيع من غير دور (`createCounter`).
 *
 *  الدفع (`checkout`) خطوة واحدة ذرّية تحت قفل الفاتورة: الخصم، ومكافأة
 *  الأختام، والبقشيش، وطرق الدفع، وبعدها المخزن والختم والعمولة. فلو
 *  جهازين داسوا «ادفع» لنفس الفاتورة، واحد بس بيعدّي.
 *
 *  ترتيب الأقفال ثابت عشان ما يحصلش deadlock: (shop_state للطابور) ←
 *  الفاتورة ← الدرج (مشترك) ← المنتجات ← كارت الزبون.
 * ═══════════════════════════════════════════════════════════════
 */
import { query, queryOne, transaction, isDuplicate, placeholders } from '../../config/db.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { nextCounter } from '../../utils/counters.js';
import { businessDateAt } from '../../utils/hours.js';
import { allocate, applyRate, percentOf } from '../../utils/money.js';
import { pageMeta } from '../../utils/response.js';
import { loadHours, loadSettings } from '../shop/shop.service.js';
import { moveStock } from '../products/products.service.js';
import { addStampEvent, linkCard, loyaltyFor, recordVisit, rewardLabel } from '../cards/cards.service.js';

const BILL_COLUMNS = `id, shop_id, business_date, number, source, ticket_id, shop_customer_id, customer_name,
  customer_phone, barber_id, status, subtotal, discount, discount_reason, reward_discount, total, tip, paid,
  change_given, refunded, stamp_awarded, reward_redeemed, auto_paid, paid_date, paid_at, paid_by,
  voided_at, voided_by, void_reason, created_by, day_close_id, created_at, updated_at`;

const MONEY = ['subtotal', 'discount', 'reward_discount', 'total', 'tip', 'paid', 'change_given', 'refunded'];

function shapeBill(row) {
  const out = { ...row };
  for (const key of MONEY) out[key] = Number(out[key]);
  for (const key of ['stamp_awarded', 'reward_redeemed', 'auto_paid']) out[key] = Boolean(out[key]);
  return out;
}

const shapeItem = (row) => ({
  ...row,
  unit_price: Number(row.unit_price),
  line_total: Number(row.line_total),
  discount_share: Number(row.discount_share),
  reward_share: Number(row.reward_share),
  commission: Number(row.commission),
  unit_cost: row.unit_cost === null ? null : Number(row.unit_cost),
});

const read = { query, queryOne };

/* ═══════════════════ طرق الدفع ═══════════════════ */

const DEFAULT_METHODS = [
  { code: 'cash', label: 'كاش', kind: 'cash' },
  { code: 'card', label: 'فيزا', kind: 'card' },
  { code: 'wallet', label: 'محفظة', kind: 'wallet' },
  { code: 'instapay', label: 'إنستاباي', kind: 'transfer' },
];

/** طرق الدفع بتتعمل لوحدها أوّل مرّة المحل يحتاجها */
export async function ensureMethods(shopId, tx = { query, execute: query }) {
  const rows = await tx.query('SELECT id FROM payment_methods WHERE shop_id = ? LIMIT 1', [shopId]);
  if (rows.length > 0) return;
  for (const [index, method] of DEFAULT_METHODS.entries()) {
    await tx.execute(
      'INSERT IGNORE INTO payment_methods (shop_id, code, label, kind, sort_order) VALUES (?, ?, ?, ?, ?)',
      [shopId, method.code, method.label, method.kind, (index + 1) * 10],
    );
  }
}

export const methodsService = {
  async list(shopId, { activeOnly = false } = {}) {
    await ensureMethods(shopId);
    const rows = await query(
      `SELECT id, code, label, kind, active, sort_order FROM payment_methods
        WHERE shop_id = ? ${activeOnly ? 'AND active = 1' : ''} ORDER BY sort_order, id`,
      [shopId],
    );
    return rows.map((row) => ({ ...row, active: Boolean(row.active) }));
  },

  async create(shopId, { label, kind }) {
    await ensureMethods(shopId);
    const order = await queryOne('SELECT COALESCE(MAX(sort_order), 0) + 10 AS n FROM payment_methods WHERE shop_id = ?', [shopId]);
    const { n } = await queryOne("SELECT COUNT(*) + 1 AS n FROM payment_methods WHERE shop_id = ? AND code LIKE 'm%'", [shopId]);
    const result = await query(
      'INSERT INTO payment_methods (shop_id, code, label, kind, sort_order) VALUES (?, ?, ?, ?, ?)',
      [shopId, `m${n}_${Date.now().toString(36)}`, label, kind, Number(order.n)],
    );
    return (await this.list(shopId)).find((row) => row.id === result.insertId);
  },

  async update(shopId, id, changes) {
    const before = (await this.list(shopId)).find((row) => row.id === id);
    if (!before) throw ApiError.notFound('طريقة الدفع غير موجودة', { code: 'METHOD_NOT_FOUND' });
    if (before.code === 'cash' && changes.active === false) {
      throw ApiError.conflict('الكاش مينفعش يتقفل — هو اللي بيدخل الدرج', { code: 'CASH_REQUIRED' });
    }
    const sets = [];
    const params = [];
    for (const column of ['label', 'active', 'sort_order']) {
      if (changes[column] !== undefined) { sets.push(`${column} = ?`); params.push(changes[column]); }
    }
    if (sets.length > 0) await query(`UPDATE payment_methods SET ${sets.join(', ')} WHERE id = ? AND shop_id = ?`, [...params, id, shopId]);
    return { before, after: (await this.list(shopId)).find((row) => row.id === id) };
  },
};

/* ═══════════════════ أدوات مشتركة ═══════════════════ */

/** يوم الشغل دلوقتي حسب مواعيد المحل */
export async function todayFor(shopId, tx = read) {
  const shop = await tx.queryOne('SELECT timezone FROM shops WHERE id = ?', [shopId]);
  return businessDateAt(await loadHours(shopId, tx), shop.timezone);
}

/** الدرج المفتوح (بقفل مشترك جوّه المعاملة: التقفيل ما يعدّيش وإحنا بندفع) */
export async function openDrawerFor(tx, shopId) {
  return tx.queryOne(
    "SELECT id, business_date, opening_float FROM drawer_sessions WHERE shop_id = ? AND status = 'open' LOCK IN SHARE MODE",
    [shopId],
  );
}

async function lockBill(tx, shopId, billId) {
  const row = await tx.queryOne(`SELECT ${BILL_COLUMNS} FROM bills WHERE id = ? AND shop_id = ? FOR UPDATE`, [billId, shopId]);
  if (!row) throw ApiError.notFound('الفاتورة غير موجودة', { code: 'BILL_NOT_FOUND' });
  return shapeBill(row);
}

function assertOpen(bill) {
  if (bill.status === 'paid') throw ApiError.conflict('الفاتورة اتدفعت بالفعل', { code: 'BILL_PAID' });
  if (bill.status === 'void') throw ApiError.conflict('الفاتورة دي ملغية', { code: 'BILL_VOID' });
}

const loadItems = async (tx, billId) => (await tx.query('SELECT * FROM bill_items WHERE bill_id = ? ORDER BY id', [billId])).map(shapeItem);

/** الإجمالي من السطور (قبل الدفع: من غير خصم) */
async function recompute(tx, billId) {
  const { subtotal } = await tx.queryOne('SELECT COALESCE(SUM(line_total), 0) AS subtotal FROM bill_items WHERE bill_id = ?', [billId]);
  await tx.execute(
    'UPDATE bills SET subtotal = ?, total = GREATEST(0, CAST(? AS SIGNED) - discount - reward_discount) WHERE id = ?',
    [Number(subtotal), Number(subtotal), billId],
  );
}

async function insertBill(tx, { shopId, businessDate, source, ticketId = null, cardId = null, name = null, phone = null, barberId = null, userId = null }) {
  const number = await nextCounter(tx, shopId, `bill:${businessDate}`);
  const result = await tx.execute(
    `INSERT INTO bills (shop_id, business_date, number, source, ticket_id, shop_customer_id, customer_name, customer_phone, barber_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [shopId, businessDate, number, source, ticketId, cardId, name, phone, barberId, userId],
  );
  return result.insertId;
}

/**
 * فاتورة الدور (موجودة أو جديدة). من غير قفل فجوة: SELECT عادي، ولو مش
 * موجودة INSERT، ولو طلب تاني سبقنا (قيد ticket_id الفريد) نقرا اللي عمله.
 */
async function ticketBill(tx, ticket, userId = null) {
  const existing = await tx.queryOne('SELECT id FROM bills WHERE ticket_id = ?', [ticket.id]);
  if (existing) return lockBill(tx, ticket.shop_id, existing.id);
  try {
    const id = await insertBill(tx, {
      shopId: ticket.shop_id, businessDate: ticket.business_date, source: 'ticket', ticketId: ticket.id,
      cardId: ticket.shop_customer_id ?? null, name: ticket.name, phone: ticket.phone ?? null,
      barberId: ticket.barber_id ?? null, userId,
    });
    return lockBill(tx, ticket.shop_id, id);
  } catch (error) {
    if (!isDuplicate(error, 'uq_bills_ticket')) throw error;
    const row = await tx.queryOne('SELECT id FROM bills WHERE ticket_id = ?', [ticket.id]);
    return lockBill(tx, ticket.shop_id, row.id);
  }
}

/* ═══════════════════ بعد الدفع ═══════════════════ */

/**
 * توزيع الخصم والمكافأة على السطور، والعمولة لكل سطر.
 *  • الخصم اليدوي بالنسبة على كل السطور: الحلاق بياخد نسبته من اللي اتدفع فعلًا.
 *  • المكافأة على حساب المحل: العمولة من السعر قبلها.
 */
async function settleItems(tx, items, { discount, rewardShares }) {
  const discountShares = allocate(discount, items.map((item) => item.line_total));
  const barberIds = [...new Set(items.map((item) => item.barber_id).filter(Boolean))];
  const barbers = barberIds.length
    ? new Map((await tx.query(`SELECT id, service_pct, product_pct FROM barbers WHERE id IN (${placeholders(barberIds.length)})`, barberIds))
      .map((row) => [row.id, row]))
    : new Map();

  for (const [index, item] of items.entries()) {
    const barber = barbers.get(item.barber_id);
    const rate = barber ? (item.kind === 'service' ? barber.service_pct : barber.product_pct) : 0;
    const base = item.line_total - discountShares[index];
    item.discount_share = discountShares[index];
    item.reward_share = rewardShares[index] ?? 0;
    item.commission_rate = rate;
    item.commission = applyRate(base, rate);
    await tx.execute(
      'UPDATE bill_items SET discount_share = ?, reward_share = ?, commission_rate = ?, commission = ? WHERE id = ?',
      [item.discount_share, item.reward_share, rate, item.commission, item.id],
    );
  }
}

/** بعد ما الفاتورة اتدفعت: المخزن، وكارت الزبون، والختم */
async function afterPaid(tx, bill, items, { settings, redeemed, userId }) {
  for (const item of items) {
    if (item.kind === 'product' && item.product_id) {
      await moveStock(tx, { shopId: bill.shop_id, productId: item.product_id, type: 'sale', qty: -item.qty, billId: bill.id, userId });
    }
  }
  if (!bill.shop_customer_id) return { stamp: false };

  await tx.queryOne('SELECT id FROM shop_customers WHERE id = ? FOR UPDATE', [bill.shop_customer_id]);
  await tx.execute('UPDATE shop_customers SET total_spent = total_spent + ? WHERE id = ?', [bill.total, bill.shop_customer_id]);

  if (redeemed) {
    await addStampEvent(tx, {
      shopId: bill.shop_id, cardId: bill.shop_customer_id, billId: bill.id, type: 'redeem',
      delta: -settings.loyalty_stamps_required, note: rewardLabel(settings), userId,
    });
    await tx.execute('UPDATE shop_customers SET rewards_redeemed = rewards_redeemed + 1 WHERE id = ?', [bill.shop_customer_id]);
    return { stamp: false };
  }

  const earns = settings.loyalty_enabled
    && items.some((item) => item.kind === 'service')
    && bill.total >= settings.loyalty_min_total;
  if (!earns) return { stamp: false };
  await addStampEvent(tx, { shopId: bill.shop_id, cardId: bill.shop_customer_id, billId: bill.id, type: 'earn', delta: 1, userId });
  await tx.execute('UPDATE bills SET stamp_awarded = 1 WHERE id = ?', [bill.id]);
  return { stamp: true };
}

/* ═══════════════════ من الطابور ═══════════════════ */

/**
 * الدور خلص (جوّه معاملة الطابور): الخدمات على الفاتورة، والزيارة على
 * الكارت، ولو الكاشير مقفول الفاتورة بتتسدّد كاش لوحدها.
 */
export async function onTicketDone(tx, ticket, settings) {
  const bill = await ticketBill(tx, ticket);
  if (bill.status !== 'open') return bill.id;

  const services = await tx.query(
    `SELECT ts.id, ts.service_id, ts.name, ts.price FROM ticket_services ts
      WHERE ts.ticket_id = ? AND NOT EXISTS (SELECT 1 FROM bill_items bi WHERE bi.ticket_service_id = ts.id)
      ORDER BY ts.id`,
    [ticket.id],
  );
  for (const service of services) {
    await tx.execute(
      `INSERT INTO bill_items (bill_id, kind, service_id, ticket_service_id, name, unit_price, qty, line_total, barber_id, added_by)
       VALUES (?, 'service', ?, ?, ?, ?, 1, ?, ?, 'ticket')`,
      [bill.id, service.service_id, service.id, service.name, service.price, service.price, ticket.barber_id ?? null],
    );
  }
  // فاتورة اتفتحت بدري (منتج وهو مستني): الحلاق والكارت بيتحدّدوا دلوقتي
  await tx.execute(
    `UPDATE bills SET barber_id = COALESCE(barber_id, ?), shop_customer_id = COALESCE(shop_customer_id, ?) WHERE id = ?`,
    [ticket.barber_id ?? null, ticket.shop_customer_id ?? null, bill.id],
  );
  await tx.execute('UPDATE bill_items SET barber_id = ? WHERE bill_id = ? AND barber_id IS NULL', [ticket.barber_id ?? null, bill.id]);
  await recompute(tx, bill.id);
  await recordVisit(tx, ticket.shop_customer_id, ticket.barber_id);

  if (!settings.cashier_enabled) await autoPay(tx, bill.id, settings);
  return bill.id;
}

/** الكاشير مقفول: الفاتورة بتتسدّد كاش بإجماليها (من غير درج) */
async function autoPay(tx, billId, settings) {
  const bill = shapeBill(await tx.queryOne(`SELECT ${BILL_COLUMNS} FROM bills WHERE id = ? FOR UPDATE`, [billId]));
  const items = await loadItems(tx, billId);
  await ensureMethods(bill.shop_id, tx);
  await settleItems(tx, items, { discount: 0, rewardShares: [] });
  if (bill.total > 0) {
    await tx.execute(
      `INSERT INTO payments (shop_id, bill_id, business_date, method_code, method_label, method_kind, amount)
       VALUES (?, ?, ?, 'cash', 'كاش', 'cash', ?)`,
      [bill.shop_id, bill.id, bill.business_date, bill.total],
    );
  }
  await tx.execute(
    `UPDATE bills SET status = 'paid', paid = total, auto_paid = 1, paid_date = business_date, paid_at = NOW() WHERE id = ?`,
    [bill.id],
  );
  await afterPaid(tx, { ...bill, status: 'paid' }, items, { settings, redeemed: false, userId: null });
}

/* ═══════════════════ العرض ═══════════════════ */

async function billView(shopId, billId, tx = read) {
  const row = await tx.queryOne(`SELECT ${BILL_COLUMNS} FROM bills WHERE id = ? AND shop_id = ?`, [billId, shopId]);
  if (!row) throw ApiError.notFound('الفاتورة غير موجودة', { code: 'BILL_NOT_FOUND' });
  const bill = shapeBill(row);
  const [items, payments, card, barber, ticket] = await Promise.all([
    tx.query(
      `SELECT bi.*, b.name AS barber_name FROM bill_items bi LEFT JOIN barbers b ON b.id = bi.barber_id
        WHERE bi.bill_id = ? ORDER BY bi.id`,
      [billId],
    ),
    tx.query(
      `SELECT p.id, p.kind, p.method_code, p.method_label, p.method_kind, p.amount, p.tendered, p.reference, p.reason,
              p.drawer_session_id, p.business_date, p.created_at, u.full_name AS created_by_name
         FROM payments p LEFT JOIN users u ON u.id = p.created_by WHERE p.bill_id = ? ORDER BY p.id`,
      [billId],
    ),
    bill.shop_customer_id
      ? tx.queryOne('SELECT id, name, phone, stamps, notes, customer_id FROM shop_customers WHERE id = ?', [bill.shop_customer_id])
      : null,
    bill.barber_id ? tx.queryOne('SELECT id, name FROM barbers WHERE id = ?', [bill.barber_id]) : null,
    bill.ticket_id ? tx.queryOne('SELECT id, number, status, business_date FROM queue_tickets WHERE id = ?', [bill.ticket_id]) : null,
  ]);
  return {
    ...bill,
    barber,
    ticket,
    items: items.map(shapeItem),
    payments: payments.map((payment) => ({
      ...payment, amount: Number(payment.amount), tendered: payment.tendered === null ? null : Number(payment.tendered),
    })),
    card: card && {
      id: card.id, name: card.name, phone: card.phone, notes: card.notes, has_app: card.customer_id !== null,
      loyalty: await loyaltyFor(shopId, card.stamps),
    },
  };
}

/* ═══════════════════ مكافأة الأختام ═══════════════════ */

/**
 * قيمة المكافأة على الفاتورة دي، ونصيب كل سطر منها.
 * @returns {{ amount: number, shares: number[] }}
 */
export function rewardFor(settings, items, afterDiscount) {
  const none = { amount: 0, shares: items.map(() => 0) };
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
    const shares = items.map((_, i) => (i === index ? amount : 0));
    return { amount, shares };
  };
  switch (settings.loyalty_reward_type) {
    case 'service': return onLine(pickLine((item) => item.kind === 'service' && item.service_id === settings.loyalty_reward_service_id));
    case 'top_service': return onLine(pickLine((item) => item.kind === 'service'));
    case 'amount': {
      const amount = Math.min(settings.loyalty_reward_value, afterDiscount);
      return { amount, shares: allocate(amount, items.map((item) => item.line_total)) };
    }
    case 'percent': {
      const amount = Math.min(percentOf(afterDiscount, settings.loyalty_reward_value), afterDiscount);
      return { amount, shares: allocate(amount, items.map((item) => item.line_total)) };
    }
    default: return none;
  }
}

/* ═══════════════════ العمليات ═══════════════════ */

export const billingService = {
  get: (shopId, id) => billView(shopId, id),

  async list(shopId, { status, date, q, page = 1, pageSize = 30 } = {}) {
    const params = [shopId];
    let where = 'b.shop_id = ?';
    if (status) { where += ' AND b.status = ?'; params.push(status); }
    if (date) { where += ' AND (b.business_date = ? OR b.paid_date = ?)'; params.push(date, date); }
    if (q) {
      where += ' AND (b.customer_name LIKE ? OR b.customer_phone LIKE ? OR b.number = ?)';
      params.push(`%${q}%`, `%${q}%`, Number(q) || -1);
    }
    const { total } = await queryOne(`SELECT COUNT(*) AS total FROM bills b WHERE ${where}`, params);
    const rows = await query(
      `SELECT b.id, b.business_date, b.number, b.source, b.ticket_id, b.customer_name, b.customer_phone, b.status,
              b.subtotal, b.discount, b.reward_discount, b.total, b.tip, b.paid, b.refunded, b.auto_paid,
              b.paid_at, b.created_at, br.name AS barber_name, t.number AS ticket_number,
              (SELECT COUNT(*) FROM bill_items bi WHERE bi.bill_id = b.id) AS items_count
         FROM bills b LEFT JOIN barbers br ON br.id = b.barber_id LEFT JOIN queue_tickets t ON t.id = b.ticket_id
        WHERE ${where}
        ORDER BY b.status = 'open' DESC, b.id DESC
        LIMIT ${Number(pageSize)} OFFSET ${Number((page - 1) * pageSize)}`,
      params,
    );
    return { rows: rows.map(shapeBill), meta: pageMeta(page, pageSize, Number(total)) };
  },

  /** فاتورة الدور (تتفتح بدري لو الزبون اشترى منتج وهو مستني) */
  async openForTicket(shopId, ticketId, userId) {
    const id = await transaction(async (tx) => {
      const ticket = await tx.queryOne(
        'SELECT id, shop_id, business_date, shop_customer_id, name, phone, barber_id, status FROM queue_tickets WHERE id = ? AND shop_id = ?',
        [ticketId, shopId],
      );
      if (!ticket) throw ApiError.notFound('الدور غير موجود', { code: 'TICKET_NOT_FOUND' });
      if (['cancelled', 'no_show'].includes(ticket.status)) {
        const existing = await tx.queryOne('SELECT id FROM bills WHERE ticket_id = ?', [ticketId]);
        if (!existing) throw ApiError.conflict('الدور ده اتلغى', { code: 'TICKET_NOT_ACTIVE' });
      }
      return (await ticketBill(tx, ticket, userId)).id;
    });
    return billView(shopId, id);
  },

  /** بيع من غير دور: منتج لزبون داخل يشتري بس (أو خدمة سريعة) */
  async createCounter(shopId, input, userId) {
    const id = await transaction(async (tx) => {
      const cardId = await linkCard(tx, { shopId, phone: input.customer_phone ?? null, name: input.customer_name });
      const billId = await insertBill(tx, {
        shopId, businessDate: await todayFor(shopId, tx), source: 'counter', cardId,
        name: input.customer_name ?? null, phone: input.customer_phone ?? null, barberId: input.barber_id ?? null, userId,
      });
      for (const item of input.items ?? []) await addLine(tx, shopId, billId, item);
      await recompute(tx, billId);
      return billId;
    });
    return billView(shopId, id);
  },

  async addItem(shopId, billId, input) {
    await transaction(async (tx) => {
      assertOpen(await lockBill(tx, shopId, billId));
      await addLine(tx, shopId, billId, input);
      await recompute(tx, billId);
    });
    return billView(shopId, billId);
  },

  /** شيل سطر. سطر خدمة = زي الخصم، فمحتاج صلاحية الخصم. */
  async removeItem(shopId, billId, itemId, { canDiscount }) {
    await transaction(async (tx) => {
      assertOpen(await lockBill(tx, shopId, billId));
      const item = await tx.queryOne('SELECT id, kind FROM bill_items WHERE id = ? AND bill_id = ?', [itemId, billId]);
      if (!item) throw ApiError.notFound('السطر غير موجود', { code: 'ITEM_NOT_FOUND' });
      if (item.kind === 'service' && !canDiscount) {
        throw ApiError.forbidden('شيل خدمة من الفاتورة للمدير بس', { code: 'FORBIDDEN' });
      }
      await tx.execute('DELETE FROM bill_items WHERE id = ?', [itemId]);
      await recompute(tx, billId);
    });
    return billView(shopId, billId);
  },

  /**
   * الدفع. input: { discount?, discount_reason?, redeem_reward?, tip?, payments: [{ method, amount, tendered?, reference? }] }
   * مجموع المدفوع لازم = الإجمالي + البقشيش بالظبط.
   */
  async checkout(shopId, billId, input, user, { canDiscount }) {
    const result = await transaction(async (tx) => {
      const bill = await lockBill(tx, shopId, billId);
      assertOpen(bill);
      const settings = await loadSettings(shopId, tx);
      const items = await loadItems(tx, billId);
      if (items.length === 0) throw ApiError.conflict('الفاتورة فاضية — زوّد خدمة أو منتج الأول', { code: 'EMPTY_BILL' });

      const subtotal = items.reduce((sum, item) => sum + item.line_total, 0);
      const discount = input.discount ?? 0;
      if (discount > subtotal) {
        throw ApiError.unprocessable('الخصم أكبر من الفاتورة', { code: 'VALIDATION_ERROR', details: { discount: 'أكبر من الفاتورة' } });
      }
      if (discount > 0 && !input.discount_reason) {
        throw ApiError.unprocessable('اكتب سبب الخصم', { code: 'VALIDATION_ERROR', details: { discount_reason: 'الحقل مطلوب' } });
      }
      if (discount > 0 && !canDiscount && discount > percentOf(subtotal, settings.max_cashier_discount_pct)) {
        throw ApiError.forbidden(`أقصى خصم للاستقبال ${settings.max_cashier_discount_pct}% — كلّم المدير`, { code: 'DISCOUNT_LIMIT' });
      }

      // مكافأة الأختام
      let reward = { amount: 0, shares: items.map(() => 0) };
      if (input.redeem_reward) {
        if (!settings.loyalty_enabled) throw ApiError.conflict('كارت الأختام مقفول في الإعدادات', { code: 'LOYALTY_DISABLED' });
        if (!bill.shop_customer_id) throw ApiError.conflict('الفاتورة مش على كارت زبون', { code: 'NO_CARD' });
        const card = await tx.queryOne('SELECT stamps FROM shop_customers WHERE id = ? FOR UPDATE', [bill.shop_customer_id]);
        if (card.stamps < settings.loyalty_stamps_required) {
          throw ApiError.conflict(`الزبون معاه ${card.stamps} ختم من ${settings.loyalty_stamps_required}`, { code: 'REWARD_NOT_EARNED' });
        }
        reward = rewardFor(settings, items, subtotal - discount);
        if (!reward || reward.amount === 0) {
          throw ApiError.conflict('المكافأة مش على أي سطر في الفاتورة دي', { code: 'REWARD_NOT_APPLICABLE' });
        }
      }

      const total = subtotal - discount - reward.amount;
      const tip = input.tip ?? 0;
      const due = total + tip;

      // طرق الدفع
      await ensureMethods(shopId, tx);
      const methods = new Map((await tx.query('SELECT code, label, kind FROM payment_methods WHERE shop_id = ? AND active = 1', [shopId]))
        .map((row) => [row.code, row]));
      const lines = input.payments ?? [];
      let paidSum = 0;
      let change = 0;
      for (const [index, line] of lines.entries()) {
        const method = methods.get(line.method);
        if (!method) {
          throw ApiError.unprocessable('طريقة الدفع دي مش متاحة', { code: 'BAD_METHOD', details: { [`payments.${index}.method`]: 'مش متاحة' } });
        }
        if (line.tendered !== undefined && line.tendered !== null) {
          if (method.kind !== 'cash') {
            throw ApiError.unprocessable('«اتدفع كام» للكاش بس', { code: 'VALIDATION_ERROR', details: { [`payments.${index}.tendered`]: 'للكاش بس' } });
          }
          if (line.tendered < line.amount) {
            throw ApiError.unprocessable('اللي اتدفع أقل من المبلغ', { code: 'VALIDATION_ERROR', details: { [`payments.${index}.tendered`]: 'أقل من المبلغ' } });
          }
          change += line.tendered - line.amount;
        }
        line.resolved = method;
        paidSum += line.amount;
      }
      if (paidSum !== due) {
        throw ApiError.unprocessable(`المدفوع ${paidSum / 100} ج والمطلوب ${due / 100} ج`, {
          code: 'PAYMENT_MISMATCH', details: { due, paid: paidSum },
        });
      }

      const drawer = await openDrawerFor(tx, shopId);
      if (!drawer && (settings.cashier_enabled || lines.some((line) => line.resolved.kind === 'cash'))) {
        throw ApiError.conflict('افتح الدرج الأول', { code: 'DRAWER_CLOSED' });
      }

      const today = await todayFor(shopId, tx);
      await settleItems(tx, items, { discount, rewardShares: reward.shares });
      for (const line of lines) {
        await tx.execute(
          `INSERT INTO payments (shop_id, bill_id, drawer_session_id, business_date, method_code, method_label, method_kind,
                                 amount, tendered, reference, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            shopId, billId, drawer?.id ?? null, today, line.method, line.resolved.label, line.resolved.kind,
            line.amount, line.tendered ?? null, line.reference ?? null, user.id,
          ],
        );
      }
      await tx.execute(
        `UPDATE bills SET status = 'paid', subtotal = ?, discount = ?, discount_reason = ?, reward_discount = ?, total = ?,
                tip = ?, paid = ?, change_given = ?, reward_redeemed = ?, paid_date = ?, paid_at = NOW(), paid_by = ?
          WHERE id = ?`,
        [subtotal, discount, discount > 0 ? input.discount_reason : null, reward.amount, total, tip, due, change,
          reward.amount > 0, today, user.id, billId],
      );
      const after = await afterPaid(tx, { ...bill, total, status: 'paid' }, items, {
        settings, redeemed: reward.amount > 0, userId: user.id,
      });
      return { change, stamp: after.stamp };
    });
    return { ...(await billView(shopId, billId)), change: result.change, stamp_awarded_now: result.stamp };
  },

  /** إلغاء فاتورة مفتوحة. فاتورة فيها سطور = للمدير بس. */
  async void(shopId, billId, reason, user, { canRefund }) {
    const before = await billView(shopId, billId);
    await transaction(async (tx) => {
      const bill = await lockBill(tx, shopId, billId);
      assertOpen(bill);
      const { n } = await tx.queryOne('SELECT COUNT(*) AS n FROM bill_items WHERE bill_id = ?', [billId]);
      if (n > 0 && !canRefund) throw ApiError.forbidden('إلغاء فاتورة فيها سطور للمدير بس', { code: 'FORBIDDEN' });
      await tx.execute(
        "UPDATE bills SET status = 'void', voided_at = NOW(), voided_by = ?, void_reason = ? WHERE id = ?",
        [user.id, reason, billId],
      );
    });
    return { before, after: await billView(shopId, billId) };
  },

  /**
   * مرتجع من فاتورة مدفوعة: دفعة بالسالب في درج النهارده، ومنتجات ترجع
   * المخزن لو اتحدّدت. العمولة على السطور اللي ما اتحسبتش بتقلّ بنفس النسبة.
   */
  async refund(shopId, billId, input, user) {
    await transaction(async (tx) => {
      const bill = await lockBill(tx, shopId, billId);
      if (bill.status !== 'paid') throw ApiError.conflict('المرتجع من فاتورة مدفوعة بس', { code: 'BILL_NOT_PAID' });
      const refundable = bill.paid - bill.refunded;
      if (input.amount > refundable) {
        throw ApiError.unprocessable(`أقصى مرتجع ${refundable / 100} ج`, { code: 'VALIDATION_ERROR', details: { amount: 'أكبر من المدفوع' } });
      }
      await ensureMethods(shopId, tx);
      const method = await tx.queryOne('SELECT code, label, kind FROM payment_methods WHERE shop_id = ? AND code = ? AND active = 1', [shopId, input.method]);
      if (!method) throw ApiError.unprocessable('طريقة الدفع دي مش متاحة', { code: 'BAD_METHOD', details: { method: 'مش متاحة' } });
      const drawer = await openDrawerFor(tx, shopId);
      if (method.kind === 'cash' && !drawer) throw ApiError.conflict('افتح الدرج الأول', { code: 'DRAWER_CLOSED' });

      const items = await loadItems(tx, billId);
      for (const line of input.restock ?? []) {
        const item = items.find((row) => row.id === line.item_id);
        if (!item || item.kind !== 'product' || !item.product_id) {
          throw ApiError.unprocessable('السطر ده مش منتج في الفاتورة', { code: 'VALIDATION_ERROR', details: { restock: 'سطر غلط' } });
        }
        const { back } = await tx.queryOne(
          "SELECT COALESCE(SUM(qty), 0) AS back FROM stock_movements WHERE bill_id = ? AND product_id = ? AND type = 'refund'",
          [billId, item.product_id],
        );
        if (Number(back) + line.qty > item.qty) {
          throw ApiError.unprocessable('الكمية أكبر من اللي اتباع', { code: 'VALIDATION_ERROR', details: { restock: 'أكبر من اللي اتباع' } });
        }
        await moveStock(tx, { shopId, productId: item.product_id, type: 'refund', qty: line.qty, billId, note: input.reason, userId: user.id });
      }

      await tx.execute(
        `INSERT INTO payments (shop_id, bill_id, drawer_session_id, business_date, kind, method_code, method_label, method_kind,
                               amount, reason, created_by)
         VALUES (?, ?, ?, ?, 'refund', ?, ?, ?, ?, ?, ?)`,
        [shopId, billId, drawer?.id ?? null, await todayFor(shopId, tx), method.code, method.label, method.kind,
          -input.amount, input.reason, user.id],
      );
      const refunded = bill.refunded + input.amount;
      await tx.execute('UPDATE bills SET refunded = ? WHERE id = ?', [refunded, billId]);

      // العمولة: نسبة اللي فاضل من إجمالي الفاتورة (المرتجع بيتخصم من الإجمالي قبل البقشيش)
      if (bill.total > 0) {
        const kept = Math.max(0, bill.total - Math.min(refunded, bill.total)) / bill.total;
        for (const item of items) {
          if (item.settlement_id) continue;
          const commission = Math.round(applyRate(item.line_total - item.discount_share, item.commission_rate) * kept);
          await tx.execute('UPDATE bill_items SET commission = ? WHERE id = ?', [commission, item.id]);
        }
      }
    });
    return billView(shopId, billId);
  },

  /** بيانات الإيصال (الطباعة في الواجهة) */
  async receipt(shopId, billId) {
    const bill = await billView(shopId, billId);
    const [shop, settings] = await Promise.all([
      queryOne('SELECT name, slug, phone, whatsapp, address, city FROM shops WHERE id = ?', [shopId]),
      loadSettings(shopId),
    ]);
    return {
      shop: { ...shop, url: `${env.customerAppUrl}/s/${shop.slug}` },
      width: settings.receipt_width,
      footer: settings.receipt_footer,
      bill,
    };
  },
};

/** سطر جديد (أو زيادة كمية نفس المنتج) */
async function addLine(tx, shopId, billId, input) {
  const bill = await tx.queryOne('SELECT barber_id FROM bills WHERE id = ?', [billId]);
  const barberId = input.barber_id ?? bill.barber_id ?? null;
  if (input.barber_id) {
    const barber = await tx.queryOne('SELECT id FROM barbers WHERE id = ? AND shop_id = ?', [input.barber_id, shopId]);
    if (!barber) throw ApiError.unprocessable('الحلاق غير موجود', { code: 'BAD_BARBER', details: { barber_id: 'غير موجود' } });
  }

  if (input.product_id) {
    const product = await tx.queryOne(
      'SELECT id, name, price, cost FROM products WHERE id = ? AND shop_id = ? AND archived_at IS NULL AND active = 1',
      [input.product_id, shopId],
    );
    if (!product) throw ApiError.unprocessable('المنتج غير موجود أو موقوف', { code: 'BAD_PRODUCT', details: { product_id: 'غير موجود' } });
    const qty = input.qty ?? 1;
    const same = await tx.queryOne(
      "SELECT id, qty FROM bill_items WHERE bill_id = ? AND kind = 'product' AND product_id = ? AND unit_price = ? AND (barber_id <=> ?)",
      [billId, product.id, product.price, barberId],
    );
    if (same) {
      await tx.execute('UPDATE bill_items SET qty = qty + ?, line_total = unit_price * (qty) WHERE id = ?', [qty, same.id]);
      return;
    }
    await tx.execute(
      `INSERT INTO bill_items (bill_id, kind, product_id, name, unit_price, qty, line_total, barber_id, unit_cost)
       VALUES (?, 'product', ?, ?, ?, ?, ?, ?, ?)`,
      [billId, product.id, product.name, product.price, qty, Number(product.price) * qty, barberId, product.cost],
    );
    return;
  }

  const service = await tx.queryOne(
    'SELECT id, name, price FROM services WHERE id = ? AND shop_id = ? AND archived_at IS NULL',
    [input.service_id, shopId],
  );
  if (!service) throw ApiError.unprocessable('الخدمة غير موجودة', { code: 'BAD_SERVICE', details: { service_id: 'غير موجودة' } });
  await tx.execute(
    `INSERT INTO bill_items (bill_id, kind, service_id, name, unit_price, qty, line_total, barber_id)
     VALUES (?, 'service', ?, ?, ?, 1, ?, ?)`,
    [billId, service.id, service.name, service.price, service.price, barberId],
  );
}
