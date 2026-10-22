import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created, noContent } from '../../utils/response.js';
import { audit } from '../../utils/audit.js';
import { boolish, idParams, idSchema, minorAmount, requiredText } from '../../utils/schemas.js';
import { servicesService as service } from './services.service.js';

const serviceBody = z.object({
  name: requiredText(80),
  price: minorAmount,
  default_minutes: z.number().int().min(1).max(480),
  active: z.boolean().optional(),
}).strict();

const updateBody = serviceBody.partial().strict();
const bulkBody = z.object({ items: z.array(serviceBody).min(1).max(50) });
const reorderBody = z.object({ ids: z.array(idSchema).min(1).max(200) });
const listQuery = z.object({ include_archived: boolish.optional() });

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('services.read'), validate({ query: listQuery }), asyncHandler(async (req, res) =>
  ok(res, await service.list(req.shopId, { includeArchived: req.query.include_archived === true }))));

router.post('/', requirePermission('services.write'), validate({ body: serviceBody }), asyncHandler(async (req, res) => {
  const row = await service.create(req.shopId, req.body);
  await audit(req, { action: 'service.create', entity: 'service', entityId: row.id, after: row });
  created(res, row);
}));

router.post('/bulk', requirePermission('services.write'), validate({ body: bulkBody }), asyncHandler(async (req, res) => {
  const rows = await service.createMany(req.shopId, req.body.items);
  await audit(req, { action: 'service.bulk_create', entity: 'service', after: rows });
  created(res, rows);
}));

router.put('/order', requirePermission('services.write'), validate({ body: reorderBody }), asyncHandler(async (req, res) =>
  ok(res, await service.reorder(req.shopId, req.body.ids))));

router.patch('/:id', requirePermission('services.write'), validate({ params: idParams('id'), body: updateBody }),
  asyncHandler(async (req, res) => {
    const { before, after } = await service.update(req.shopId, req.params.id, req.body);
    await audit(req, { action: 'service.update', entity: 'service', entityId: after.id, before, after });
    ok(res, after);
  }));

router.delete('/:id', requirePermission('services.write'), validate({ params: idParams('id') }), asyncHandler(async (req, res) => {
  const before = await service.archive(req.shopId, req.params.id);
  await audit(req, { action: 'service.archive', entity: 'service', entityId: before.id, before });
  noContent(res);
}));

router.post('/:id/restore', requirePermission('services.write'), validate({ params: idParams('id') }), asyncHandler(async (req, res) => {
  const row = await service.restore(req.shopId, req.params.id);
  await audit(req, { action: 'service.restore', entity: 'service', entityId: row.id, after: row });
  ok(res, row);
}));

export default router;
