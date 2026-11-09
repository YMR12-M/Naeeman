import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { idempotent } from '../../middleware/idempotency.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created } from '../../utils/response.js';
import { audit } from '../../utils/audit.js';
import { idParams, idSchema, isoDate, minorAmount, optionalText } from '../../utils/schemas.js';
import { payrollService as service } from './payroll.service.js';

const rate = z.number().int().min(0).max(10_000); // × 100: 4000 = 40%

const payBody = z.object({
  pay_type: z.enum(['commission', 'salary', 'chair_rent']),
  service_pct: rate,
  product_pct: rate,
  daily_wage: minorAmount,
  rent_amount: minorAmount,
  rent_period: z.enum(['day', 'week', 'month']),
  tips_to_barber: z.boolean(),
}).strict();

const settleBody = z.object({
  barber_id: idSchema,
  to: isoDate.optional(),
  via: z.enum(['drawer', 'outside']),
  note: optionalText(190),
}).strict();

const router = Router();
router.use(authenticate);

router.get('/barbers', requirePermission('payroll.read'), asyncHandler(async (req, res) =>
  ok(res, await service.barbers(req.shopId))));

router.put('/barbers/:id', requirePermission('payroll.write'), validate({ params: idParams('id'), body: payBody }),
  asyncHandler(async (req, res) => {
    const { before, after } = await service.setPay(req.shopId, req.params.id, req.body);
    await audit(req, { action: 'barber.pay', entity: 'barber', entityId: after.id, before, after });
    ok(res, after);
  }));

router.get('/preview', requirePermission('payroll.read'), validate({ query: z.object({ barber_id: idSchema, to: isoDate.optional() }) }),
  asyncHandler(async (req, res) => ok(res, await service.preview(req.shopId, req.query.barber_id, req.query.to))));

router.post('/settlements', requirePermission('payroll.write'), idempotent((req) => `user:${req.user.id}`), validate({ body: settleBody }),
  asyncHandler(async (req, res) => {
    const settlement = await service.settle(req.shopId, req.body.barber_id, req.body, req.user);
    await audit(req, { action: 'payroll.settle', entity: 'settlement', entityId: settlement.id, after: settlement });
    created(res, settlement);
  }));

router.get('/settlements', requirePermission('payroll.read'), validate({ query: z.object({ barber_id: idSchema.optional() }) }),
  asyncHandler(async (req, res) => ok(res, await service.list(req.shopId, { barberId: req.query.barber_id }))));

router.get('/settlements/:id', requirePermission('payroll.read'), validate({ params: idParams('id') }),
  asyncHandler(async (req, res) => ok(res, await service.get(req.shopId, req.params.id))));

export default router;
