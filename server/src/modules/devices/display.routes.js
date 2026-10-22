/**
 * ═══════════════════════════════════════════════════════════════
 *  شاشة التلفزيون (`/display`)
 *
 *  حيطة المرايات: الرقم اللي على كل كرسي، والخمسة الجايين، ومتوسّط
 *  الانتظار، وQR لأخد دور، والكود المتغيّر للـ check-in.
 *  الأسماء حسب إعداد المحل: «أحمد م.» أو الرقم بس. مفيش أرقام موبايلات.
 * ═══════════════════════════════════════════════════════════════
 */
import { Router } from 'express';
import { env } from '../../config/env.js';
import { authenticateDevice } from '../../middleware/authenticateDevice.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/response.js';
import { openQueueStream } from '../../queue/stream.js';
import { CHECKIN_WINDOW_MS, checkinCode, checkinExpiresAt } from '../../queue/checkin.js';
import { openState } from '../shop/shop.service.js';
import { probeStart, readState, roundedWait } from '../queue/queue.service.js';

/** «أحمد محمود» ← «أحمد م.» ، أو null لو المحل عايز الرقم بس */
export function displayName(name, style) {
  if (style === 'number_only' || !name) return null;
  const parts = String(name).trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${[...parts[1]][0]}.` : parts[0];
}

export async function displayView(shopId) {
  const now = new Date();
  const state = await readState(shopId, now);
  const style = state.settings.display_name_style;
  const serving = new Map(state.tickets.filter((t) => t.status === 'serving').map((t) => [t.barber_id, t]));
  const code = checkinCode(state.shop.checkin_secret, shopId, now);
  const anyone = probeStart(state);

  return {
    // الكود بيتغيّر كل دقيقة، فالنسخة فيها رقم الدقيقة عشان الشاشة تاخد الكود الجديد
    version: `${state.version}:${Math.floor(now.getTime() / CHECKIN_WINDOW_MS)}`,
    now,
    shop: { name: state.shop.name, slug: state.shop.slug },
    open: openState(state.shop, state.hours, now),
    accepting_tickets: state.shop.accepting_tickets,
    wait_minutes: roundedWait(anyone?.start ?? null, now),
    waiting_count: state.waiting().length,
    barbers: state.barbers
      .filter((barber) => barber.status !== 'off' || serving.has(barber.id))
      .map((barber) => {
        const ticket = serving.get(barber.id);
        return {
          id: barber.id,
          name: barber.name,
          chair_no: barber.chair_no,
          status: barber.status,
          break_until: barber.break_until,
          photo_path: barber.photo_path,
          serving: ticket ? { number: ticket.number, name: displayName(ticket.name, style) } : null,
        };
      }),
    next: state.waiting().slice(0, 5).map((ticket) => ({
      number: ticket.number,
      name: displayName(ticket.name, style),
      barber_id: ticket.preferred_barber_id,
      called: Boolean(ticket.called_at) && !ticket.arrived_at,
    })),
    checkin: {
      code,
      expires_at: checkinExpiresAt(now),
      url: `${env.customerAppUrl}/checkin/${state.shop.slug}?code=${code}`,
    },
    take_url: `${env.customerAppUrl}/s/${state.shop.slug}`,
  };
}

const router = Router();
router.use(authenticateDevice('display'));

router.get('/queue', asyncHandler(async (req, res) => ok(res, await displayView(req.shopId))));

router.get('/stream', (req, res) => {
  openQueueStream(req, res, {
    shopId: req.shopId,
    render: () => displayView(req.shopId),
    expiresAt: req.authExpiresAt,
    tickMs: 5_000,
  });
});

export default router;
