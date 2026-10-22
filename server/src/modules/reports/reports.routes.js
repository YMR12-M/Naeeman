/**
 * ملخّص يوم الشغل: كام دور، كام خلص، كام ما جاش، متوسّط الانتظار ومدّة
 * الخدمة، والإيراد لكل حلاق. المرحلة الأولى بتعتبر كل دور خلص اتدفع كاش
 * بإجمالي خدماته (الكاشير الحقيقي في المرحلة التانية).
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
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/response.js';
import { isoDate } from '../../utils/schemas.js';
import { businessDateAt } from '../../utils/hours.js';
import { loadHours } from '../shop/shop.service.js';

const round1 = (value) => (value === null || value === undefined ? null : Math.round(Number(value) * 10) / 10);

export async function daySummary(shopId, date) {
  const shop = await queryOne('SELECT timezone FROM shops WHERE id = ?', [shopId]);
  const businessDate = date ?? businessDateAt(await loadHours(shopId), shop.timezone);
  const params = [shopId, businessDate];

  const totals = await queryOne(
    `SELECT COUNT(*) AS tickets,
            SUM(status = 'done') AS done,
            SUM(status = 'cancelled') AS cancelled,
            SUM(status = 'no_show') AS no_show,
            SUM(status IN ('waiting','serving')) AS active,
            SUM(source = 'app') AS from_app,
            SUM(source = 'kiosk') AS from_kiosk,
            SUM(source = 'staff') AS from_staff,
            COALESCE(SUM(CASE WHEN status = 'done' THEN total END), 0) AS revenue,
            AVG(CASE WHEN started_at IS NOT NULL
                     THEN TIMESTAMPDIFF(SECOND, COALESCE(arrived_at, created_at), started_at) / 60 END) AS avg_wait_minutes,
            AVG(CASE WHEN status = 'done' AND ended_by <> 'system'
                     THEN TIMESTAMPDIFF(SECOND, started_at, finished_at) / 60 END) AS avg_service_minutes
       FROM queue_tickets WHERE shop_id = ? AND business_date = ?`,
    params,
  );

  const barbers = await query(
    `SELECT b.id, b.name, b.chair_no,
            COUNT(t.id) AS done,
            COALESCE(SUM(t.total), 0) AS revenue,
            AVG(CASE WHEN t.ended_by <> 'system' THEN TIMESTAMPDIFF(SECOND, t.started_at, t.finished_at) / 60 END) AS avg_service_minutes
       FROM barbers b
       JOIN queue_tickets t ON t.barber_id = b.id AND t.status = 'done' AND t.shop_id = ? AND t.business_date = ?
      GROUP BY b.id, b.name, b.chair_no
      ORDER BY revenue DESC, b.id`,
    params,
  );

  const services = await query(
    `SELECT ts.name, COUNT(*) AS count, SUM(ts.price) AS revenue
       FROM ticket_services ts JOIN queue_tickets t ON t.id = ts.ticket_id
      WHERE t.shop_id = ? AND t.business_date = ? AND t.status = 'done'
      GROUP BY ts.name ORDER BY count DESC, ts.name`,
    params,
  );

  const n = (value) => Number(value ?? 0);
  return {
    business_date: businessDate,
    tickets: n(totals.tickets),
    done: n(totals.done),
    cancelled: n(totals.cancelled),
    no_show: n(totals.no_show),
    active: n(totals.active),
    by_source: { app: n(totals.from_app), kiosk: n(totals.from_kiosk), staff: n(totals.from_staff) },
    revenue: n(totals.revenue),
    avg_wait_minutes: round1(totals.avg_wait_minutes),
    avg_service_minutes: round1(totals.avg_service_minutes),
    barbers: barbers.map((row) => ({
      id: row.id, name: row.name, chair_no: row.chair_no, done: n(row.done), revenue: n(row.revenue),
      avg_service_minutes: round1(row.avg_service_minutes),
    })),
    services: services.map((row) => ({ name: row.name, count: n(row.count), revenue: n(row.revenue) })),
  };
}

const router = Router();
router.use(authenticate);

router.get('/today', requirePermission('reports.read'), validate({ query: z.object({ date: isoDate.optional() }) }),
  asyncHandler(async (req, res) => ok(res, await daySummary(req.shopId, req.query.date))));

export default router;
