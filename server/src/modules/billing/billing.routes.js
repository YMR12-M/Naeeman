/**
 * مسارات الكاشير: الفواتير، وطرق الدفع، والدرج، وتقفيل اليوم.
 * كل حاجة فيها فلوس بتتسجّل في سجل التدقيق.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { idempotent } from '../../middleware/idempotency.js';
import { can } from '../../config/permissions.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created, paged } from '../../utils/response.js';
import { audit } from '../../utils/audit.js';
import {
  idParams, idSchema, isoDate, minorAmount, optionalText, pagingSchema, phoneSchema, requiredText,
} from '../../utils/schemas.js';
import { billingService, methodsService } from './billing.service.js';
import { drawerService } from './drawer.service.js';
import { dayCloseService } from './dayclose.service.js';
import { backupNow } from '../../jobs/backup.js';
import { logger } from '../../utils/logger.js';

const once = idempotent((req) => `user:${req.user.id}`);
const optionalPhone = z.union([phoneSchema, z.literal('').transform(() => null), z.null()]).optional();

const lineBody = z.union([
  z.object({ product_id: idSchema, qty: z.number().int().min(1).max(999).optional(), barber_id: idSchema.nullable().optional() }).strict(),
  z.object({ service_id: idSchema, barber_id: idSchema.nullable().optional() }).strict(),
]);

const counterBody = z.object({
  customer_name: optionalText(60),
  customer_phone: optionalPhone,
  barber_id: idSchema.nullable().optional(),
  items: z.array(lineBody).max(50).optional(),
}).strict();

const checkoutBody = z.object({
  discount: minorAmount.optional(),
  discount_reason: optionalText(190),
  redeem_reward: z.boolean().optional(),
  tip: minorAmount.optional(),
  payments: z.array(z.object({
    method: z.string().trim().min(1).max(24),
    amount: minorAmount.refine((value) => value > 0, 'المبلغ لازم أكبر من صفر'),
    tendered: minorAmount.nullable().optional(),
    reference: optionalText(60),
  }).strict()).max(5),
}).strict();

const refundBody = z.object({
  amount: minorAmount.refine((value) => value > 0, 'المبلغ لازم أكبر من صفر'),
  method: z.string().trim().min(1).max(24),
  reason: requiredText(190),
  restock: z.array(z.object({ item_id: idSchema, qty: z.number().int().min(1).max(999) })).max(50).optional(),
}).strict();

const listQuery = pagingSchema.extend({
  status: z.enum(['open', 'paid', 'void']).optional(),
  date: isoDate.optional(),
  q: z.string().trim().max(60).optional(),
});

const methodBody = z.object({
  label: requiredText(40),
  kind: z.enum(['card', 'wallet', 'transfer', 'other']),
}).strict();
const methodUpdate = z.object({
  label: requiredText(40),
  active: z.boolean(),
  sort_order: z.number().int().min(0).max(10_000),
}).partial().strict();

const movementBody = z.object({
  type: z.enum(['expense', 'advance', 'cash_in', 'cash_out']),
  amount: minorAmount.refine((value) => value > 0, 'المبلغ لازم أكبر من صفر'),
  barber_id: idSchema.nullable().optional(),
  note: optionalText(190),
}).strict().superRefine((value, ctx) => {
  if (['expense', 'cash_out'].includes(value.type) && !value.note) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: 'اكتب الحركة دي إيه' });
  }
});

/* ═══════════════════ الفواتير ═══════════════════ */
export const billsRouter = Router();
billsRouter.use(authenticate, requirePermission('billing.use'));

billsRouter.get('/', validate({ query: listQuery }), asyncHandler(async (req, res) => {
  const { rows, meta } = await billingService.list(req.shopId, {
    status: req.query.status, date: req.query.date, q: req.query.q || undefined,
    page: req.query.page, pageSize: req.query.page_size,
  });
  paged(res, rows, meta);
}));

billsRouter.post('/', once, validate({ body: counterBody }), asyncHandler(async (req, res) => {
  const bill = await billingService.createCounter(req.shopId, req.body, req.user.id);
  created(res, bill);
}));

billsRouter.post('/for-ticket/:ticketId', validate({ params: idParams('ticketId') }), asyncHandler(async (req, res) =>
  ok(res, await billingService.openForTicket(req.shopId, req.params.ticketId, req.user.id))));

billsRouter.get('/:id', validate({ params: idParams('id') }), asyncHandler(async (req, res) =>
  ok(res, await billingService.get(req.shopId, req.params.id))));

billsRouter.post('/:id/items', validate({ params: idParams('id'), body: lineBody }), asyncHandler(async (req, res) =>
  ok(res, await billingService.addItem(req.shopId, req.params.id, req.body))));

billsRouter.delete('/:id/items/:itemId', validate({ params: idParams('id', 'itemId') }), asyncHandler(async (req, res) =>
  ok(res, await billingService.removeItem(req.shopId, req.params.id, req.params.itemId, {
    canDiscount: can(req.user.role, 'billing.discount'),
  }))));

billsRouter.post('/:id/checkout', once, validate({ params: idParams('id'), body: checkoutBody }), asyncHandler(async (req, res) => {
  const bill = await billingService.checkout(req.shopId, req.params.id, req.body, req.user, {
    canDiscount: can(req.user.role, 'billing.discount'),
  });
  await audit(req, {
    action: 'bill.checkout', entity: 'bill', entityId: bill.id,
    after: { total: bill.total, tip: bill.tip, discount: bill.discount, reward: bill.reward_discount, payments: req.body.payments },
  });
  ok(res, bill);
}));

