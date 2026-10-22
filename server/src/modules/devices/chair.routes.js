/**
 * ═══════════════════════════════════════════════════════════════
 *  تابلت الكرسي (`/chair`)
 *
 *  الحلاق يختار اسمه ويكتب الـ PIN أوّل الوردية، وبعدها شغله كله زرار
 *  «التالي». التابلت عليه حلاق واحد، والحلاق على تابلت واحد: لو دخل من
 *  تابلت تاني، الأوّل بيخرج لوحده.
 *
 *  الـ PIN 4 أرقام، فمحمي من التخمين بحاجتين: حدّ محاولات لكل جهاز
 *  (pinLimiter)، وقفل الحلاق نفسه 15 دقيقة بعد 5 محاولات غلط.
 * ═══════════════════════════════════════════════════════════════
 */
import { Router } from 'express';
import { z } from 'zod';
import { query, transaction } from '../../config/db.js';
import { authenticateDevice } from '../../middleware/authenticateDevice.js';
import { validate } from '../../middleware/validate.js';
import { idempotent } from '../../middleware/idempotency.js';
import { pinLimiter } from '../../middleware/rateLimiters.js';
import { ApiError } from '../../utils/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/response.js';
import { idSchema, pinSchema } from '../../utils/schemas.js';
import { verifyPassword } from '../../utils/security.js';
import { openQueueStream } from '../../queue/stream.js';
import { ticketMinutes } from '../../queue/engine.js';
import { barbersService } from '../barbers/barbers.service.js';
import { queueService, readState } from '../queue/queue.service.js';

const MAX_FAILED_PINS = 5;
const PIN_LOCK_MINUTES = 15;

const loginBody = z.object({ barber_id: idSchema, pin: pinSchema });
const serviceBody = z.object({ service_id: idSchema });
const statusBody = z.object({
  status: z.enum(['available', 'break']),
  break_minutes: z.number().int().min(1).max(240).optional(),
});

const chair = (req) => ({ type: 'chair', id: req.device.id });
const once = idempotent((req) => `device:${req.device.id}`);

/** لازم حلاق داخل على التابلت */
function requireBarber(req, _res, next) {
  if (!req.device.current_barber_id) {
    return next(ApiError.conflict('مفيش حلاق داخل على التابلت ده — اختار اسمك واكتب الـ PIN', { code: 'CHAIR_SIGNED_OUT' }));
  }
  req.barberId = req.device.current_barber_id;
  return next();
}

/** اللي الحلاق محتاجه قدّامه: مين على الكرسي، والجايين عنده، والخدمات لزرار «+ خدمة» */
export async function chairView(shopId, barberId) {
  const now = new Date();
  const state = await readState(shopId, now);
  const barber = state.barbers.find((item) => item.id === barberId);
  if (!barber) throw ApiError.conflict('الحلاق ده اتشال — اخرج وادخل تاني', { code: 'CHAIR_SIGNED_OUT' });

  const current = state.tickets.find((ticket) => ticket.status === 'serving' && ticket.barber_id === barberId);
  const mine = state.waiting().filter((ticket) => ticket.preferred_barber_id === null || ticket.preferred_barber_id === barberId);
  const services = await query(
    'SELECT id, name, price FROM services WHERE shop_id = ? AND archived_at IS NULL AND active = 1 ORDER BY sort_order, id',
    [shopId],
  );

  return {
    version: state.version,
    now,
    barber: {
      id: barber.id, name: barber.name, chair_no: barber.chair_no, status: barber.status, break_until: barber.break_until,
    },
    serving: current ? {
      id: current.id,
      number: current.number,
      name: current.name,
      services: current.services.map((service) => service.name),
      total: Number(current.total),
      started_at: current.started_at,
      expected_minutes: Math.round(ticketMinutes(current, barberId, state.stats)),
    } : null,
    next: mine.slice(0, 2).map((ticket) => ({
      id: ticket.id,
      number: ticket.number,
      name: ticket.name,
      arrived: Boolean(ticket.arrived_at),
      called: Boolean(ticket.called_at),
      for_me: ticket.preferred_barber_id === barberId,
    })),
    waiting_for_me: mine.length,
    services: services.map((service) => ({ ...service, price: Number(service.price) })),
  };
}

const router = Router();
router.use(authenticateDevice('chair'));

