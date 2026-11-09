/**
 * التقارير: ملخّص يوم شغل، أو فترة.
 *
 *  • أعداد الأدوار والانتظار ومدّة الخدمة من الطابور (queue_tickets).
 *  • الفلوس كلها من الفواتير (المرحلة التانية): المبيعات = إجمالي الفواتير
 *    اللي اتدفعت في اليوم (بعد الخصم والمكافأة)، والمحصّل لكل طريقة دفع
 *    من الدفعات نفسها (فيه البقشيش، والمرتجع بالسالب).
 *    لو الكاشير مقفول، الدور اللي خلص بيتسدّد كاش لوحده، فالأرقام زي
 *    المرحلة الأولى بالظبط.
 *
 *  • الانتظار = من وصوله المحل (أو أخد الدور لو جه من الشارع) لحد ما قعد على الكرسي.
 *  • مدّة الخدمة = من «بدأ» لحد «خلص»، للأدوار اللي خلصت بس.
 */
import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../../config/db.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ApiError } from '../../utils/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/response.js';
import { dateRangeRefine, isoDate } from '../../utils/schemas.js';
import { diffDays } from '../../utils/dates.js';
import { businessDateAt } from '../../utils/hours.js';
import { loadHours } from '../shop/shop.service.js';

const round1 = (value) => (value === null || value === undefined ? null : Math.round(Number(value) * 10) / 10);
const n = (value) => Number(value ?? 0);

/** ملخّص من `from` لـ `to` (يوم واحد لو متساويين) */
export async function summary(shopId, from, to) {
  const ticketParams = [shopId, from, to];
  const totals = await queryOne(
    `SELECT COUNT(*) AS tickets,
            SUM(status = 'done') AS done,
            SUM(status = 'cancelled') AS cancelled,
            SUM(status = 'no_show') AS no_show,
            SUM(status IN ('waiting','serving')) AS active,
            SUM(source = 'app') AS from_app,
            SUM(source = 'kiosk') AS from_kiosk,
            SUM(source = 'staff') AS from_staff,
            AVG(CASE WHEN started_at IS NOT NULL
                     THEN TIMESTAMPDIFF(SECOND, COALESCE(arrived_at, created_at), started_at) / 60 END) AS avg_wait_minutes,
            AVG(CASE WHEN status = 'done' AND ended_by <> 'system'
                     THEN TIMESTAMPDIFF(SECOND, started_at, finished_at) / 60 END) AS avg_service_minutes
       FROM queue_tickets WHERE shop_id = ? AND business_date BETWEEN ? AND ?`,
    ticketParams,
  );

  const billParams = [shopId, from, to];
  const [money, kinds, methods, refunds, expenses, barbers, barberTickets, services, products, open] = await Promise.all([
    queryOne(
      `SELECT COUNT(*) AS bills, COALESCE(SUM(total), 0) AS sales, COALESCE(SUM(discount), 0) AS discounts,
              COALESCE(SUM(reward_discount), 0) AS rewards, COALESCE(SUM(tip), 0) AS tips
         FROM bills WHERE shop_id = ? AND status = 'paid' AND paid_date BETWEEN ? AND ?`,
      billParams,
    ),
    query(
      `SELECT bi.kind, COALESCE(SUM(bi.line_total - bi.discount_share - bi.reward_share), 0) AS net,
              COALESCE(SUM(CASE WHEN bi.kind = 'product' THEN bi.unit_cost * bi.qty END), 0) AS cost
         FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
        WHERE b.shop_id = ? AND b.status = 'paid' AND b.paid_date BETWEEN ? AND ? GROUP BY bi.kind`,
      billParams,
    ),
    query(
      `SELECT method_code AS code, method_label AS label, method_kind AS kind, SUM(amount) AS net, COUNT(*) AS count
         FROM payments WHERE shop_id = ? AND business_date BETWEEN ? AND ?
        GROUP BY method_code, method_label, method_kind ORDER BY method_kind <> 'cash', net DESC`,
      billParams,
    ),
    queryOne(
      `SELECT COALESCE(SUM(-amount), 0) AS amount FROM payments
        WHERE shop_id = ? AND kind = 'refund' AND business_date BETWEEN ? AND ?`,
      billParams,
    ),
    queryOne(
      `SELECT COALESCE(SUM(amount), 0) AS amount FROM cash_movements
        WHERE shop_id = ? AND type = 'expense' AND business_date BETWEEN ? AND ?`,
      billParams,
    ),
    query(
      `SELECT br.id, br.name, br.chair_no,
              COALESCE(SUM(CASE WHEN bi.kind = 'service' THEN bi.line_total - bi.discount_share - bi.reward_share END), 0) AS revenue,
              COALESCE(SUM(CASE WHEN bi.kind = 'product' THEN bi.line_total - bi.discount_share - bi.reward_share END), 0) AS products,
              COALESCE(SUM(bi.commission), 0) AS commission
         FROM bill_items bi JOIN bills b ON b.id = bi.bill_id JOIN barbers br ON br.id = bi.barber_id
        WHERE b.shop_id = ? AND b.status = 'paid' AND b.paid_date BETWEEN ? AND ?
        GROUP BY br.id, br.name, br.chair_no`,
      billParams,
    ),
    query(
      `SELECT b.id, b.name, b.chair_no, COUNT(t.id) AS done,
              AVG(CASE WHEN t.ended_by <> 'system' THEN TIMESTAMPDIFF(SECOND, t.started_at, t.finished_at) / 60 END) AS avg_service_minutes
         FROM barbers b
         JOIN queue_tickets t ON t.barber_id = b.id AND t.status = 'done' AND t.shop_id = ? AND t.business_date BETWEEN ? AND ?
        GROUP BY b.id, b.name, b.chair_no`,
      ticketParams,
    ),
    query(
      `SELECT bi.name, SUM(bi.qty) AS count, SUM(bi.line_total - bi.discount_share - bi.reward_share) AS revenue
         FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
        WHERE b.shop_id = ? AND b.status = 'paid' AND b.paid_date BETWEEN ? AND ? AND bi.kind = 'service'
        GROUP BY bi.name ORDER BY count DESC, revenue DESC, bi.name`,
      billParams,
    ),
    query(
      `SELECT bi.product_id AS id, bi.name, SUM(bi.qty) AS qty, SUM(bi.line_total - bi.discount_share - bi.reward_share) AS revenue,
              SUM(bi.unit_cost * bi.qty) AS cost
         FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
        WHERE b.shop_id = ? AND b.status = 'paid' AND b.paid_date BETWEEN ? AND ? AND bi.kind = 'product'
        GROUP BY bi.product_id, bi.name ORDER BY qty DESC, bi.name`,
      billParams,
    ),
    queryOne("SELECT COUNT(*) AS count, COALESCE(SUM(subtotal), 0) AS total FROM bills WHERE shop_id = ? AND status = 'open'", [shopId]),
  ]);

  // الحلاقين: الأعداد من الطابور والفلوس من الفواتير
  const byBarber = new Map();
  for (const row of barberTickets) {
    byBarber.set(row.id, {
      id: row.id, name: row.name, chair_no: row.chair_no, done: n(row.done), revenue: 0, products: 0, commission: 0,
      avg_service_minutes: round1(row.avg_service_minutes),
    });
  }
  for (const row of barbers) {
    const entry = byBarber.get(row.id) ?? {
      id: row.id, name: row.name, chair_no: row.chair_no, done: 0, revenue: 0, products: 0, commission: 0, avg_service_minutes: null,
    };
    entry.revenue = n(row.revenue);
    entry.products = n(row.products);
    entry.commission = n(row.commission);
    byBarber.set(row.id, entry);
  }

  const kind = (key) => kinds.find((row) => row.kind === key);
  const sales = n(money.sales);
  return {
    from,
    to,
    business_date: from === to ? from : undefined,
    tickets: n(totals.tickets),
    done: n(totals.done),
    cancelled: n(totals.cancelled),
    no_show: n(totals.no_show),
    active: n(totals.active),
    by_source: { app: n(totals.from_app), kiosk: n(totals.from_kiosk), staff: n(totals.from_staff) },
    // المبيعات بعد الخصم والمكافأة، من غير البقشيش (اسمها revenue عشان شاشات المرحلة الأولى)
    revenue: sales,
    bills: n(money.bills),
    services_revenue: n(kind('service')?.net),
    products_revenue: n(kind('product')?.net),
    products_cost: n(kind('product')?.cost),
    discounts: n(money.discounts),
    rewards: n(money.rewards),
    tips: n(money.tips),
    refunds: n(refunds.amount),
    net_revenue: sales - n(refunds.amount),
    expenses: n(expenses.amount),
    methods: methods.map((row) => ({ code: row.code, label: row.label, kind: row.kind, net: n(row.net), count: n(row.count) })),
    collected: methods.reduce((sum, row) => sum + n(row.net), 0),
    open_bills: { count: n(open.count), total: n(open.total) },
    avg_wait_minutes: round1(totals.avg_wait_minutes),
    avg_service_minutes: round1(totals.avg_service_minutes),
    barbers: [...byBarber.values()].sort((a, b) => b.revenue - a.revenue || a.id - b.id),
    services: services.map((row) => ({ name: row.name, count: n(row.count), revenue: n(row.revenue) })),
    products: products.map((row) => ({ id: row.id, name: row.name, qty: n(row.qty), revenue: n(row.revenue), cost: n(row.cost) })),
  };
}

