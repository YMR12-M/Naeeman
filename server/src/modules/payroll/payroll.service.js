/**
 * ═══════════════════════════════════════════════════════════════
 *  حساب الحلاقين
 *
 *  معادلة واحدة لكل الأنواع (النوع مجرّد قالب في الواجهة):
 *    الصافي = اليومية × أيام الشغل + عمولة الخدمات + عمولة المنتجات
 *             + البقشيش − الإيجار − السُلف
 *
 *  • العمولة نفسها اتحسبت على كل سطر وقت الدفع (bill_items.commission)،
 *    فالحساب هنا بيجمع بس.
 *  • «الحساب» بيقفل كل اللي ما اتحسبش لحد تاريخ معيّن: السطور والبقشيش
 *    والأيام والسُلف بتاخد رقم الحساب، فمفيش حاجة تتحسب مرّتين، والحساب
 *    الجاي بيبدأ من اليوم اللي بعده.
 *  • الإيجار بالتناسب مع مدّة الحساب (يومي = × أيام الشغل).
 * ═══════════════════════════════════════════════════════════════
 */
import { query, queryOne, transaction } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { addDays, diffDays } from '../../utils/dates.js';
import { todayFor } from '../billing/billing.service.js';
import { addMovement } from '../billing/drawer.service.js';

const PAY_COLUMNS = 'id, name, pay_type, service_pct, product_pct, daily_wage, rent_amount, rent_period, tips_to_barber, created_at, archived_at';

const shapePay = (row) => ({
  ...row,
  daily_wage: Number(row.daily_wage),
  rent_amount: Number(row.rent_amount),
  tips_to_barber: Boolean(row.tips_to_barber),
});

const n = (value) => Number(value ?? 0);

/** يوم شغل للحلاق (اتعلّم «موجود» أو اشتغل على دور) */
export async function markBarberDay(tx, { shopId, barberId, date }) {
  await tx.execute(
    'INSERT IGNORE INTO barber_days (barber_id, business_date, shop_id) VALUES (?, ?, ?)',
    [barberId, date, shopId],
  );
}

/** الإيجار المستحق على مدّة الحساب */
export function rentFor(pay, periodDays, daysWorked) {
  if (!pay.rent_amount) return 0;
  if (pay.rent_period === 'day') return pay.rent_amount * daysWorked;
  if (pay.rent_period === 'week') return Math.round((pay.rent_amount * periodDays) / 7);
  return Math.round((pay.rent_amount * periodDays) / 30);
}

async function findBarber(tx, shopId, barberId, { lock = false } = {}) {
  const row = await tx.queryOne(
    `SELECT ${PAY_COLUMNS} FROM barbers WHERE id = ? AND shop_id = ?${lock ? ' FOR UPDATE' : ''}`,
    [barberId, shopId],
  );
  if (!row) throw ApiError.notFound('الحلاق غير موجود', { code: 'BARBER_NOT_FOUND' });
  return shapePay(row);
}

