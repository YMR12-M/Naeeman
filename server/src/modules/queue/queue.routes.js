import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { idempotent } from '../../middleware/idempotency.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created } from '../../utils/response.js';
import { audit } from '../../utils/audit.js';
import { idParams, idSchema, optionalText, phoneSchema } from '../../utils/schemas.js';
import { openQueueStream } from '../../queue/stream.js';
import { queueService as service } from './queue.service.js';

const optionalPhone = z.union([phoneSchema, z.literal('').transform(() => null), z.null()]).optional();

const walkInBody = z.object({
  name: optionalText(60),
  phone: optionalPhone,
  service_ids: z.array(idSchema).min(1, 'اختار خدمة واحدة على الأقل').max(10),
  barber_id: idSchema.nullable().optional(),
}).strict();

const cancelBody = z.object({ reason: optionalText(190) });
const moveBody = z.object({ after_ticket_id: idSchema.nullable(), reason: z.string().trim().min(2).max(190) });
const assignBody = z.object({ barber_id: idSchema.nullable() });
const serviceBody = z.object({ service_id: idSchema });
const viewQuery = z.object({ since: z.coerce.number().int().min(0).optional() });

const staff = (req) => ({ type: 'staff', id: req.user.id });
const once = idempotent((req) => `user:${req.user.id}`);
const ticketParams = validate({ params: idParams('id') });
const barberParams = validate({ params: idParams('barberId') });

const router = Router();
router.use(authenticate);

/** الطابور دلوقتي، أو `{changed:false}` لو مفيش جديد من بعد النسخة `since` */
router.get('/', requirePermission('queue.read'), validate({ query: viewQuery }), asyncHandler(async (req, res) =>
  ok(res, await service.view(req.shopId, { since: req.query.since }))));

router.get('/stream', requirePermission('queue.read'), (req, res) => {
  openQueueStream(req, res, {
    shopId: req.shopId,
    render: () => service.view(req.shopId),
    expiresAt: req.authExpiresAt,
  });
});

router.get('/tickets/:id', requirePermission('queue.read'), ticketParams, asyncHandler(async (req, res) =>
  ok(res, await service.getTicket(req.shopId, req.params.id))));

/** زبون من الشارع (الاستقبال) */
router.post('/tickets', requirePermission('queue.write'), validate({ body: walkInBody }), once, asyncHandler(async (req, res) => {
  const ticket = await service.create(req.shopId, {
    source: 'staff',
    name: req.body.name || 'زبون',
    phone: req.body.phone ?? null,
    service_ids: req.body.service_ids,
    barber_id: req.body.barber_id ?? null,
  }, staff(req));
  created(res, ticket);
}));

router.post('/tickets/:id/arrive', requirePermission('queue.write'), ticketParams, once, asyncHandler(async (req, res) =>
  ok(res, await service.arrive(req.shopId, req.params.id, staff(req)))));

router.post('/tickets/:id/cancel', requirePermission('queue.write'), validate({ params: idParams('id'), body: cancelBody }), once,
  asyncHandler(async (req, res) => ok(res, await service.cancel(req.shopId, req.params.id, staff(req), req.body.reason ?? null))));

router.post('/tickets/:id/no-show', requirePermission('queue.write'), ticketParams, once, asyncHandler(async (req, res) =>
  ok(res, await service.noShow(req.shopId, req.params.id, staff(req)))));

router.post('/tickets/:id/assign', requirePermission('queue.write'), validate({ params: idParams('id'), body: assignBody }), once,
  asyncHandler(async (req, res) => ok(res, await service.assign(req.shopId, req.params.id, req.body.barber_id, staff(req)))));

router.post('/tickets/:id/services', requirePermission('queue.write'), validate({ params: idParams('id'), body: serviceBody }), once,
  asyncHandler(async (req, res) => ok(res, await service.addService(req.shopId, req.params.id, req.body.service_id, staff(req)))));

/** تحريك يدوي في الطابور: محتاج سبب، وبيتسجّل في السجل */
router.post('/tickets/:id/move', requirePermission('queue.manage'), validate({ params: idParams('id'), body: moveBody }), once,
  asyncHandler(async (req, res) => {
    const result = await service.move(req.shopId, req.params.id, req.body.after_ticket_id, staff(req), req.body.reason);
    await audit(req, { action: 'queue.move', entity: 'ticket', entityId: req.params.id, after: { ...result, reason: req.body.reason } });
    ok(res, result);
  }));

/** «التالي» و«خلّصت» من اللوحة بالنيابة عن الحلاق */
router.post('/barbers/:barberId/next', requirePermission('queue.write'), barberParams, once, asyncHandler(async (req, res) =>
  ok(res, await service.next(req.shopId, req.params.barberId, staff(req)))));

router.post('/barbers/:barberId/finish', requirePermission('queue.write'), barberParams, once, asyncHandler(async (req, res) =>
  ok(res, await service.finish(req.shopId, req.params.barberId, staff(req)))));

export default router;