/** ملخّص يوم شغل (النهارده لو من غير تاريخ) */
export async function daySummary(shopId, date) {
  const shop = await queryOne('SELECT timezone FROM shops WHERE id = ?', [shopId]);
  const businessDate = date ?? businessDateAt(await loadHours(shopId), shop.timezone);
  return summary(shopId, businessDate, businessDate);
}

/** المبيعات يوم بيوم في فترة (للرسم) */
async function daily(shopId, from, to) {
  const rows = await query(
    `SELECT paid_date AS date, COUNT(*) AS bills, COALESCE(SUM(total), 0) AS sales
       FROM bills WHERE shop_id = ? AND status = 'paid' AND paid_date BETWEEN ? AND ?
      GROUP BY paid_date ORDER BY paid_date`,
    [shopId, from, to],
  );
  return rows.map((row) => ({ date: row.date, bills: n(row.bills), sales: n(row.sales) }));
}

const router = Router();
router.use(authenticate);

router.get('/today', requirePermission('reports.read'), validate({ query: z.object({ date: isoDate.optional() }) }),
  asyncHandler(async (req, res) => ok(res, await daySummary(req.shopId, req.query.date))));

const rangeQuery = z.object({ from: isoDate, to: isoDate }).refine(dateRangeRefine, { message: '«لحد» لازم بعد «من»', path: ['to'] });

router.get('/range', requirePermission('reports.read'), validate({ query: rangeQuery }), asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  if (diffDays(from, to) > 370) throw ApiError.unprocessable('أقصى فترة سنة', { code: 'VALIDATION_ERROR', details: { to: 'أقصى فترة سنة' } });
  const [totals, days] = await Promise.all([summary(req.shopId, from, to), daily(req.shopId, from, to)]);
  ok(res, { ...totals, days });
}));

export default router;
