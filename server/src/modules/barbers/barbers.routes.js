import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created, noContent } from '../../utils/response.js';
import { audit } from '../../utils/audit.js';
import { boolish, idParams, idSchema, pinSchema, requiredText } from '../../utils/schemas.js';
import { barbersService as service } from './barbers.service.js';
import { queueService } from '../queue/queue.service.js';

const chairNo = z.number().int().min(1).max(99).nullable();

const createBody = z.object({
  name: requiredText(60),
  chair_no: chairNo.optional(),
  pin: pinSchema.optional(),
}).strict();

const updateBody = z.object({ name: requiredText(60), chair_no: chairNo }).partial().strict();
const pinBody = z.object({ pin: pinSchema });
const statusBody = z.object({
  status: z.enum(['available', 'break', 'off']),
  break_minutes: z.number().int().min(1).max(240).optional(),
});
const reorderBody = z.object({ ids: z.array(idSchema).min(1).max(100) });
const listQuery = z.object({ include_archived: boolish.optional() });

/** نسجّل بلا الـ PIN */
const safe = (barber) => (barber ? { id: barber.id, name: barber.name, chair_no: barber.chair_no, status: barber.status } : null);

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('barbers.read'), validate({ query: listQuery }), asyncHandler(async (req, res) =>
  ok(res, await service.list(req.shopId, { includeArchived: req.query.include_archived === true }))));

router.post('/', requirePermission('barbers.write'), validate({ body: createBody }), asyncHandler(async (req, res) => {
  const row = await service.create(req.shopId, req.body);
  await audit(req, { action: 'barber.create', entity: 'barber', entityId: row.id, after: safe(row) });
  created(res, row);
}));

router.put('/order', requirePermission('barbers.write'), validate({ body: reorderBody }), asyncHandler(async (req, res) =>
  ok(res, await service.reorder(req.shopId, req.body.ids))));

router.patch('/:id', requirePermission('barbers.write'), validate({ params: idParams('id'), body: updateBody }),
  asyncHandler(async (req, res) => {
    const { before, after } = await service.update(req.shopId, req.params.id, req.body);
    await audit(req, { action: 'barber.update', entity: 'barber', entityId: after.id, before: safe(before), after: safe(after) });
    ok(res, after);
  }));

router.put('/:id/pin', requirePermission('barbers.write'), validate({ params: idParams('id'), body: pinBody }),
  asyncHandler(async (req, res) => {
    const row = await service.setPin(req.shopId, req.params.id, req.body.pin);
    await audit(req, { action: 'barber.pin', entity: 'barber', entityId: row.id });
    ok(res, row);
  }));

router.post('/:id/status', requirePermission('barbers.status'), validate({ params: idParams('id'), body: statusBody }),
  asyncHandler(async (req, res) => {
    const { after } = await service.setStatus(req.shopId, req.params.id, req.body);
    await queueService.touch(req.shopId);
    ok(res, after);
  }));

router.delete('/:id', requirePermission('barbers.write'), validate({ params: idParams('id') }), asyncHandler(async (req, res) => {
  const before = await service.archive(req.shopId, req.params.id);
  await queueService.touch(req.shopId);
  await audit(req, { action: 'barber.archive', entity: 'barber', entityId: before.id, before: safe(before) });
  noContent(res);
}));

router.post('/:id/restore', requirePermission('barbers.write'), validate({ params: idParams('id') }), asyncHandler(async (req, res) => {
  const row = await service.restore(req.shopId, req.params.id);
  await audit(req, { action: 'barber.restore', entity: 'barber', entityId: row.id, after: safe(row) });
  ok(res, row);
}));

export default router;
