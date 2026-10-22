/**
 * ═══════════════════════════════════════════════════════════════
 *  تابلت الباب (`/kiosk`)
 *
 *  الزبون اللي داخل من الشارع ياخد دور في 3 لمسات: الخدمات، والحلاق
 *  أو «أي حد»، والاسم (والموبايل اختياري). الدور بيتسجّل واصل.
 *  الكشك يقدر يلغي دور هو عمله بس، وخلال دقيقة (الزبون غلط في الاختيار).
 * ═══════════════════════════════════════════════════════════════
 */
import { Router } from 'express';
import { z } from 'zod';
import { queryOne } from '../../config/db.js';
import { authenticateDevice } from '../../middleware/authenticateDevice.js';
import { validate } from '../../middleware/validate.js';
import { idempotent } from '../../middleware/idempotency.js';
import { ApiError } from '../../utils/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created } from '../../utils/response.js';
import { idParams, idSchema, optionalText, phoneSchema } from '../../utils/schemas.js';
import { queueService, roundedWait } from '../queue/queue.service.js';
import { publicShopView } from '../public/public.routes.js';

const optionalPhone = z.union([phoneSchema, z.literal('').transform(() => null), z.null()]).optional();
const ticketBody = z.object({
  service_ids: z.array(idSchema).min(1, 'اختار خدمة واحدة على الأقل').max(10),
  barber_id: idSchema.nullable().optional(),
  name: optionalText(60),
  phone: optionalPhone,
}).strict();

const kiosk = (req) => ({ type: 'kiosk', id: req.device.id });
const once = idempotent((req) => `device:${req.device.id}`);

const router = Router();
router.use(authenticateDevice('kiosk'));

/** قايمة الأسعار والحلاقين الموجودين والانتظار (نفس صفحة المحل العامة) */
router.get('/options', asyncHandler(async (req, res) => {
  const shop = await queryOne(
    'SELECT id, name, slug, phone, whatsapp, address, city, latitude, longitude FROM shops WHERE id = ?',
    [req.shopId],
  );
  ok(res, await publicShopView(shop));
}));

router.post('/tickets', validate({ body: ticketBody }), once, asyncHandler(async (req, res) => {
  const ticket = await queueService.create(req.shopId, {
    source: 'kiosk',
    name: req.body.name || 'زبون',
    phone: req.body.phone ?? null,
    service_ids: req.body.service_ids,
    barber_id: req.body.barber_id ?? null,
  }, kiosk(req));
  created(res, {
    id: ticket.id,
    number: ticket.number,
    name: ticket.name,
    services: ticket.services.map((service) => service.name),
    total: ticket.total,
    ahead: ticket.ahead,
    wait_minutes: roundedWait(ticket.eta ? new Date(ticket.eta) : null, new Date()),
  });
}));

router.post('/tickets/:id/cancel', validate({ params: idParams('id') }), once, asyncHandler(async (req, res) => {
  const mine = await queryOne(
    "SELECT ticket_id FROM ticket_events WHERE ticket_id = ? AND type = 'created' AND actor_type = 'kiosk' AND actor_id = ?",
    [req.params.id, req.device.id],
  );
  if (!mine) throw ApiError.notFound('الدور غير موجود', { code: 'TICKET_NOT_FOUND' });
  ok(res, await queueService.cancel(req.shopId, req.params.id, kiosk(req), 'kiosk_undo'));
}));

export default router;