/** شاشة اختيار الاسم */
router.get('/barbers', asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT id, name, chair_no, status, (pin_hash IS NOT NULL) AS has_pin,
            (pin_locked_until IS NOT NULL AND pin_locked_until > NOW()) AS locked
       FROM barbers WHERE shop_id = ? AND archived_at IS NULL ORDER BY sort_order, id`,
    [req.shopId],
  );
  ok(res, {
    current_barber_id: req.device.current_barber_id,
    barbers: rows.map((row) => ({ ...row, has_pin: Boolean(row.has_pin), locked: Boolean(row.locked) })),
  });
}));

router.post('/login', pinLimiter, validate({ body: loginBody }), asyncHandler(async (req, res) => {
  const { barber_id: barberId, pin } = req.body;
  const outcome = await transaction(async (tx) => {
    const barber = await tx.queryOne(
      `SELECT id, name, status, pin_hash, failed_pins, pin_locked_until FROM barbers
        WHERE id = ? AND shop_id = ? AND archived_at IS NULL FOR UPDATE`,
      [barberId, req.shopId],
    );
    if (!barber) throw ApiError.notFound('الحلاق غير موجود', { code: 'BARBER_NOT_FOUND' });
    if (!barber.pin_hash) throw ApiError.conflict('المالك لسه ما حطّش PIN للحلاق ده', { code: 'NO_PIN' });
    if (barber.pin_locked_until && barber.pin_locked_until.getTime() > Date.now()) {
      const minutes = Math.max(1, Math.ceil((barber.pin_locked_until.getTime() - Date.now()) / 60_000));
      throw ApiError.locked(`الـ PIN مقفول — جرّب بعد ${minutes} دقيقة أو اطلب من المالك PIN جديد`, { code: 'PIN_LOCKED' });
    }
    if (!(await verifyPassword(pin, barber.pin_hash))) {
      const failed = barber.failed_pins + 1;
      if (failed >= MAX_FAILED_PINS) {
        await tx.execute(
          'UPDATE barbers SET failed_pins = 0, pin_locked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?',
          [PIN_LOCK_MINUTES, barber.id],
        );
      } else {
        await tx.execute('UPDATE barbers SET failed_pins = ? WHERE id = ?', [failed, barber.id]);
      }
      return { ok: false };
    }
    await tx.execute('UPDATE barbers SET failed_pins = 0, pin_locked_until = NULL WHERE id = ?', [barber.id]);
    // الحلاق على تابلت واحد: لو كان داخل على تابلت تاني، يخرج منه
    await tx.execute('UPDATE devices SET current_barber_id = NULL WHERE current_barber_id = ? AND id <> ?', [barber.id, req.device.id]);
    await tx.execute('UPDATE devices SET current_barber_id = ? WHERE id = ?', [barber.id, req.device.id]);
    // أوّل الوردية: «مش موجود» ← «متاح»
    if (barber.status === 'off') await tx.execute("UPDATE barbers SET status = 'available', break_until = NULL WHERE id = ?", [barber.id]);
    return { ok: true };
  });
  // المحاولة الغلط اتسجّلت (المعاملة اتقفلت عادي)، والرد 401
  if (!outcome.ok) throw ApiError.unauthorized('الـ PIN غلط', { code: 'BAD_PIN' });
  await queueService.touch(req.shopId);
  ok(res, await chairView(req.shopId, barberId));
}));

router.post('/logout', asyncHandler(async (req, res) => {
  await transaction((tx) => tx.execute('UPDATE devices SET current_barber_id = NULL WHERE id = ?', [req.device.id]));
  ok(res, { signed_out: true });
}));

router.get('/queue', requireBarber, asyncHandler(async (req, res) => ok(res, await chairView(req.shopId, req.barberId))));

router.get('/stream', requireBarber, (req, res) => {
  openQueueStream(req, res, {
    shopId: req.shopId,
    render: () => chairView(req.shopId, req.barberId),
    expiresAt: req.authExpiresAt,
  });
});

/** «التالي» */
router.post('/next', requireBarber, once, asyncHandler(async (req, res) => {
  const result = await queueService.next(req.shopId, req.barberId, chair(req));
  ok(res, { ...result, view: await chairView(req.shopId, req.barberId) });
}));

/** «خلّصت» من غير ما ينادي حد */
router.post('/finish', requireBarber, once, asyncHandler(async (req, res) => {
  const result = await queueService.finish(req.shopId, req.barberId, chair(req));
  ok(res, { ...result, view: await chairView(req.shopId, req.barberId) });
}));

/** «+ خدمة» للزبون اللي على الكرسي */
router.post('/services', requireBarber, validate({ body: serviceBody }), once, asyncHandler(async (req, res) => {
  const view = await chairView(req.shopId, req.barberId);
  if (!view.serving) throw ApiError.conflict('مفيش زبون على الكرسي', { code: 'NOTHING_SERVING' });
  await queueService.addService(req.shopId, view.serving.id, req.body.service_id, chair(req));
  ok(res, await chairView(req.shopId, req.barberId));
}));

/** «استراحة» و«رجعت» */
router.post('/status', requireBarber, validate({ body: statusBody }), once, asyncHandler(async (req, res) => {
  if (req.body.status === 'break') {
    const view = await chairView(req.shopId, req.barberId);
    if (view.serving) throw ApiError.conflict('دوس «خلّصت» الأول، وبعدين خُد استراحة', { code: 'FINISH_FIRST' });
  }
  await barbersService.setStatus(req.shopId, req.barberId, req.body);
  await queueService.touch(req.shopId);
  ok(res, await chairView(req.shopId, req.barberId));
}));

export default router;