billsRouter.post('/:id/void', validate({ params: idParams('id'), body: z.object({ reason: requiredText(190) }) }),
  asyncHandler(async (req, res) => {
    const { before, after } = await billingService.void(req.shopId, req.params.id, req.body.reason, req.user, {
      canRefund: can(req.user.role, 'billing.refund'),
    });
    await audit(req, { action: 'bill.void', entity: 'bill', entityId: after.id, before: { subtotal: before.subtotal, items: before.items.length }, after: { reason: req.body.reason } });
    ok(res, after);
  }));

billsRouter.post('/:id/refund', requirePermission('billing.refund'), once, validate({ params: idParams('id'), body: refundBody }),
  asyncHandler(async (req, res) => {
    const bill = await billingService.refund(req.shopId, req.params.id, req.body, req.user);
    await audit(req, { action: 'bill.refund', entity: 'bill', entityId: bill.id, after: req.body });
    ok(res, bill);
  }));

billsRouter.get('/:id/receipt', validate({ params: idParams('id') }), asyncHandler(async (req, res) =>
  ok(res, await billingService.receipt(req.shopId, req.params.id))));

/* ═══════════════════ طرق الدفع ═══════════════════ */
export const methodsRouter = Router();
methodsRouter.use(authenticate);

methodsRouter.get('/', requirePermission('billing.use'), asyncHandler(async (req, res) =>
  ok(res, await methodsService.list(req.shopId))));

methodsRouter.post('/', requirePermission('payments.manage'), validate({ body: methodBody }), asyncHandler(async (req, res) => {
  const row = await methodsService.create(req.shopId, req.body);
  await audit(req, { action: 'payment_method.create', entity: 'payment_method', entityId: row.id, after: row });
  created(res, row);
}));

methodsRouter.patch('/:id', requirePermission('payments.manage'), validate({ params: idParams('id'), body: methodUpdate }),
  asyncHandler(async (req, res) => {
    const { before, after } = await methodsService.update(req.shopId, req.params.id, req.body);
    await audit(req, { action: 'payment_method.update', entity: 'payment_method', entityId: after.id, before, after });
    ok(res, after);
  }));

/* ═══════════════════ الدرج ═══════════════════ */
export const drawerRouter = Router();
drawerRouter.use(authenticate, requirePermission('billing.use'));

drawerRouter.get('/current', asyncHandler(async (req, res) => ok(res, await drawerService.current(req.shopId))));

drawerRouter.get('/sessions', asyncHandler(async (req, res) => ok(res, await drawerService.sessions(req.shopId))));

drawerRouter.get('/sessions/:id', validate({ params: idParams('id') }), asyncHandler(async (req, res) =>
  ok(res, await drawerService.get(req.shopId, req.params.id))));

drawerRouter.post('/open', once, validate({ body: z.object({ opening_float: minorAmount }).strict() }), asyncHandler(async (req, res) => {
  const session = await drawerService.open(req.shopId, req.body.opening_float, req.user.id);
  await audit(req, { action: 'drawer.open', entity: 'drawer', entityId: session.id, after: { opening_float: session.opening_float } });
  created(res, session);
}));

drawerRouter.post('/movements', requirePermission('drawer.expense'), once, validate({ body: movementBody }), asyncHandler(async (req, res) => {
  const result = await drawerService.movement(req.shopId, req.body, req.user, { canAdvance: can(req.user.role, 'drawer.advance') });
  await audit(req, { action: `drawer.${req.body.type}`, entity: 'drawer', entityId: result.session.id, after: req.body });
  created(res, result.session);
}));

drawerRouter.post('/close', once, validate({ body: z.object({ counted_cash: minorAmount, note: optionalText(190) }).strict() }),
  asyncHandler(async (req, res) => {
    const session = await drawerService.close(req.shopId, req.body.counted_cash, req.body.note, req.user.id);
    await audit(req, {
      action: 'drawer.close', entity: 'drawer', entityId: session.id,
      after: { expected: session.expected_cash, counted: session.counted_cash, variance: session.variance },
    });
    ok(res, session);
  }));

/* ═══════════════════ تقفيل اليوم ═══════════════════ */
export const dayCloseRouter = Router();
dayCloseRouter.use(authenticate);

dayCloseRouter.get('/preview', requirePermission('dayclose.close'), asyncHandler(async (req, res) =>
  ok(res, await dayCloseService.preview(req.shopId))));

dayCloseRouter.post('/', requirePermission('dayclose.close'), once, validate({ body: z.object({ note: optionalText(190) }).strict() }),
  asyncHandler(async (req, res) => {
    const close = await dayCloseService.close(req.shopId, req.body.note, req.user.id);
    await audit(req, { action: 'dayclose.close', entity: 'day_close', entityId: close.id, after: { number: close.number, sales: close.summary.sales } });
    created(res, close);
    // نسخة احتياطية بعد التقفيل (في الخلفية، ما بتأخّرش الرد)
    backupNow('تقفيل اليوم').catch((error) => logger.error(`فشلت النسخة الاحتياطية: ${error.message}`));
  }));

dayCloseRouter.get('/', requirePermission('dayclose.close'), asyncHandler(async (req, res) =>
  ok(res, await dayCloseService.list(req.shopId))));

dayCloseRouter.get('/:id', requirePermission('dayclose.close'), validate({ params: idParams('id') }), asyncHandler(async (req, res) =>
  ok(res, await dayCloseService.get(req.shopId, req.params.id))));
