/**
 * ═══════════════════════════════════════════════════════════════
 *  صفحة المحل العامة (من غير حساب)
 *
 *  اللي بيتعرض هنا بس: فاتح ولا لأ، والمواعيد، والخدمات بالأسعار،
 *  والحلاقين الموجودين والوقت المتوقّع عند كل واحد، وعدد الطابور.
 *  مفيش أي اسم أو رقم موبايل لزبون. CORS مفتوح من غير كوكي (app.js).
 * ═══════════════════════════════════════════════════════════════
 */
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { query, queryOne } from '../../config/db.js';
import { validate } from '../../middleware/validate.js';
import { publicLimiter } from '../../middleware/rateLimiters.js';
import { ApiError } from '../../utils/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/response.js';
import { slugSchema } from '../../utils/schemas.js';
import { openQueueStream } from '../../queue/stream.js';
import { openState } from '../shop/shop.service.js';
import { probeStart, readState, roundedWait } from '../queue/queue.service.js';

async function findShop(slug) {
  const shop = await queryOne(
    `SELECT id, name, slug, phone, whatsapp, address, city, latitude, longitude
       FROM shops WHERE slug = ? AND status = 'active'`,
    [slug],
  );
  if (!shop) throw ApiError.notFound('المحل غير موجود', { code: 'SHOP_NOT_FOUND' });
  return shop;
}

export async function publicShopView(shop) {
  const state = await readState(shop.id);
  const { now } = state;
  const services = await query(
    `SELECT id, name, price, default_minutes FROM services
      WHERE shop_id = ? AND archived_at IS NULL AND active = 1 ORDER BY sort_order, id`,
    [shop.id],
  );
  const anyone = probeStart(state, null);
  return {
    version: state.version,
    ...shop,
    latitude: shop.latitude === null ? null : Number(shop.latitude),
    longitude: shop.longitude === null ? null : Number(shop.longitude),
    now,
    open: openState(state.shop, state.hours, now),
    accepting_tickets: state.shop.accepting_tickets,
    remote_tickets_enabled: state.settings.remote_tickets_enabled,
    hours: state.hours,
    services: services.map((service) => ({ ...service, price: Number(service.price) })),
    waiting_count: state.waiting().length,
    wait_minutes: roundedWait(anyone?.start ?? null, now),
    barbers: state.barbers
      .filter((barber) => barber.status !== 'off')
      .map((barber) => ({
        id: barber.id,
        name: barber.name,
        chair_no: barber.chair_no,
        status: barber.status,
        photo_path: barber.photo_path,
        wait_minutes: roundedWait(probeStart(state, barber.id)?.start ?? null, now),
      })),
  };
}

const slugParams = validate({ params: z.object({ slug: slugSchema }) });

const router = Router();
router.use(publicLimiter);

/** المفتاح العام لإشعارات المتصفّح (التطبيق محتاجه قبل ما يشترك) */
router.get('/push-key', (_req, res) => ok(res, { public_key: env.push.publicKey || null }));

router.get('/shops/:slug', slugParams, asyncHandler(async (req, res) =>
  ok(res, await publicShopView(await findShop(req.params.slug)))));

router.get('/shops/:slug/stream', slugParams, asyncHandler(async (req, res) => {
  const shop = await findShop(req.params.slug);
  openQueueStream(req, res, { shopId: shop.id, render: () => publicShopView(shop) });
}));

export default router;
