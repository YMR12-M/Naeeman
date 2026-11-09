/**
 * ═══════════════════════════════════════════════════════════════
 *  تقفيل اليوم (Z)
 *
 *  زي ماكينات الكاشير: التقفيل بيقفل «الفترة» من آخر تقفيل لحد دلوقتي،
 *  مش يوم في التقويم. كل دفعة وحركة درج ووردية وفاتورة مدفوعة ما
 *  اتقفلتش (day_close_id = NULL) بتدخل في التقفيل الجاي، فمفيش حاجة
 *  تتعدّ مرّتين ولا حاجة تقع بين يومين.
 *
 *  لازم الدرج يكون مقفول (اتعدّ). الفواتير المفتوحة بتترحّل للفترة
 *  الجاية وبتظهر في الملخّص كتنبيه.
 * ═══════════════════════════════════════════════════════════════
 */
import { query, queryOne, transaction } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { nextCounter } from '../../utils/counters.js';
import { todayFor } from './billing.service.js';

const n = (value) => Number(value ?? 0);

/** ملخّص كل اللي ما اتقفلش (أو تقفيل معيّن لو closeId) */
export async function periodSummary(tx, shopId, closeId = null) {
  const scope = closeId === null ? 'IS NULL' : '= ?';
  const params = closeId === null ? [shopId] : [shopId, closeId];

  const [bills, lines, methods, refunds, moves, drawers, barbers, openBills, first] = await Promise.all([
    tx.queryOne(
      `SELECT COUNT(*) AS count, COALESCE(SUM(subtotal), 0) AS subtotal, COALESCE(SUM(discount), 0) AS discounts,
              COALESCE(SUM(reward_discount), 0) AS rewards, COALESCE(SUM(total), 0) AS sales, COALESCE(SUM(tip), 0) AS tips,
              SUM(reward_redeemed) AS rewards_count, SUM(auto_paid) AS auto_paid
         FROM bills WHERE shop_id = ? AND status = 'paid' AND day_close_id ${scope}`,
      params,
    ),
    tx.query(
      `SELECT bi.kind, COALESCE(SUM(bi.line_total - bi.discount_share - bi.reward_share), 0) AS net, COALESCE(SUM(bi.qty), 0) AS qty,
              COALESCE(SUM(CASE WHEN bi.kind = 'product' THEN bi.unit_cost * bi.qty END), 0) AS cost
         FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
        WHERE b.shop_id = ? AND b.status = 'paid' AND b.day_close_id ${scope}
        GROUP BY bi.kind`,
      params,
    ),
    tx.query(
      `SELECT method_code AS code, method_label AS label, method_kind AS kind, SUM(amount) AS net,
              SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS received, COUNT(*) AS count
         FROM payments WHERE shop_id = ? AND day_close_id ${scope}
        GROUP BY method_code, method_label, method_kind ORDER BY method_kind <> 'cash', method_code`,
      params,
    ),
    tx.queryOne(
      `SELECT COALESCE(SUM(-amount), 0) AS amount, COUNT(*) AS count FROM payments
        WHERE shop_id = ? AND kind = 'refund' AND day_close_id ${scope}`,
      params,
    ),
    tx.query(
      `SELECT type, SUM(amount) AS amount, COUNT(*) AS count FROM cash_movements
        WHERE shop_id = ? AND day_close_id ${scope} GROUP BY type`,
      params,
    ),
    tx.query(
      `SELECT id, status, opened_at, closed_at, opening_float, expected_cash, counted_cash, variance
         FROM drawer_sessions WHERE shop_id = ? AND day_close_id ${scope} ORDER BY id`,
      params,
    ),
    tx.query(
      `SELECT br.id, br.name,
              COALESCE(SUM(CASE WHEN bi.kind = 'service' THEN bi.line_total - bi.discount_share - bi.reward_share END), 0) AS services,
              COALESCE(SUM(CASE WHEN bi.kind = 'product' THEN bi.line_total - bi.discount_share - bi.reward_share END), 0) AS products,
              COALESCE(SUM(bi.commission), 0) AS commission,
              COUNT(DISTINCT CASE WHEN bi.kind = 'service' THEN b.id END) AS customers
         FROM bill_items bi JOIN bills b ON b.id = bi.bill_id JOIN barbers br ON br.id = bi.barber_id
        WHERE b.shop_id = ? AND b.status = 'paid' AND b.day_close_id ${scope}
        GROUP BY br.id, br.name ORDER BY services DESC, br.id`,
      params,
    ),
    closeId === null
      ? tx.queryOne("SELECT COUNT(*) AS count, COALESCE(SUM(subtotal), 0) AS total FROM bills WHERE shop_id = ? AND status = 'open'", [shopId])
      : null,
    tx.queryOne(
      `SELECT LEAST(
         COALESCE((SELECT MIN(created_at) FROM payments WHERE shop_id = ? AND day_close_id ${scope}), NOW(3)),
         COALESCE((SELECT MIN(opened_at) FROM drawer_sessions WHERE shop_id = ? AND day_close_id ${scope}), NOW(3)),
         COALESCE((SELECT MIN(paid_at) FROM bills WHERE shop_id = ? AND status = 'paid' AND day_close_id ${scope}), NOW(3))
       ) AS start`,
      [...params, ...params, ...params],
    ),
  ]);

  // البقشيش لكل حلاق (بيتسجّل على الفاتورة باسم الحلاق اللي اشتغل عليها)
  const tips = await tx.query(
    `SELECT barber_id, SUM(tip) AS tips FROM bills
      WHERE shop_id = ? AND status = 'paid' AND tip > 0 AND barber_id IS NOT NULL AND day_close_id ${scope} GROUP BY barber_id`,
    params,
  );
  const tipsBy = new Map(tips.map((row) => [row.barber_id, n(row.tips)]));

  const movements = { expense: 0, advance: 0, payout: 0, cash_in: 0, cash_out: 0 };
  for (const row of moves) movements[row.type] = n(row.amount);
  const kind = (key) => lines.find((row) => row.kind === key);

  return {
    period_start: first?.start ?? null,
    bills: n(bills.count),
    auto_paid: n(bills.auto_paid),
    subtotal: n(bills.subtotal),
    discounts: n(bills.discounts),
    rewards: n(bills.rewards),
    rewards_count: n(bills.rewards_count),
    sales: n(bills.sales),
    services_sales: n(kind('service')?.net),
    products_sales: n(kind('product')?.net),
    products_qty: n(kind('product')?.qty),
    products_cost: n(kind('product')?.cost),
    tips: n(bills.tips),
    refunds: n(refunds.amount),
    refunds_count: n(refunds.count),
    methods: methods.map((row) => ({
      code: row.code, label: row.label, kind: row.kind, net: n(row.net), received: n(row.received), count: n(row.count),
    })),
    collected: methods.reduce((sum, row) => sum + n(row.net), 0),
    movements,
    drawers: drawers.map((row) => ({
      ...row,
      opening_float: n(row.opening_float),
      expected_cash: row.expected_cash === null ? null : n(row.expected_cash),
      counted_cash: row.counted_cash === null ? null : n(row.counted_cash),
      variance: row.variance === null ? null : n(row.variance),
    })),
    variance: drawers.reduce((sum, row) => sum + n(row.variance), 0),
    barbers: barbers.map((row) => ({
      id: row.id, name: row.name, services: n(row.services), products: n(row.products),
      commission: n(row.commission), tips: tipsBy.get(row.id) ?? 0, customers: n(row.customers),
    })),
    open_bills: openBills ? { count: n(openBills.count), total: n(openBills.total) } : null,
  };
}

