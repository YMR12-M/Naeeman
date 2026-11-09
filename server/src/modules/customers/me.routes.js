import { Router } from 'express';
import { z } from 'zod';
import { authenticateCustomer } from '../../middleware/authenticateCustomer.js';
import { validate } from '../../middleware/validate.js';
import { idempotent } from '../../middleware/idempotency.js';
import { checkinLimiter, ticketLimiter } from '../../middleware/rateLimiters.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created, noContent } from '../../utils/response.js';
import { customerPasswordSchema, emailSchema, idParams, idSchema, slugSchema } from '../../utils/schemas.js';
import { openQueueStream } from '../../queue/stream.js';
import { queueService } from '../queue/queue.service.js';
import { customerAuthService, toPublicCustomer } from './customerAuth.service.js';
import { sendCustomerSession } from './customerAuth.routes.js';
import { meService } from './me.service.js';
import { customerCards } from '../cards/cards.service.js';
import { sendImage } from '../cards/cards.routes.js';

const optionalEmail = z.union([emailSchema, z.literal('').transform(() => null), z.null()]).optional();

const profileBody = z.object({ name: z.string().trim().min(2).max(60).optional(), email: optionalEmail }).strict();
const passwordBody = z.object({ current_password: z.string().min(1).max(128), new_password: customerPasswordSchema });
const takeBody = z.object({
  shop_slug: slugSchema,
  service_ids: z.array(idSchema).min(1, 'اختار خدمة واحدة على الأقل').max(10),
  barber_id: idSchema.nullable().optional(),
}).strict();
const checkinBody = z.object({ code: z.string().regex(/^\d{6}$/, 'الكود 6 أرقام') });
const pushBody = z.object({
  endpoint: z.string().url().max(600),
  keys: z.object({ p256dh: z.string().min(10).max(255), auth: z.string().min(10).max(255) }),
});
const unpushBody = z.object({ endpoint: z.string().url().max(600) });

const me = (req) => ({ type: 'customer', id: req.customer.id });
const once = idempotent((req) => `customer:${req.customer.id}`);
const ticketParams = validate({ params: idParams('id') });

const router = Router();
router.use(authenticateCustomer);

/* ── الحساب ── */
router.get('/', (req, res) => ok(res, toPublicCustomer(req.customer)));

router.patch('/', validate({ body: profileBody }), asyncHandler(async (req, res) =>
  ok(res, await customerAuthService.updateProfile(req.customer, req.body))));

router.post('/change-password', validate({ body: passwordBody }), asyncHandler(async (req, res) =>
  sendCustomerSession(req, res, await customerAuthService.changePassword(req.customer, req.body, req.context))));

router.post('/push-subscriptions', validate({ body: pushBody }), asyncHandler(async (req, res) => {
  await customerAuthService.subscribePush(req.customer.id, req.body, req.context.userAgent);
  noContent(res);
}));

router.delete('/push-subscriptions', validate({ body: unpushBody }), asyncHandler(async (req, res) => {
  await customerAuthService.unsubscribePush(req.customer.id, req.body.endpoint);
  noContent(res);
}));

/* ── كروت المحلات (الأختام) وصور القصّات ── */
router.get('/cards', asyncHandler(async (req, res) => ok(res, await customerCards.list(req.customer.id))));

router.patch('/cards/:shopId', validate({ params: idParams('shopId'), body: z.object({ reminders_off: z.boolean() }).strict() }),
  asyncHandler(async (req, res) => ok(res, await customerCards.setReminders(req.customer.id, req.params.shopId, req.body.reminders_off))));

router.get('/photos', asyncHandler(async (req, res) => ok(res, await customerCards.photos(req.customer.id))));

router.get('/photos/:id', validate({ params: idParams('id') }), asyncHandler(async (req, res) =>
  sendImage(res, await customerCards.photoFile(req.customer.id, req.params.id))));

router.delete('/photos/:id', validate({ params: idParams('id') }), asyncHandler(async (req, res) => {
  await customerCards.deletePhoto(req.customer.id, req.params.id);
  noContent(res);
}));

/* ── الأدوار ── */
router.get('/tickets', asyncHandler(async (req, res) => ok(res, await meService.history(req.customer.id))));

router.get('/tickets/active', asyncHandler(async (req, res) => ok(res, await meService.active(req.customer.id))));

router.get('/tickets/:id', ticketParams, asyncHandler(async (req, res) =>
  ok(res, await meService.ticket(req.customer.id, req.params.id))));

/** خُد دور */
router.post('/tickets', ticketLimiter, validate({ body: takeBody }), once, asyncHandler(async (req, res) => {
  const shopId = await meService.shopBySlug(req.body.shop_slug);
  const ticket = await queueService.create(shopId, {
    source: 'app',
    customer_id: req.customer.id,
    name: req.customer.name,
    phone: req.customer.phone,
    service_ids: req.body.service_ids,
    barber_id: req.body.barber_id ?? null,
  }, me(req));
  created(res, await meService.ticket(req.customer.id, ticket.id));
}));

/** أفعال الزبون على دوره هو بس */
const action = (handler) => [ticketParams, once, asyncHandler(async (req, res) => {
  const { shop_id: shopId } = await meService.own(req.customer.id, req.params.id);
  await handler(req, shopId);
  ok(res, await meService.ticket(req.customer.id, req.params.id));
})];

router.post('/tickets/:id/coming', ...action((req, shopId) => queueService.confirmComing(shopId, req.params.id, me(req))));
router.post('/tickets/:id/delay', ...action((req, shopId) => queueService.delay(shopId, req.params.id, me(req))));
router.post('/tickets/:id/cancel', ...action((req, shopId) => queueService.cancel(shopId, req.params.id, me(req))));
router.post('/tickets/:id/check-in', checkinLimiter, validate({ body: checkinBody }),
  ...action((req, shopId) => queueService.checkIn(shopId, req.params.id, req.body.code, me(req))));

/**
 * دوري لايف. لو مفيش دور شغّال، حدث واحد بـ ticket: null والاتصال يتقفل
 * (التطبيق يفتح stream جديد بعد ما ياخد دور).
 */
router.get('/stream', asyncHandler(async (req, res) => {
  const current = await meService.active(req.customer.id);
  if (!current.ticket) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' });
    res.end(`event: queue\nid: 0\ndata: ${JSON.stringify(current)}\n\n`);
    return;
  }
  const ticketId = current.ticket.id;
  openQueueStream(req, res, {
    shopId: current.ticket.shop.id,
    render: () => meService.ticket(req.customer.id, ticketId),
    expiresAt: req.authExpiresAt,
  });
}));

export default router;