/** كل اللي ما اتحسبش للحلاق لحد `to` */
async function compute(tx, shopId, barber, to) {
  const last = await tx.queryOne(
    'SELECT MAX(period_to) AS last_to FROM barber_settlements WHERE barber_id = ? AND shop_id = ?',
    [barber.id, shopId],
  );
  const firstActivity = await tx.queryOne(
    `SELECT LEAST(
       COALESCE((SELECT MIN(business_date) FROM barber_days WHERE barber_id = ? AND settlement_id IS NULL), '9999-12-31'),
       COALESCE((SELECT MIN(b.paid_date) FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
                  WHERE bi.barber_id = ? AND bi.settlement_id IS NULL AND b.status = 'paid'), '9999-12-31')
     ) AS first`,
    [barber.id, barber.id],
  );
  // الحساب بيبدأ بعد آخر حساب. حساب تاني في نفس اليوم (الحلاق كمّل شغل بعده)
  // مسموح، بس من غير أيام إيجار جديدة.
  const lastTo = last?.last_to ? String(last.last_to) : null;
  if (lastTo && to < lastTo) {
    throw ApiError.unprocessable(`آخر حساب كان لحد ${lastTo} — اختار تاريخ بعده`, {
      code: 'VALIDATION_ERROR', details: { to: 'قبل آخر حساب' },
    });
  }
  const first = String(firstActivity.first);
  const from = lastTo
    ? (to > lastTo ? addDays(lastTo, 1) : to)
    : (first !== '9999-12-31' && first <= to ? first : to);
  const periodDays = lastTo ? diffDays(lastTo, to) : diffDays(from, to) + 1;

  const [lines, tips, days, advances, advanceRows] = await Promise.all([
    tx.query(
      `SELECT bi.kind, COALESCE(SUM(bi.line_total - bi.discount_share - bi.reward_share), 0) AS net,
              COALESCE(SUM(bi.commission), 0) AS commission, COUNT(*) AS count
         FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
        WHERE bi.barber_id = ? AND bi.settlement_id IS NULL AND b.status = 'paid' AND b.shop_id = ? AND b.paid_date <= ?
        GROUP BY bi.kind`,
      [barber.id, shopId, to],
    ),
    // البقشيش اللي اترجع في مرتجع (بعد ما الإجمالي كله رجع) ما بيتحسبش
    tx.queryOne(
      `SELECT COALESCE(SUM(GREATEST(0, CAST(tip AS SIGNED) - GREATEST(0, CAST(refunded AS SIGNED) - CAST(total AS SIGNED)))), 0) AS tips
         FROM bills WHERE barber_id = ? AND shop_id = ? AND status = 'paid' AND tip > 0 AND tip_settlement_id IS NULL AND paid_date <= ?`,
      [barber.id, shopId, to],
    ),
    tx.queryOne(
      'SELECT COUNT(*) AS days FROM barber_days WHERE barber_id = ? AND settlement_id IS NULL AND business_date <= ?',
      [barber.id, to],
    ),
    tx.queryOne(
      `SELECT COALESCE(SUM(amount), 0) AS amount FROM cash_movements
        WHERE barber_id = ? AND shop_id = ? AND type = 'advance' AND settlement_id IS NULL AND business_date <= ?`,
      [barber.id, shopId, to],
    ),
    tx.query(
      `SELECT id, amount, note, business_date, created_at FROM cash_movements
        WHERE barber_id = ? AND shop_id = ? AND type = 'advance' AND settlement_id IS NULL AND business_date <= ? ORDER BY id`,
      [barber.id, shopId, to],
    ),
  ]);

  const service = lines.find((row) => row.kind === 'service');
  const product = lines.find((row) => row.kind === 'product');
  const daysWorked = n(days.days);
  const result = {
    barber_id: barber.id,
    barber_name: barber.name,
    pay: {
      pay_type: barber.pay_type, service_pct: barber.service_pct, product_pct: barber.product_pct,
      daily_wage: barber.daily_wage, rent_amount: barber.rent_amount, rent_period: barber.rent_period,
      tips_to_barber: barber.tips_to_barber,
    },
    period_from: from,
    period_to: to,
    period_days: periodDays,
    days_worked: daysWorked,
    services_total: n(service?.net),
    services_count: n(service?.count),
    products_total: n(product?.net),
    service_commission: n(service?.commission),
    product_commission: n(product?.commission),
    wages: daysWorked * barber.daily_wage,
    tips: barber.tips_to_barber ? n(tips.tips) : 0,
    rent: rentFor(barber, periodDays, daysWorked),
    advances: n(advances.amount),
    advance_list: advanceRows.map((row) => ({ ...row, amount: n(row.amount) })),
  };
  result.earnings = result.wages + result.service_commission + result.product_commission + result.tips;
  result.net = result.earnings - result.rent - result.advances;
  return result;
}

