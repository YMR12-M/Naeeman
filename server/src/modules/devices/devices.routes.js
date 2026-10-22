import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { pairingLimiter } from '../../middleware/rateLimiters.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created, noContent } from '../../utils/response.js';
import { audit } from '../../utils/audit.js';
import { idParams, optionalText, requiredText } from '../../utils/schemas.js';
import { DEVICE_TYPES, devicesService as service } from './devices.service.js';

const pairingBody = z.object({ type: z.enum(DEVICE_TYPES), name: optionalText(60) });
const pairBody = z.object({ code: z.string().regex(/^\d{6}$/, 'الكود 6 أرقام') });
const renameBody = z.object({ name: requiredText(60) });

const router = Router();

/** الجهاز نفسه: من غير حساب، بالكود بس */
router.post('/pair', pairingLimiter, validate({ body: pairBody }), asyncHandler(async (req, res) =>
  created(res, await service.pair(req.body.code))));

/* ── إدارة الأجهزة (المالك) ── */
router.use(authenticate, requirePermission('devices.manage'));

router.get('/', asyncHandler(async (req, res) => ok(res, await service.list(req.shopId))));

router.post('/pairing-code', validate({ body: pairingBody }), asyncHandler(async (req, res) => {
  const pairing = await service.createPairing(req.shopId, req.body, req.user.id);
  await audit(req, { action: 'device.pairing_code', entity: 'device', after: { type: pairing.type } });
  created(res, pairing);
}));

router.patch('/:id', validate({ params: idParams('id'), body: renameBody }), asyncHandler(async (req, res) => {
  await service.rename(req.shopId, req.params.id, req.body.name);
  noContent(res);
}));

router.delete('/:id', validate({ params: idParams('id') }), asyncHandler(async (req, res) => {
  const device = await service.revoke(req.shopId, req.params.id);
  await audit(req, { action: 'device.revoke', entity: 'device', entityId: device.id, before: device });
  noContent(res);
}));

export default router;