const shapeClose = (row) => row && ({
  ...row,
  summary: typeof row.summary === 'string' ? JSON.parse(row.summary) : row.summary,
});

export const dayCloseService = {
  /** اللي هيتقفل لو قفلت دلوقتي، ومعاه أي حاجة مانعة */
  async preview(shopId) {
    const summary = await periodSummary({ query, queryOne }, shopId);
    const open = await queryOne("SELECT id FROM drawer_sessions WHERE shop_id = ? AND status = 'open'", [shopId]);
    const empty = summary.bills === 0 && summary.methods.length === 0 && summary.drawers.length === 0
      && Object.values(summary.movements).every((value) => value === 0);
    return {
      business_date: await todayFor(shopId),
      summary,
      blockers: [
        ...(open ? [{ code: 'DRAWER_OPEN', message: 'الدرج لسه مفتوح — اقفله بعدّ الكاش الأول' }] : []),
        ...(empty ? [{ code: 'NOTHING_TO_CLOSE', message: 'مفيش حاجة جديدة من آخر تقفيل' }] : []),
      ],
      warnings: summary.open_bills.count > 0
        ? [{ code: 'OPEN_BILLS', message: `فيه ${summary.open_bills.count} فاتورة مفتوحة — هتترحّل للتقفيل الجاي` }]
        : [],
    };
  },

  async close(shopId, note, userId) {
    const id = await transaction(async (tx) => {
      // قفل باسم المحل: تقفيلين في نفس اللحظة ما يتعدّوش
      const lockName = `naeeman:dayclose:${shopId}`;
      const { got } = await tx.queryOne('SELECT GET_LOCK(?, 5) AS got', [lockName]);
      if (got !== 1) throw ApiError.conflict('فيه تقفيل شغّال دلوقتي — استنّى ثانية', { code: 'IN_PROGRESS' });
      try {
        const open = await tx.queryOne("SELECT id FROM drawer_sessions WHERE shop_id = ? AND status = 'open' FOR UPDATE", [shopId]);
        if (open) throw ApiError.conflict('الدرج لسه مفتوح — اقفله بعدّ الكاش الأول', { code: 'DRAWER_OPEN' });

        const summary = await periodSummary(tx, shopId);
        const empty = summary.bills === 0 && summary.methods.length === 0 && summary.drawers.length === 0
          && Object.values(summary.movements).every((value) => value === 0);
        if (empty) throw ApiError.conflict('مفيش حاجة جديدة من آخر تقفيل', { code: 'NOTHING_TO_CLOSE' });

        const number = await nextCounter(tx, shopId, 'day_close');
        const result = await tx.execute(
          `INSERT INTO day_closes (shop_id, number, business_date, period_start, period_end, summary, note, closed_by)
           VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)`,
          [shopId, number, await todayFor(shopId, tx), summary.period_start, JSON.stringify(summary), note ?? null, userId],
        );
        const closeId = result.insertId;
        await tx.execute("UPDATE bills SET day_close_id = ? WHERE shop_id = ? AND status = 'paid' AND day_close_id IS NULL", [closeId, shopId]);
        await tx.execute('UPDATE payments SET day_close_id = ? WHERE shop_id = ? AND day_close_id IS NULL', [closeId, shopId]);
        await tx.execute('UPDATE cash_movements SET day_close_id = ? WHERE shop_id = ? AND day_close_id IS NULL', [closeId, shopId]);
        await tx.execute("UPDATE drawer_sessions SET day_close_id = ? WHERE shop_id = ? AND status = 'closed' AND day_close_id IS NULL", [closeId, shopId]);
        return closeId;
      } finally {
        await tx.queryOne('SELECT RELEASE_LOCK(?) AS released', [lockName]);
      }
    });
    return this.get(shopId, id);
  },

  async list(shopId, { limit = 30 } = {}) {
    const rows = await query(
      `SELECT d.id, d.number, d.business_date, d.period_start, d.period_end, d.note, d.created_at, u.full_name AS closed_by_name,
              JSON_EXTRACT(d.summary, '$.sales') AS sales, JSON_EXTRACT(d.summary, '$.collected') AS collected,
              JSON_EXTRACT(d.summary, '$.variance') AS variance, JSON_EXTRACT(d.summary, '$.bills') AS bills
         FROM day_closes d LEFT JOIN users u ON u.id = d.closed_by
        WHERE d.shop_id = ? ORDER BY d.id DESC LIMIT ${Math.min(Math.max(Number(limit) || 30, 1), 200)}`,
      [shopId],
    );
    return rows.map((row) => ({
      ...row, sales: n(row.sales), collected: n(row.collected), variance: n(row.variance), bills: n(row.bills),
    }));
  },

  async get(shopId, id) {
    const row = await queryOne(
      `SELECT d.*, u.full_name AS closed_by_name FROM day_closes d LEFT JOIN users u ON u.id = d.closed_by
        WHERE d.id = ? AND d.shop_id = ?`,
      [id, shopId],
    );
    if (!row) throw ApiError.notFound('التقفيل غير موجود', { code: 'DAY_CLOSE_NOT_FOUND' });
    return shapeClose(row);
  },
};