export const payrollService = {
  /** طريقة حساب كل الحلاقين (للمالك والمدير) */
  async barbers(shopId) {
    const rows = await query(`SELECT ${PAY_COLUMNS} FROM barbers WHERE shop_id = ? AND archived_at IS NULL ORDER BY sort_order, id`, [shopId]);
    const last = await query(
      `SELECT barber_id, MAX(period_to) AS last_to FROM barber_settlements WHERE shop_id = ? GROUP BY barber_id`,
      [shopId],
    );
    const lastBy = new Map(last.map((row) => [row.barber_id, row.last_to]));
    return rows.map((row) => ({ ...shapePay(row), last_settled_to: lastBy.get(row.id) ?? null }));
  },

  async setPay(shopId, barberId, input) {
    const before = await findBarber({ queryOne }, shopId, barberId);
    await query(
      `UPDATE barbers SET pay_type = ?, service_pct = ?, product_pct = ?, daily_wage = ?, rent_amount = ?, rent_period = ?, tips_to_barber = ?
        WHERE id = ? AND shop_id = ?`,
      [input.pay_type, input.service_pct, input.product_pct, input.daily_wage, input.rent_amount, input.rent_period,
        input.tips_to_barber, barberId, shopId],
    );
    return { before, after: await findBarber({ queryOne }, shopId, barberId) };
  },

  async preview(shopId, barberId, to) {
    const date = to ?? await todayFor(shopId);
    return compute({ query, queryOne }, shopId, await findBarber({ queryOne }, shopId, barberId), date);
  },

  /**
   * الحساب نفسه: بيقفل كل اللي ما اتحسبش لحد `to`.
   * via = drawer ← الصافي يتصرف من الدرج (أو يتحصّل لو على الحلاق) · outside ← برّه الدرج
   */
  async settle(shopId, barberId, { to, via, note }, user) {
    const today = await todayFor(shopId);
    const date = to ?? today;
    if (date > today) throw ApiError.unprocessable('مينفعش تحاسب على أيام لسه ما جتش', { code: 'VALIDATION_ERROR', details: { to: 'بعد النهارده' } });

    const id = await transaction(async (tx) => {
      // قفل الحلاق: حسابين في نفس اللحظة ما يتعدّوش
      const barber = await findBarber(tx, shopId, barberId, { lock: true });
      const calc = await compute(tx, shopId, barber, date);
      const nothing = calc.days_worked === 0 && calc.services_count === 0 && calc.products_total === 0
        && calc.tips === 0 && calc.advances === 0 && calc.rent === 0;
      if (nothing) throw ApiError.conflict('مفيش حاجة تتحسب للفترة دي', { code: 'NOTHING_TO_SETTLE' });

      const settledVia = calc.net === 0 ? 'none' : via;
      const result = await tx.execute(
        `INSERT INTO barber_settlements
           (shop_id, barber_id, period_from, period_to, pay_snapshot, days_worked, services_total, products_total,
            service_commission, product_commission, wages, tips, rent, advances, net, settled_via, note, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          shopId, barberId, calc.period_from, calc.period_to, JSON.stringify(calc.pay), calc.days_worked, calc.services_total,
          calc.products_total, calc.service_commission, calc.product_commission, calc.wages, calc.tips, calc.rent,
          calc.advances, calc.net, settledVia, note ?? null, user.id,
        ],
      );
      const settlementId = result.insertId;

      await tx.execute(
        `UPDATE bill_items bi JOIN bills b ON b.id = bi.bill_id SET bi.settlement_id = ?
          WHERE bi.barber_id = ? AND bi.settlement_id IS NULL AND b.status = 'paid' AND b.shop_id = ? AND b.paid_date <= ?`,
        [settlementId, barberId, shopId, date],
      );
      if (barber.tips_to_barber) {
        await tx.execute(
          `UPDATE bills SET tip_settlement_id = ?
            WHERE barber_id = ? AND shop_id = ? AND status = 'paid' AND tip > 0 AND tip_settlement_id IS NULL AND paid_date <= ?`,
          [settlementId, barberId, shopId, date],
        );
      }
      await tx.execute(
        'UPDATE barber_days SET settlement_id = ? WHERE barber_id = ? AND settlement_id IS NULL AND business_date <= ?',
        [settlementId, barberId, date],
      );
      await tx.execute(
        `UPDATE cash_movements SET settlement_id = ?
          WHERE barber_id = ? AND shop_id = ? AND type = 'advance' AND settlement_id IS NULL AND business_date <= ?`,
        [settlementId, barberId, shopId, date],
      );

      if (settledVia === 'drawer') {
        const movement = await addMovement(tx, shopId, {
          type: calc.net > 0 ? 'payout' : 'cash_in',
          amount: Math.abs(calc.net),
          barberId,
          note: calc.net > 0 ? `حساب ${barber.name} لحد ${date}` : `${barber.name} دفع اللي عليه لحد ${date}`,
          settlementId,
          userId: user.id,
        });
        await tx.execute('UPDATE barber_settlements SET cash_movement_id = ? WHERE id = ?', [movement.id, settlementId]);
      }
      return settlementId;
    });
    return this.get(shopId, id);
  },

  async get(shopId, id) {
    const row = await queryOne(
      `SELECT s.*, b.name AS barber_name, u.full_name AS created_by_name FROM barber_settlements s
         JOIN barbers b ON b.id = s.barber_id LEFT JOIN users u ON u.id = s.created_by
        WHERE s.id = ? AND s.shop_id = ?`,
      [id, shopId],
    );
    if (!row) throw ApiError.notFound('الحساب غير موجود', { code: 'SETTLEMENT_NOT_FOUND' });
    return shapeSettlement(row);
  },

  async list(shopId, { barberId } = {}) {
    const params = [shopId];
    let where = 's.shop_id = ?';
    if (barberId) { where += ' AND s.barber_id = ?'; params.push(barberId); }
    const rows = await query(
      `SELECT s.*, b.name AS barber_name, u.full_name AS created_by_name FROM barber_settlements s
         JOIN barbers b ON b.id = s.barber_id LEFT JOIN users u ON u.id = s.created_by
        WHERE ${where} ORDER BY s.id DESC LIMIT 100`,
      params,
    );
    return rows.map(shapeSettlement);
  },
};

const SETTLEMENT_MONEY = ['services_total', 'products_total', 'service_commission', 'product_commission', 'wages', 'tips', 'rent', 'advances', 'net'];

function shapeSettlement(row) {
  const out = { ...row, pay_snapshot: typeof row.pay_snapshot === 'string' ? JSON.parse(row.pay_snapshot) : row.pay_snapshot };
  for (const key of SETTLEMENT_MONEY) out[key] = Number(out[key]);
  return out;
}
