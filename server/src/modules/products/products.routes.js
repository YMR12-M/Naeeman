import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created, noContent } from '../../utils/response.js';
import { audit } from '../../utils/audit.js';
import { boolish, idParams, minorAmount, optionalText, requiredText } from '../../utils/schemas.js';
import { productsService as service } from './products.service.js';

const barcode = z.string().trim().max(40).transform((value) => (value === '' ? null : value)).nullable();

const productBody = z.object({
  name: requiredText(80),
  barcode: barcode.optional(),
  price: minorAmount,
  cost: minorAmount.optional(),
  track_stock: z.boolean().optional(),
  low_stock_at: z.number().int().min(0).max(100_000).nullable().optional(),
  active: z.boolean().optional(),
  initial_qty: z.number().int().min(0).max(100_000).optional(),
}).strict();

const updateBody = productBody.omit({ initial_qty: true }).partial().strict();

const stockBody = z.discriminatedUnion('type', [
  z.object({ type: z.literal('purchase'), qty: z.number().int().min(1).max(100_000), unit_cost: minorAmount.optional(), note: optionalText(190) }).strict(),
  z.object({ type: z.literal('use'), qty: z.number().int().min(1).max(100_000), note: optionalText(190) }).strict(),
  z.object({ type: z.literal('adjust'), counted_qty: z.number().int().min(-100_000).max(100_000), note: requiredText(190) }).strict(),
]);

const listQuery = z.object({ include_archived: boolish.optional(), q: z.string().trim().max(80).optional() });

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('products.read'), validate({ query: listQuery }), asyncHandler(async (req, res) =>
  ok(res, await service.list(req.shopId, { includeArchived: req.query.include_archived === true, q: req.query.q || undefined }))));

router.get('/lookup', requirePermission('products.read'), validate({ query: z.object({ barcode: requiredText(40) }) }),
  asyncHandler(async (req, res) => ok(res, await service.lookup(req.shopId, req.query.barcode))));

router.post('/', requirePermission('products.write'), validate({ body: productBody }), asyncHandler(async (req, res) => {
  const row = await service.create(req.shopId, req.body, req.user.id);
  await audit(req, { action: 'product.create', entity: 'product', entityId: row.id, after: row });
  created(res, row);
}));

router.get('/:id', requirePermission('products.read'), validate({ params: idParams('id') }), asyncHandler(async (req, res) =>
  ok(res, await service.get(req.shopId, req.params.id))));

router.patch('/:id', requirePermission('products.write'), validate({ params: idParams('id'), body: updateBody }),
  asyncHandler(async (req, res) => {
    const { before, after } = await service.update(req.shopId, req.params.id, req.body);
    await audit(req, { action: 'product.update', entity: 'product', entityId: after.id, before, after });
    ok(res, after);
  }));

router.delete('/:id', requirePermission('products.write'), validate({ params: idParams('id') }), asyncHandler(async (req, res) => {
  const before = await service.archive(req.shopId, req.params.id);
  await audit(req, { action: 'product.archive', entity: 'product', entityId: before.id, before });
  noContent(res);
}));

router.post('/:id/restore', requirePermission('products.write'), validate({ params: idParams('id') }), asyncHandler(async (req, res) =>
  ok(res, await service.restore(req.shopId, req.params.id))));

router.post('/:id/stock', requirePermission('stock.write'), validate({ params: idParams('id'), body: stockBody }),
  asyncHandler(async (req, res) => {
    const row = await service.stock(req.shopId, req.params.id, req.body, req.user.id);
    await audit(req, { action: `stock.${req.body.type}`, entity: 'product', entityId: row.id, after: { ...req.body, stock_qty: row.stock_qty } });
    ok(res, row);
  }));

router.get('/:id/movements', requirePermission('products.read'), validate({ params: idParams('id') }),
  asyncHandler(async (req, res) => ok(res, await service.movements(req.shopId, req.params.id))));

export default router;
